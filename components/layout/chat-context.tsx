'use client'

import {
  createContext, useContext, useState, useRef, useCallback, type ReactNode,
} from 'react'
import { trpc } from '@/lib/trpc/client'
import type { TraceStep } from '@/lib/ai/trace'

// ─── Types ────────────────────────────────────────────────────────────────────

type SSEEvent =
  | { type: 'conversation'; id: string; title: string }
  | { type: 'agent'; name: string; message: string }
  | { type: 'tool_call'; tool: string; args: Record<string, unknown> }
  | { type: 'tool_result'; step: TraceStep }
  | { type: 'text'; content: string }
  | { type: 'done'; agentName: string }
  | { type: 'error'; message: string }

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  agentName?: string
  /** What the assistant actually did, shown under the answer. */
  trace: TraceStep[]
  /** The tool that is mid-flight, if one is. Becomes a trace step when it returns. */
  pending: { tool: string; args: Record<string, unknown> } | null
  status: string | null
  isStreaming: boolean
  isError: boolean
}

/** Where the conversation is displayed. The rail is the default; the overlay is
 *  the same thread, larger, over a blurred workspace. */
export type ChatSurface = 'closed' | 'rail' | 'overlay'

// ─── Context ──────────────────────────────────────────────────────────────────

interface ChatContextValue {
  input: string
  setInput: (v: string) => void
  isStreaming: boolean
  messages: Message[]
  conversationId: string | null
  surface: ChatSurface
  openRail: () => void
  openOverlay: () => void
  closeChat: () => void
  submit: (overrideText?: string) => void
  stop: () => void
  retry: () => void
  newConversation: () => void
  loadConversation: (id: string) => void
  isLoadingConversation: boolean
}

const ChatContext = createContext<ChatContextValue | null>(null)

export function useChat() {
  const ctx = useContext(ChatContext)
  if (!ctx) throw new Error('useChat must be used within a ChatProvider')
  return ctx
}

const emptyAssistant = (): Message => ({
  id: crypto.randomUUID(),
  role: 'assistant',
  content: '',
  trace: [],
  pending: null,
  status: null,
  isStreaming: true,
  isError: false,
})

// ─── Provider ─────────────────────────────────────────────────────────────────
//
// Above the whole workspace, so the thread survives route changes and both the
// rail and the overlay render the same conversation rather than two copies of
// one. The messages here are the live turn; everything older is in Postgres and
// reloaded through trpc.agent.conversation.

export function ChatProvider({ children }: { children: ReactNode }) {
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [surface, setSurface] = useState<ChatSurface>('closed')
  const [isLoadingConversation, setIsLoadingConversation] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const utils = trpc.useUtils()

  const updateLastAssistantMessage = useCallback((updater: (prev: Message) => Message) => {
    setMessages(prev => {
      const idx = [...prev].reverse().findIndex(m => m.role === 'assistant')
      if (idx === -1) return prev
      const realIdx = prev.length - 1 - idx
      const updated = [...prev]
      updated[realIdx] = updater(updated[realIdx])
      return updated
    })
  }, [])

  // Core: append an assistant placeholder, then stream the response into it.
  const streamResponse = useCallback(async (
    userText: string,
    history: Array<{ role: string; content: string }>,
    opts?: { retry?: boolean },
  ) => {
    setMessages(prev => [...prev, emptyAssistant()])
    setIsStreaming(true)

    const controller = new AbortController()
    abortRef.current = controller

    // Read once here rather than from state inside the loop: a `setState` from
    // the `conversation` event would not be visible to this closure anyway.
    let threadId = conversationId

    try {
      const res = await fetch('/api/agents/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userText,
          history,
          conversationId: threadId ?? undefined,
          retry: opts?.retry ?? false,
        }),
        signal: controller.signal,
      })

      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value: chunk } = await reader.read()
        if (done) break
        buffer += decoder.decode(chunk, { stream: true })

        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const raw = line.slice(6).trim()
          if (raw === '[DONE]') continue
          let event: SSEEvent
          try { event = JSON.parse(raw) as SSEEvent }
          catch { continue }

          switch (event.type) {
            case 'conversation':
              threadId = event.id
              setConversationId(event.id)
              break

            case 'agent':
              updateLastAssistantMessage(m => ({
                ...m, agentName: event.name, status: event.message,
              }))
              break

            case 'tool_call':
              updateLastAssistantMessage(m => ({
                ...m, pending: { tool: event.tool, args: event.args },
              }))
              break

            case 'tool_result':
              updateLastAssistantMessage(m => ({
                ...m, trace: [...m.trace, event.step], pending: null,
              }))
              break

            case 'text':
              updateLastAssistantMessage(m => ({
                ...m, content: m.content + event.content, status: null,
              }))
              break

            case 'done':
              updateLastAssistantMessage(m => ({
                ...m, isStreaming: false, agentName: event.agentName, status: null, pending: null,
              }))
              break

            case 'error':
              updateLastAssistantMessage(m => ({
                ...m,
                content: event.message,
                isStreaming: false,
                isError: true,
                status: null,
                pending: null,
              }))
              break
          }
        }
      }
    } catch (err) {
      if (controller.signal.aborted) {
        // User stopped generation — keep the partial answer, drop the caret.
        updateLastAssistantMessage(m => ({
          ...m, content: m.content || 'Stopped.', isStreaming: false, pending: null,
        }))
      } else {
        updateLastAssistantMessage(m => ({
          ...m,
          content: err instanceof Error ? err.message : 'Failed to connect to agent',
          isStreaming: false,
          isError: true,
          pending: null,
        }))
      }
    } finally {
      setIsStreaming(false)
      updateLastAssistantMessage(m => ({ ...m, isStreaming: false, status: null }))
      abortRef.current = null
      // The title and ordering of the history list both change on every turn.
      void utils.agent.conversations.invalidate()
      if (threadId) void utils.agent.conversation.invalidate({ id: threadId })
    }
  }, [conversationId, updateLastAssistantMessage, utils])

  const submit = useCallback((overrideText?: string) => {
    const text = (overrideText ?? input).trim()
    if (!text || isStreaming) return

    setInput('')
    // Never yanks the user into the overlay: if they are reading the rail
    // alongside the worklist, an answer should arrive where they are looking.
    setSurface(s => (s === 'closed' ? 'rail' : s))

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      trace: [],
      pending: null,
      status: null,
      isStreaming: false,
      isError: false,
    }
    setMessages(prev => [...prev, userMsg])

    const history = messages
      .filter(m => !m.isStreaming && !m.isError)
      .map(m => ({ role: m.role, content: m.content }))

    void streamResponse(text, history)
  }, [input, isStreaming, messages, streamResponse])

  // Re-run the last user turn after an error: drop the trailing assistant
  // bubble and regenerate from the same prompt + prior history. `retry: true`
  // tells the server to replace the stored answer rather than record the
  // question a second time.
  const retry = useCallback(() => {
    if (isStreaming) return
    const lastUserIdx = messages.map(m => m.role).lastIndexOf('user')
    if (lastUserIdx === -1) return

    const userText = messages[lastUserIdx].content
    const history = messages
      .slice(0, lastUserIdx)
      .filter(m => !m.isStreaming && !m.isError)
      .map(m => ({ role: m.role, content: m.content }))

    setMessages(prev => prev.slice(0, lastUserIdx + 1))
    void streamResponse(userText, history, { retry: true })
  }, [isStreaming, messages, streamResponse])

  const stop = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  /** Clear the pane for a fresh thread. The old one stays in history. */
  const newConversation = useCallback(() => {
    abortRef.current?.abort()
    setMessages([])
    setConversationId(null)
    setInput('')
  }, [])

  const loadConversation = useCallback(async (id: string) => {
    abortRef.current?.abort()
    setIsLoadingConversation(true)
    try {
      const loaded = await utils.agent.conversation.fetch({ id })
      setMessages(loaded.messages.map(m => ({
        ...m,
        pending: null,
        status: null,
        isStreaming: false,
      })))
      setConversationId(loaded.id)
    } catch {
      // Deleted in another tab, or never ours. Land on an empty thread rather
      // than showing the previous conversation under the new title.
      setMessages([])
      setConversationId(null)
    } finally {
      setIsLoadingConversation(false)
    }
  }, [utils])

  const value: ChatContextValue = {
    input, setInput, isStreaming, messages, conversationId, surface,
    openRail: useCallback(() => setSurface('rail'), []),
    openOverlay: useCallback(() => setSurface('overlay'), []),
    closeChat: useCallback(() => setSurface('closed'), []),
    submit, stop, retry, newConversation,
    loadConversation: useCallback((id: string) => { void loadConversation(id) }, [loadConversation]),
    isLoadingConversation,
  }

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>
}

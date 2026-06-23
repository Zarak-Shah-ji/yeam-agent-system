'use client'

import { createContext, useContext, useState, useRef, useCallback, type ReactNode } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

type SSEEvent =
  | { type: 'routing'; message: string }
  | { type: 'agent'; name: string; message: string }
  | { type: 'tool_call'; tool: string }
  | { type: 'tool_result'; tool: string; count?: number }
  | { type: 'text'; content: string }
  | { type: 'done'; agentName: string }
  | { type: 'error'; message: string }

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  agentName?: string
  statusLines: string[]   // routing / tool call status shown above the bubble
  isStreaming: boolean
  isError: boolean
}

const TOOL_LABELS: Record<string, string> = {
  patient_lookup:     '🔍 Looking up patient...',
  appointment_list:   '📅 Fetching appointments...',
  appointment_cancel: '❌ Cancelling appointment...',
  insurance_verify:   '🛡 Verifying insurance...',
  claim_lookup:       '📋 Looking up claims...',
  metrics_query:      '📊 Running metrics query...',
}

// ─── Context ──────────────────────────────────────────────────────────────────

interface ChatContextValue {
  input: string
  setInput: (v: string) => void
  isStreaming: boolean
  messages: Message[]
  showPanel: boolean
  setShowPanel: (v: boolean) => void
  submit: (overrideText?: string) => void
  stop: () => void
  retry: () => void
  clearConversation: () => void
}

const ChatContext = createContext<ChatContextValue | null>(null)

export function useChat() {
  const ctx = useContext(ChatContext)
  if (!ctx) throw new Error('useChat must be used within a ChatProvider')
  return ctx
}

// ─── Provider ─────────────────────────────────────────────────────────────────
// Lives above both CommandBar instances (top bar + hero) so the conversation
// survives route changes and chips can read `isStreaming`.

export function ChatProvider({ children }: { children: ReactNode }) {
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [showPanel, setShowPanel] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

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
  ) => {
    const assistantMsg: Message = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      statusLines: [],
      isStreaming: true,
      isError: false,
    }
    setMessages(prev => [...prev, assistantMsg])
    setIsStreaming(true)

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const res = await fetch('/api/agents/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userText, history }),
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
            case 'routing':
              updateLastAssistantMessage(m => ({
                ...m, statusLines: [...m.statusLines, event.message],
              }))
              break

            case 'agent':
              updateLastAssistantMessage(m => ({
                ...m,
                agentName: event.name,
                statusLines: [...m.statusLines, event.message],
              }))
              break

            case 'tool_call':
              updateLastAssistantMessage(m => ({
                ...m,
                statusLines: [...m.statusLines, TOOL_LABELS[event.tool] ?? `🔧 Calling ${event.tool}...`],
              }))
              break

            case 'tool_result':
              updateLastAssistantMessage(m => ({
                ...m,
                statusLines: m.statusLines.map((s, i) =>
                  i === m.statusLines.length - 1
                    ? s.replace('...', event.count !== undefined ? ` (${event.count} result${event.count !== 1 ? 's' : ''})` : ' ✓')
                    : s
                ),
              }))
              break

            case 'text':
              updateLastAssistantMessage(m => ({ ...m, content: m.content + event.content }))
              break

            case 'done':
              updateLastAssistantMessage(m => ({
                ...m, isStreaming: false, agentName: event.agentName,
              }))
              break

            case 'error':
              updateLastAssistantMessage(m => ({
                ...m, content: event.message, isStreaming: false, isError: true,
              }))
              break
          }
        }
      }
    } catch (err) {
      if (controller.signal.aborted) {
        // User stopped generation — keep the partial answer, drop the caret.
        updateLastAssistantMessage(m => ({
          ...m,
          content: m.content || 'Stopped.',
          isStreaming: false,
        }))
      } else {
        updateLastAssistantMessage(m => ({
          ...m,
          content: err instanceof Error ? err.message : 'Failed to connect to agent',
          isStreaming: false,
          isError: true,
        }))
      }
    } finally {
      setIsStreaming(false)
      updateLastAssistantMessage(m => ({ ...m, isStreaming: false }))
      abortRef.current = null
    }
  }, [updateLastAssistantMessage])

  const submit = useCallback((overrideText?: string) => {
    const text = (overrideText ?? input).trim()
    if (!text || isStreaming) return

    setInput('')
    setShowPanel(true)

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      statusLines: [],
      isStreaming: false,
      isError: false,
    }
    setMessages(prev => [...prev, userMsg])

    const history = messages
      .filter(m => !m.isStreaming && !m.isError)
      .map(m => ({ role: m.role, content: m.content }))

    void streamResponse(text, history)
  }, [input, isStreaming, messages, streamResponse])

  // Re-run the last user turn after an error (or any time): drop the trailing
  // assistant bubble and regenerate from the same prompt + prior history.
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
    void streamResponse(userText, history)
  }, [isStreaming, messages, streamResponse])

  const stop = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const clearConversation = useCallback(() => {
    abortRef.current?.abort()
    setMessages([])
    setShowPanel(false)
  }, [])

  const value: ChatContextValue = {
    input, setInput, isStreaming, messages, showPanel, setShowPanel,
    submit, stop, retry, clearConversation,
  }

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>
}

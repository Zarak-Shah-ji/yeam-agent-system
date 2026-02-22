'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Search, Loader2, Bot, X, Wrench, ChevronRight } from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

type SSEEvent =
  | { type: 'routing'; message: string }
  | { type: 'agent'; name: string; message: string }
  | { type: 'tool_call'; tool: string }
  | { type: 'tool_result'; tool: string; count?: number }
  | { type: 'text'; content: string }
  | { type: 'done'; agentName: string }
  | { type: 'error'; message: string }

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  agentName?: string
  statusLines: string[]   // routing / tool call status shown above the bubble
  isStreaming: boolean
  isError: boolean
}

const AGENT_COLORS: Record<string, string> = {
  'front-desk':    'text-blue-600',
  'clinical-doc':  'text-green-600',
  'claim-scrubber':'text-orange-600',
  'billing':       'text-purple-600',
  'analytics':     'text-teal-600',
}

const AGENT_LABELS: Record<string, string> = {
  'front-desk':    'Front Desk',
  'clinical-doc':  'Clinical Doc',
  'claim-scrubber':'Claim Scrubber',
  'billing':       'Billing',
  'analytics':     'Analytics',
}

const TOOL_LABELS: Record<string, string> = {
  patient_lookup:     '🔍 Looking up patient...',
  appointment_list:   '📅 Fetching appointments...',
  appointment_cancel: '❌ Cancelling appointment...',
  insurance_verify:   '🛡 Verifying insurance...',
  claim_lookup:       '📋 Looking up claims...',
  metrics_query:      '📊 Running metrics query...',
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CommandBar() {
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [showPanel, setShowPanel] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  // ⌘K focus shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
        if (messages.length > 0) setShowPanel(true)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [messages.length])

  // Close panel on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setShowPanel(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Scroll to bottom on new content
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const updateLastAssistantMessage = (updater: (prev: Message) => Message) => {
    setMessages(prev => {
      const idx = [...prev].reverse().findIndex(m => m.role === 'assistant')
      if (idx === -1) return prev
      const realIdx = prev.length - 1 - idx
      const updated = [...prev]
      updated[realIdx] = updater(updated[realIdx])
      return updated
    })
  }

  const submit = useCallback(async () => {
    const text = input.trim()
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
    const assistantMsg: Message = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      statusLines: [],
      isStreaming: true,
      isError: false,
    }

    setMessages(prev => [...prev, userMsg, assistantMsg])
    setIsStreaming(true)

    // Build history from existing completed messages
    const history = messages
      .filter(m => !m.isStreaming && !m.isError)
      .map(m => ({ role: m.role, content: m.content }))

    try {
      const res = await fetch('/api/agents/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history }),
      })

      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status}`)
      }

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
                ...m, statusLines: [...m.statusLines, event.message]
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
                ...m, isStreaming: false, agentName: event.agentName
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
      updateLastAssistantMessage(m => ({
        ...m,
        content: err instanceof Error ? err.message : 'Failed to connect to agent',
        isStreaming: false,
        isError: true,
      }))
    } finally {
      setIsStreaming(false)
      updateLastAssistantMessage(m => ({ ...m, isStreaming: false }))
    }
  }, [input, isStreaming, messages])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
    if (e.key === 'Escape') { setShowPanel(false); inputRef.current?.blur() }
  }

  const clearConversation = () => {
    setMessages([])
    setShowPanel(false)
  }

  return (
    <div ref={panelRef} className="relative flex-1 max-w-2xl">
      {/* Input bar */}
      <div className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-1.5 shadow-sm focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500">
        {isStreaming
          ? <Loader2 className="h-4 w-4 text-blue-500 shrink-0 animate-spin" />
          : <Search className="h-4 w-4 text-gray-400 shrink-0" />
        }
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => { if (messages.length > 0) setShowPanel(true) }}
          placeholder="Ask the agent… (⌘K)"
          className="flex-1 bg-transparent text-sm text-gray-900 placeholder:text-gray-400 outline-none"
        />
        {isStreaming && <span className="text-xs text-blue-500 shrink-0 animate-pulse">thinking…</span>}
        {messages.length > 0 && !isStreaming && (
          <button
            onClick={clearConversation}
            className="text-gray-300 hover:text-gray-500 shrink-0"
            title="Clear conversation"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Chat panel */}
      {showPanel && messages.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 z-50 rounded-lg border border-gray-200 bg-white shadow-xl flex flex-col max-h-[480px]">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 shrink-0">
            <div className="flex items-center gap-1.5 text-xs text-gray-400">
              <Bot className="h-3.5 w-3.5" />
              <span>Agent conversation</span>
            </div>
            <button
              onClick={clearConversation}
              className="text-xs text-gray-400 hover:text-gray-600"
            >
              Clear
            </button>
          </div>

          {/* Messages */}
          <div className="overflow-y-auto flex-1 p-3 space-y-3">
            {messages.map(msg => (
              <div key={msg.id} className={msg.role === 'user' ? 'flex justify-end' : 'flex flex-col gap-1'}>
                {msg.role === 'user' ? (
                  <div className="bg-blue-600 text-white text-sm px-3 py-2 rounded-xl rounded-tr-sm max-w-[85%]">
                    {msg.content}
                  </div>
                ) : (
                  <>
                    {/* Status lines */}
                    {msg.statusLines.length > 0 && (
                      <div className="space-y-0.5">
                        {msg.statusLines.map((line, i) => (
                          <div key={i} className="flex items-center gap-1.5 text-xs text-gray-400">
                            {i < msg.statusLines.length - 1 || !msg.isStreaming
                              ? <ChevronRight className="h-3 w-3 shrink-0" />
                              : <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                            }
                            {line.includes('tool') || line.includes('🔍') || line.includes('📅') || line.includes('❌') || line.includes('🛡') || line.includes('📋') || line.includes('📊')
                              ? <span className="flex items-center gap-1"><Wrench className="h-3 w-3" />{line}</span>
                              : <span>{line}</span>
                            }
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Response bubble */}
                    {(msg.content || msg.isStreaming) && (
                      <div className={`text-sm px-3 py-2 rounded-xl rounded-tl-sm max-w-[90%] whitespace-pre-wrap ${
                        msg.isError
                          ? 'bg-red-50 text-red-700 border border-red-200'
                          : 'bg-gray-100 text-gray-900'
                      }`}>
                        {msg.content}
                        {msg.isStreaming && !msg.content && (
                          <span className="inline-flex gap-1">
                            <span className="animate-bounce" style={{ animationDelay: '0ms' }}>·</span>
                            <span className="animate-bounce" style={{ animationDelay: '150ms' }}>·</span>
                            <span className="animate-bounce" style={{ animationDelay: '300ms' }}>·</span>
                          </span>
                        )}
                        {msg.isStreaming && msg.content && (
                          <span className="inline-block w-0.5 h-3.5 bg-gray-400 ml-0.5 animate-pulse align-text-bottom" />
                        )}
                      </div>
                    )}

                    {/* Agent label */}
                    {msg.agentName && !msg.isStreaming && (
                      <span className={`text-xs ${AGENT_COLORS[msg.agentName] ?? 'text-gray-400'}`}>
                        {AGENT_LABELS[msg.agentName] ?? msg.agentName} Agent
                      </span>
                    )}
                  </>
                )}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {/* Footer hint */}
          <div className="border-t border-gray-100 px-3 py-1.5 shrink-0">
            <p className="text-xs text-gray-400">Press Enter to send · Esc to close · ⌘K to focus</p>
          </div>
        </div>
      )}
    </div>
  )
}

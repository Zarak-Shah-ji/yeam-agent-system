'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Search, Loader2, Bot, AlertTriangle, CheckCircle2 } from 'lucide-react'
import type { AgentName, AgentEventStatus } from '@/lib/agents/types'

interface ParsedEvent {
  taskId: string
  agentName: AgentName
  status: AgentEventStatus
  message: string
  data?: unknown
  confidence?: number
  reasoning?: string
  timestamp: string
}

export function CommandBar() {
  const [value, setValue] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [events, setEvents] = useState<ParsedEvent[]>([])
  const [showResults, setShowResults] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // ⌘K shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
        setShowResults(false)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const submit = useCallback(async () => {
    const intent = value.trim()
    if (!intent || isStreaming) return

    setEvents([])
    setIsStreaming(true)
    setShowResults(true)

    try {
      const res = await fetch('/api/agents/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intent }),
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
          try {
            const event = JSON.parse(raw) as ParsedEvent
            setEvents(prev => [...prev, event])
          } catch {
            // ignore parse errors
          }
        }
      }
    } catch (err) {
      setEvents(prev => [
        ...prev,
        {
          taskId: 'error',
          agentName: 'front-desk',
          status: 'error',
          message: err instanceof Error ? err.message : 'Failed to connect to agent',
          timestamp: new Date().toISOString(),
        } as ParsedEvent,
      ])
    } finally {
      setIsStreaming(false)
    }
  }, [value, isStreaming])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') submit()
    if (e.key === 'Escape') {
      setShowResults(false)
      inputRef.current?.blur()
    }
  }

  const lastEvent = events[events.length - 1]

  return (
    <div className="relative flex-1 max-w-2xl">
      <div className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-1.5 shadow-sm focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500">
        {isStreaming ? (
          <Loader2 className="h-4 w-4 text-blue-500 shrink-0 animate-spin" />
        ) : (
          <Search className="h-4 w-4 text-gray-400 shrink-0" />
        )}
        <input
          ref={inputRef}
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => events.length > 0 && setShowResults(true)}
          placeholder='Ask the agent… (⌘K)'
          className="flex-1 bg-transparent text-sm text-gray-900 placeholder:text-gray-400 outline-none"
        />
        {isStreaming && (
          <span className="text-xs text-blue-500 shrink-0">thinking…</span>
        )}
      </div>

      {/* Results dropdown */}
      {showResults && events.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 z-50 rounded-lg border border-gray-200 bg-white shadow-lg max-h-64 overflow-y-auto">
          {events.map((event, i) => (
            <div
              key={i}
              className="flex items-start gap-2 px-3 py-2.5 border-b border-gray-100 last:border-0"
            >
              <EventIcon status={event.status} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-gray-500 capitalize">
                    {event.agentName.replace('-', ' ')} agent
                  </span>
                  <StatusBadge status={event.status} />
                </div>
                <p className="text-sm text-gray-900 mt-0.5">{event.message}</p>
              </div>
            </div>
          ))}
          {!isStreaming && lastEvent?.status === 'complete' && (
            <div className="px-3 py-2 bg-gray-50 text-xs text-gray-400 text-right rounded-b-lg">
              Press Esc to close
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function EventIcon({ status }: { status: string }) {
  switch (status) {
    case 'thinking':
    case 'working':
      return <Loader2 className="h-3.5 w-3.5 text-blue-400 animate-spin mt-0.5 shrink-0" />
    case 'complete':
      return <CheckCircle2 className="h-3.5 w-3.5 text-green-500 mt-0.5 shrink-0" />
    case 'error':
    case 'escalated':
      return <AlertTriangle className="h-3.5 w-3.5 text-yellow-500 mt-0.5 shrink-0" />
    default:
      return <Bot className="h-3.5 w-3.5 text-gray-400 mt-0.5 shrink-0" />
  }
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    thinking: 'bg-blue-50 text-blue-600',
    working: 'bg-blue-50 text-blue-600',
    complete: 'bg-green-50 text-green-700',
    error: 'bg-red-50 text-red-600',
    escalated: 'bg-yellow-50 text-yellow-700',
  }
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${colors[status] ?? 'bg-gray-100 text-gray-500'}`}>
      {status}
    </span>
  )
}

'use client'

import { useState, useRef } from 'react'
import { Sparkles, Loader2, Bot } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent } from '@/components/ui/card'

const SUGGESTIONS = [
  'What was our denial rate last month?',
  'Which payer has the highest rejection rate?',
  'Show me top diagnoses by visit count',
  'How much AR is over 90 days?',
]

export function NLQueryBox() {
  const [query, setQuery] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [messages, setMessages] = useState<{ role: 'user' | 'agent'; text: string }[]>([])
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null)

  async function handleSubmit(text?: string) {
    const q = (text ?? query).trim()
    if (!q) return
    setMessages(prev => [...prev, { role: 'user', text: q }])
    setQuery('')
    setIsStreaming(true)

    try {
      const res = await fetch('/api/agents/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intent: 'query-metrics', context: { question: q } }),
      })
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)

      const reader = res.body.getReader()
      readerRef.current = reader
      const decoder = new TextDecoder()
      let buffer = ''
      let lastMsg = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const raw = line.slice(6).trim()
          if (raw === '[DONE]') continue
          try {
            const event = JSON.parse(raw)
            if (event.message) lastMsg = event.message
          } catch { /* ignore */ }
        }
      }

      if (lastMsg) {
        setMessages(prev => [...prev, { role: 'agent', text: lastMsg }])
      }
    } catch (err) {
      setMessages(prev => [...prev, { role: 'agent', text: err instanceof Error ? err.message : 'Error' }])
    } finally {
      setIsStreaming(false)
      readerRef.current = null
    }
  }

  return (
    <div className="space-y-3">
      {/* Suggestion chips */}
      <div className="flex flex-wrap gap-2">
        {SUGGESTIONS.map(s => (
          <button
            key={s}
            onClick={() => handleSubmit(s)}
            disabled={isStreaming}
            className="text-xs px-3 py-1.5 rounded-full bg-blue-50 text-blue-700 border border-blue-100 hover:bg-blue-100 transition-colors disabled:opacity-50"
          >
            {s}
          </button>
        ))}
      </div>

      {/* Conversation */}
      {messages.length > 0 && (
        <Card>
          <CardContent className="p-3 space-y-2 max-h-64 overflow-y-auto">
            {messages.map((m, i) => (
              <div key={i} className={`flex gap-2 text-sm ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {m.role === 'agent' && <Bot className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" />}
                <div className={`rounded-lg px-3 py-2 max-w-[85%] ${
                  m.role === 'user'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-800'
                }`}>
                  {m.text}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Input */}
      <div className="flex gap-2">
        <Textarea
          placeholder="Ask anything about your practice data…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit() } }}
          className="min-h-[72px] resize-none"
          disabled={isStreaming}
        />
        <Button
          onClick={() => handleSubmit()}
          disabled={isStreaming || !query.trim()}
          className="self-end"
        >
          {isStreaming
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : <Sparkles className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  )
}

'use client'

import { useEffect, useRef } from 'react'
import { Send, Square, Sparkles, Loader2 } from 'lucide-react'
import { useChat } from '@/components/layout/chat-context'

/**
 * The input at the bottom of the conversation.
 *
 * This is the only text input the agent has now. It used to double as the
 * trigger in the top bar, which is why it carried a magnifying glass and read
 * as a search box; the trigger is a button now (AgentTrigger), so this can look
 * like what it is.
 */
export function AgentComposer({
  autoFocus,
  hint,
}: {
  autoFocus?: boolean
  hint?: string
}) {
  const { input, setInput, isStreaming, submit, stop } = useChat()
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (autoFocus) requestAnimationFrame(() => ref.current?.focus())
  }, [autoFocus])

  // Grow with the content, up to a cap, then scroll.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }, [input])

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div>
      <div className="flex items-end gap-2 rounded-xl border border-gray-300 bg-white px-3 py-1.5 shadow-sm transition-shadow focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/40">
        {isStreaming
          ? <Loader2 className="mb-1.5 h-4 w-4 shrink-0 animate-spin text-blue-500" />
          : <Sparkles className="mb-1.5 h-4 w-4 shrink-0 text-blue-500" />
        }

        <textarea
          ref={ref}
          rows={1}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask about your denials…"
          aria-label="Ask the agent"
          className="max-h-[120px] flex-1 resize-none overflow-y-auto bg-transparent py-1 text-sm text-gray-900 outline-none placeholder:text-gray-400"
        />

        {isStreaming ? (
          <button
            onClick={stop}
            className="mb-0.5 shrink-0 rounded p-1 text-red-500 transition-colors hover:bg-red-50"
            title="Stop generating"
            aria-label="Stop generating"
          >
            <Square className="h-3.5 w-3.5 fill-current" />
          </button>
        ) : (
          <button
            onClick={() => submit()}
            disabled={!input.trim()}
            className="mb-1 shrink-0 rounded p-0.5 text-gray-400 transition-colors hover:text-blue-600 disabled:opacity-30"
            title="Send"
            aria-label="Send message"
          >
            <Send className="h-4 w-4" />
          </button>
        )}
      </div>

      {hint && <p className="mt-1.5 px-1 text-xs text-gray-400">{hint}</p>}
    </div>
  )
}

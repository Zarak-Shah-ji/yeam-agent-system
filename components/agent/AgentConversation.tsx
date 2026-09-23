'use client'

import { useEffect, useRef } from 'react'
import { RotateCw, Sparkles, Loader2 } from 'lucide-react'
import { useChat } from '@/components/layout/chat-context'
import { trpc } from '@/lib/trpc/client'
import { MarkdownMessage } from '@/components/layout/MarkdownMessage'
import { ReasoningTrace } from './ReasoningTrace'

/**
 * The message list. Rendered identically in the rail and in the overlay — one
 * component, so the two surfaces cannot drift into showing different things
 * about the same turn.
 */

/**
 * The first three ask about the queue itself and hold in any workspace.
 *
 * The fourth used to be "How is Aetna doing versus the rest?" — hardcoded. A
 * workspace with no Aetna got an honest empty tool result and an answer saying
 * there was no such data, which reads as the assistant refusing to help. It was
 * the product suggesting a question it had already guaranteed would fail.
 */
const STARTERS = [
  'What should I work on first?',
  'Which denial reason is costing us the most?',
  'What expires in the next 7 days?',
]

/** Falls back to a payer-free comparison when the workspace has no denials yet. */
function payerStarter(topPayer: string | null | undefined): string {
  return topPayer
    ? `How is ${topPayer} doing versus the rest?`
    : 'Which payer denies the most of our claims?'
}

export function AgentConversation() {
  const {
    messages, isStreaming, retry, submit, isLoadingConversation,
  } = useChat()

  // Only needed for the empty state, so a failure here costs a tailored
  // suggestion and nothing else — the fallback question is always valid.
  const starters = trpc.worklist.starters.useQuery(undefined, { retry: false })

  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Follow the stream only when the user is already near the bottom, so
  // scrolling up to re-read an earlier answer isn't yanked back down.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 120) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages])

  if (isLoadingConversation) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
      </div>
    )
  }

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 flex-col justify-end overflow-y-auto p-4">
        <div className="mb-3 flex items-center gap-2 text-sm text-gray-500">
          <Sparkles className="h-4 w-4 shrink-0 text-blue-500" />
          <span>Ask about this workspace&rsquo;s denials and A/R.</span>
        </div>
        <div className="space-y-1.5">
          {[...STARTERS, payerStarter(starters.data?.topPayer)].map(starter => (
            <button
              key={starter}
              onClick={() => submit(starter)}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-left text-sm text-gray-700 transition-colors hover:border-gray-300 hover:bg-gray-50"
            >
              {starter}
            </button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4" aria-live="polite">
      {messages.map(msg =>
        msg.role === 'user' ? (
          <div key={msg.id} className="flex justify-end">
            <div className="max-w-[85%] whitespace-pre-wrap rounded-xl rounded-tr-sm bg-blue-600 px-3 py-2 text-sm text-white">
              {msg.content}
            </div>
          </div>
        ) : (
          <div key={msg.id} className="flex flex-col">
            <ReasoningTrace
              steps={msg.trace}
              pending={msg.pending}
              isStreaming={msg.isStreaming}
            />

            {msg.status && !msg.content && (
              <p className="flex items-center gap-1.5 text-xs text-gray-400">
                <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
                {msg.status}
              </p>
            )}

            {(msg.content || msg.isStreaming) && (
              <div
                className={`max-w-[92%] rounded-xl rounded-tl-sm px-3 py-2 text-sm ${
                  msg.isError
                    ? 'border border-red-200 bg-red-50 text-red-700'
                    : 'bg-gray-100 text-gray-900'
                }`}
              >
                {msg.isError || msg.isStreaming ? (
                  // Raw text while streaming: half-parsed markdown flickers.
                  <span className="whitespace-pre-wrap">{msg.content}</span>
                ) : (
                  <MarkdownMessage content={msg.content} />
                )}
                {msg.isStreaming && msg.content && (
                  <span className="ml-0.5 inline-block h-3.5 w-0.5 animate-pulse bg-gray-400 align-text-bottom" />
                )}
              </div>
            )}

            {msg.isError && !isStreaming && (
              <button
                onClick={retry}
                className="mt-1 flex items-center gap-1 self-start text-xs text-blue-600 hover:text-blue-700"
              >
                <RotateCw className="h-3 w-3" /> Retry
              </button>
            )}
          </div>
        ),
      )}
      <div ref={bottomRef} />
    </div>
  )
}

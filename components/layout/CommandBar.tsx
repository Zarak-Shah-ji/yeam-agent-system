'use client'

import { useRef, useEffect, useSyncExternalStore } from 'react'
import { Search, Loader2, Bot, X, Wrench, ChevronRight, Send, Square, RotateCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useChat } from './chat-context'
import { MarkdownMessage } from './MarkdownMessage'

// ─── Display maps ───────────────────────────────────────────────────────────

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

const isToolStatus = (line: string) =>
  ['tool', '🔍', '📅', '❌', '🛡', '📋', '📊'].some(t => line.includes(t))

// Platform-aware shortcut hint, read without a hydration mismatch:
// server renders ⌘K, the client reconciles to "Ctrl K" on non-Mac.
const noopSubscribe = () => () => {}
const getShortcut = () => (/Mac|iPhone|iPad|iPod/i.test(navigator.userAgent) ? '⌘K' : 'Ctrl K')
const getServerShortcut = () => '⌘K'

// ─── Component ────────────────────────────────────────────────────────────────

export function CommandBar({ className }: { className?: string }) {
  const {
    input, setInput, isStreaming, messages, showPanel, setShowPanel,
    submit, stop, retry, clearConversation,
  } = useChat()

  const inputRef = useRef<HTMLTextAreaElement>(null)
  const overlayInputRef = useRef<HTMLTextAreaElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const shortcut = useSyncExternalStore(noopSubscribe, getShortcut, getServerShortcut)

  // ⌘K / Ctrl+K focus shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        if (messages.length > 0) {
          setShowPanel(true)
          requestAnimationFrame(() => overlayInputRef.current?.focus())
        } else {
          inputRef.current?.focus()
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [messages.length, setShowPanel])

  // Focus the overlay input + lock body scroll while the overlay is open
  useEffect(() => {
    if (!showPanel) return
    requestAnimationFrame(() => overlayInputRef.current?.focus())
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [showPanel])

  // Auto-grow the textarea(s) with content; reset cleanly when cleared.
  useEffect(() => {
    for (const el of [inputRef.current, overlayInputRef.current]) {
      if (!el) continue
      el.style.height = 'auto'
      el.style.height = `${Math.min(el.scrollHeight, 120)}px`
    }
  }, [input, showPanel])

  // Smarter autoscroll: only follow the stream if the user is near the bottom,
  // so scrolling up to read earlier messages isn't yanked back down.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    if (nearBottom) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends; Shift+Enter inserts a newline (textarea default).
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
    else if (e.key === 'Escape') {
      setShowPanel(false)
      inputRef.current?.blur()
      overlayInputRef.current?.blur()
    }
  }

  // Shared "Ask the agent" input bar — used both as the trigger and at the
  // bottom of the conversation overlay.
  const renderInputBar = (
    ref: React.RefObject<HTMLTextAreaElement | null>,
    opts?: { autoOpenOnFocus?: boolean },
  ) => (
    <div className="flex items-end gap-2 rounded-lg border border-gray-300 bg-white px-3 py-1.5 shadow-sm focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500">
      {isStreaming
        ? <Loader2 className="h-4 w-4 text-blue-500 shrink-0 animate-spin mb-1.5" />
        : <Search className="h-4 w-4 text-gray-400 shrink-0 mb-1.5" />
      }
      <textarea
        ref={ref}
        rows={1}
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => { if (opts?.autoOpenOnFocus && messages.length > 0) setShowPanel(true) }}
        placeholder={`Ask the agent... (${shortcut})`}
        className="flex-1 resize-none bg-transparent py-1 text-sm text-gray-900 placeholder:text-gray-400 outline-none max-h-[120px] overflow-y-auto"
      />
      {isStreaming && <span className="text-xs text-blue-500 shrink-0 animate-pulse mb-1.5">thinking...</span>}
      {messages.length > 0 && !isStreaming && (
        <button
          onClick={clearConversation}
          className="text-gray-300 hover:text-gray-500 shrink-0 mb-1.5"
          title="Clear conversation"
          aria-label="Clear conversation"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
      {isStreaming ? (
        <button
          onClick={stop}
          className="shrink-0 rounded p-1 text-red-500 hover:bg-red-50 transition-colors mb-0.5"
          title="Stop generating"
          aria-label="Stop generating"
        >
          <Square className="h-3.5 w-3.5 fill-current" />
        </button>
      ) : (
        <button
          onClick={() => submit()}
          disabled={!input.trim()}
          className="shrink-0 rounded p-0.5 text-gray-400 hover:text-blue-600 disabled:opacity-30 transition-colors mb-1"
          title="Send"
          aria-label="Send message"
        >
          <Send className="h-4 w-4" />
        </button>
      )}
    </div>
  )

  return (
    <>
      {/* Trigger input bar (lives in the top bar / hero) */}
      <div className={cn("relative flex-1 max-w-2xl", className)}>
        {renderInputBar(inputRef, { autoOpenOnFocus: true })}
      </div>

      {/* Agent conversation overlay — modal/drawer covering the content area.
          Full-screen on mobile, centered drawer from sm upward. */}
      {showPanel && messages.length > 0 && (
        <div
          className="fixed inset-0 z-50 flex justify-center sm:items-center sm:p-4 md:p-6"
          role="dialog"
          aria-modal="true"
          aria-label="Agent conversation"
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/30 backdrop-blur-sm"
            onClick={() => setShowPanel(false)}
          />

          {/* Panel */}
          <div className="relative z-10 flex h-full w-full flex-col overflow-hidden border-gray-200 bg-white shadow-2xl sm:h-[85vh] sm:max-w-3xl sm:rounded-2xl sm:border">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 shrink-0">
              <div className="flex items-center gap-1.5 text-sm font-medium text-gray-600">
                <Bot className="h-4 w-4 text-blue-600" />
                <span>Agent conversation</span>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={clearConversation}
                  className="text-xs text-gray-400 hover:text-gray-600"
                >
                  Clear
                </button>
                <button
                  onClick={() => setShowPanel(false)}
                  className="text-gray-400 hover:text-gray-600"
                  title="Close (Esc)"
                  aria-label="Close conversation"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Messages — fills the middle, scrolls */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3" aria-live="polite">
              {messages.map(msg => (
                <div key={msg.id} className={msg.role === 'user' ? 'flex justify-end' : 'flex flex-col gap-1'}>
                  {msg.role === 'user' ? (
                    <div className="bg-blue-600 text-white text-sm px-3 py-2 rounded-xl rounded-tr-sm max-w-[85%] whitespace-pre-wrap">
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
                              {isToolStatus(line)
                                ? <span className="flex items-center gap-1"><Wrench className="h-3 w-3" />{line}</span>
                                : <span>{line}</span>
                              }
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Response bubble */}
                      {(msg.content || msg.isStreaming) && (
                        <div className={`text-sm px-3 py-2 rounded-xl rounded-tl-sm max-w-[90%] ${
                          msg.isError
                            ? 'bg-red-50 text-red-700 border border-red-200'
                            : 'bg-gray-100 text-gray-900'
                        }`}>
                          {msg.isError || msg.isStreaming ? (
                            // Raw text while streaming (avoids flicker from
                            // half-parsed markdown) and for errors.
                            <span className="whitespace-pre-wrap">{msg.content}</span>
                          ) : (
                            <MarkdownMessage content={msg.content} />
                          )}
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

                      {/* Retry on error */}
                      {msg.isError && !isStreaming && (
                        <button
                          onClick={retry}
                          className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 mt-0.5"
                        >
                          <RotateCw className="h-3 w-3" /> Retry
                        </button>
                      )}

                      {/* Agent label */}
                      {msg.agentName && !msg.isStreaming && !msg.isError && (
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

            {/* Input bar pinned to the bottom of the conversation */}
            <div className="border-t border-gray-100 p-3 shrink-0">
              {renderInputBar(overlayInputRef)}
              <p className="mt-1.5 px-1 text-xs text-gray-400">
                Enter to send · Shift+Enter for newline · Esc to close · {shortcut} to focus
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

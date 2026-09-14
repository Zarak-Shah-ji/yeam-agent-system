'use client'

import { useEffect, useSyncExternalStore } from 'react'
import { Sparkles, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useChat } from '@/components/layout/chat-context'

/**
 * The one way into the agent from the chrome.
 *
 * What was here before was a full-width textarea with a magnifying glass in it,
 * which read as a search box and took most of the top bar to say so. A button
 * costs ~140px, cannot be mistaken for search, and leaves the bar to the page.
 *
 * It also absorbs the old Bot toggle: there were two agent affordances in this
 * bar that opened different things.
 */

// Platform-aware shortcut hint, read without a hydration mismatch: the server
// renders ⌘K and the client reconciles to Ctrl K off a Mac.
const noopSubscribe = () => () => {}
const getShortcut = () => (/Mac|iPhone|iPad|iPod/i.test(navigator.userAgent) ? '⌘K' : 'Ctrl K')
const getServerShortcut = () => '⌘K'

export function AgentTrigger() {
  const { surface, openRail, closeChat, isStreaming } = useChat()
  const shortcut = useSyncExternalStore(noopSubscribe, getShortcut, getServerShortcut)

  // ⌘K opens the rail and lands in the composer. When the agent is already
  // open it closes again, so the same key gets out of the way.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        if (surface === 'closed') openRail()
        else closeChat()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [surface, openRail, closeChat])

  const isOpen = surface !== 'closed'

  return (
    <button
      onClick={() => (isOpen ? closeChat() : openRail())}
      aria-expanded={isOpen}
      title={isOpen ? 'Close the agent' : 'Ask the agent'}
      className={cn(
        'ml-auto flex shrink-0 items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm transition-colors',
        isOpen
          ? 'border-blue-200 bg-blue-50 text-blue-700'
          : 'border-gray-300 bg-white text-gray-600 hover:border-gray-400 hover:text-gray-900',
      )}
    >
      {/* The spinner is the whole reason this stays visible while the rail is
          open: an answer can still be streaming behind a closed rail. */}
      {isStreaming
        ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-blue-500" />
        : <Sparkles className="h-4 w-4 shrink-0 text-blue-500" />
      }
      <span className="hidden sm:inline">{isStreaming ? 'Thinking…' : 'Ask agent'}</span>
      <kbd className="hidden rounded border border-gray-200 bg-gray-50 px-1 py-0.5 font-sans text-xs text-gray-400 md:inline">
        {shortcut}
      </kbd>
    </button>
  )
}

'use client'

import { useEffect } from 'react'
import { Sparkles, Plus, Minimize2, X } from 'lucide-react'
import { useChat } from '@/components/layout/chat-context'
import { AgentConversation } from './AgentConversation'
import { AgentComposer } from './AgentComposer'
import { ConversationHistory } from './ConversationHistory'

/**
 * The conversation, expanded over a blurred workspace.
 *
 * Reached from the rail's expand button rather than appearing on its own the
 * moment you send something — the old behaviour, which put a modal between a
 * biller and the table they had just asked about. Same thread as the rail, with
 * room for the history list beside it.
 *
 * Minimize returns to the rail; closing hides the agent entirely.
 */
export function AgentOverlay() {
  const { surface, closeChat, openRail, newConversation } = useChat()
  const isOpen = surface === 'overlay'

  // Esc closes, and the workspace behind must not scroll under the backdrop.
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') openRail() }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [isOpen, openRail])

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex justify-center sm:items-center sm:p-4 md:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Agent conversation"
    >
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={openRail}
      />

      <div className="relative z-10 flex h-full w-full flex-col overflow-hidden border-gray-200 bg-white shadow-2xl sm:h-[85vh] sm:max-w-4xl sm:rounded-2xl sm:border">
        <div className="flex h-12 shrink-0 items-center gap-1.5 border-b border-gray-200 px-4">
          <Sparkles className="h-4 w-4 shrink-0 text-blue-500" />
          <span className="text-sm font-medium text-gray-900">Agent</span>

          <div className="ml-auto flex items-center gap-0.5">
            <button
              onClick={newConversation}
              title="New conversation"
              aria-label="New conversation"
              className="rounded p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
            >
              <Plus className="h-4 w-4" />
            </button>
            <button
              onClick={openRail}
              title="Collapse to the rail (Esc)"
              aria-label="Collapse to the rail"
              className="rounded p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
            >
              <Minimize2 className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={closeChat}
              title="Close"
              aria-label="Close agent"
              className="rounded p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* The width to show the history beside the thread only exists here;
              in the rail it is a tab. */}
          <div className="hidden w-56 shrink-0 flex-col border-r border-gray-200 bg-gray-50 md:flex">
            <p className="px-3 py-2 text-xs font-medium text-gray-400">Conversations</p>
            <ConversationHistory onPick={() => {}} />
          </div>

          <div className="flex min-w-0 flex-1 flex-col">
            <AgentConversation />
            <div className="shrink-0 border-t border-gray-200 p-3">
              <AgentComposer
                autoFocus
                hint="Enter to send · Shift+Enter for a newline · Esc to collapse"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

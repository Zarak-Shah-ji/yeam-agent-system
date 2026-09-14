'use client'

import { useState } from 'react'
import { Sparkles, Plus, Maximize2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useChat } from '@/components/layout/chat-context'
import { AgentConversation } from './AgentConversation'
import { AgentComposer } from './AgentComposer'
import { ConversationHistory } from './ConversationHistory'
import { AgentActivityFeed } from './AgentActivityFeed'

/**
 * The agent's home: a rail on the right of the workspace.
 *
 * It replaces three separate things — a search-shaped input in the top bar, a
 * Bot toggle that opened an unrelated activity panel, and a modal that only
 * appeared after you had already sent something. One surface, three tabs, and
 * the conversation sits beside the worklist instead of covering it, which is
 * the point: the answer is about the rows on screen.
 *
 * The modal is still here (AgentOverlay) as an explicit expand, for reading a
 * long answer. Both render the same components.
 */

type Tab = 'chat' | 'history' | 'activity'

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'chat', label: 'Chat' },
  { id: 'history', label: 'History' },
  { id: 'activity', label: 'Activity' },
]

export function AgentRail() {
  const { surface, closeChat, openOverlay, newConversation } = useChat()
  const [tab, setTab] = useState<Tab>('chat')

  if (surface !== 'rail') return null

  return (
    <>
      {/* Below xl the rail floats: a 380px column taken out of a laptop screen
          leaves the worklist table unreadable. */}
      <div
        className="fixed inset-0 z-30 bg-black/20 xl:hidden"
        onClick={closeChat}
        aria-hidden
      />

      <aside
        className="fixed right-0 top-14 bottom-0 z-40 flex w-[min(24rem,100vw)] flex-col overflow-hidden border-l border-gray-200 bg-white shadow-xl xl:static xl:z-auto xl:w-[23rem] xl:shadow-none"
        aria-label="Agent"
      >
        <div className="flex h-12 shrink-0 items-center gap-1 border-b border-gray-200 px-3">
          <Sparkles className="h-4 w-4 shrink-0 text-blue-500" />
          <span className="text-sm font-medium text-gray-900">Agent</span>

          <div className="ml-auto flex items-center gap-0.5">
            <button
              onClick={() => { newConversation(); setTab('chat') }}
              title="New conversation"
              aria-label="New conversation"
              className="rounded p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
            >
              <Plus className="h-4 w-4" />
            </button>
            <button
              onClick={openOverlay}
              title="Expand"
              aria-label="Expand conversation"
              className="rounded p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
            >
              <Maximize2 className="h-3.5 w-3.5" />
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

        <div className="flex shrink-0 gap-4 border-b border-gray-200 px-3" role="tablist">
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={cn(
                '-mb-px border-b-2 py-2 text-sm transition-colors',
                tab === id
                  ? 'border-blue-600 font-medium text-blue-700'
                  : 'border-transparent text-gray-500 hover:text-gray-800',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'chat' && (
          <>
            <AgentConversation />
            <div className="shrink-0 border-t border-gray-200 p-3">
              <AgentComposer autoFocus />
            </div>
          </>
        )}

        {/* Picking a conversation drops you into it, which is the only reason
            you opened the list. */}
        {tab === 'history' && <ConversationHistory onPick={() => setTab('chat')} />}

        {tab === 'activity' && <AgentActivityFeed />}
      </aside>
    </>
  )
}

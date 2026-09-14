'use client'

import { isToday, isYesterday, subDays } from 'date-fns'
import { MessageSquare, Trash2, Loader2 } from 'lucide-react'
import { trpc } from '@/lib/trpc/client'
import { useChat } from '@/components/layout/chat-context'
import { cn } from '@/lib/utils'

/**
 * Past conversations, newest first, grouped the way every chat product groups
 * them — because a biller looking for "the one about the Aetna timely filing
 * batch" is remembering roughly when, not what they titled it.
 */

// `lastMessageAt` is a string, not a Date: there is no superjson transformer on
// the tRPC link (see lib/trpc/provider.tsx), so dates arrive as ISO strings.
type Conversation = { id: string; title: string; lastMessageAt: string }

const GROUPS: Array<{ label: string; matches: (d: Date, now: Date) => boolean }> = [
  { label: 'Today', matches: d => isToday(d) },
  { label: 'Yesterday', matches: d => isYesterday(d) },
  { label: 'Previous 7 days', matches: (d, now) => d >= subDays(now, 7) },
  { label: 'Older', matches: () => true },
]

function group(conversations: Conversation[]): Array<{ label: string; items: Conversation[] }> {
  const now = new Date()
  const buckets = GROUPS.map(g => ({ label: g.label, items: [] as Conversation[] }))

  for (const conversation of conversations) {
    const at = new Date(conversation.lastMessageAt)
    // First match wins, and the last group matches everything, so a conversation
    // lands in exactly one bucket.
    const idx = GROUPS.findIndex(g => g.matches(at, now))
    buckets[idx].items.push(conversation)
  }

  return buckets.filter(b => b.items.length > 0)
}

export function ConversationHistory({ onPick }: { onPick: () => void }) {
  const { conversationId, loadConversation, newConversation } = useChat()
  const utils = trpc.useUtils()
  const { data, isLoading } = trpc.agent.conversations.useQuery()

  const remove = trpc.agent.deleteConversation.useMutation({
    onSuccess: (_result, variables) => {
      void utils.agent.conversations.invalidate()
      // Deleting the thread that is on screen leaves the pane showing messages
      // that no longer exist anywhere.
      if (variables.id === conversationId) newConversation()
    },
  })

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
      </div>
    )
  }

  if (!data || data.length === 0) {
    return (
      <p className="p-4 text-center text-xs text-gray-400">
        No conversations yet. Ask the agent something and it will show up here.
      </p>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-2">
      {group(data).map(({ label, items }) => (
        <div key={label} className="mb-3">
          <p className="px-2 py-1 text-xs font-medium text-gray-400">{label}</p>
          <ul className="space-y-0.5">
            {items.map(conversation => (
              <li key={conversation.id} className="group/row relative">
                <button
                  onClick={() => {
                    loadConversation(conversation.id)
                    onPick()
                  }}
                  className={cn(
                    'w-full truncate rounded-md py-2 pl-2 pr-8 text-left text-sm transition-colors',
                    conversation.id === conversationId
                      ? 'bg-blue-50 text-blue-700'
                      : 'text-gray-700 hover:bg-gray-100',
                  )}
                >
                  <MessageSquare className="mr-2 inline h-3.5 w-3.5 shrink-0 align-[-2px] text-gray-400" />
                  {conversation.title}
                </button>
                <button
                  onClick={() => remove.mutate({ id: conversation.id })}
                  disabled={remove.isPending}
                  title="Delete conversation"
                  aria-label={`Delete conversation: ${conversation.title}`}
                  className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-gray-300 opacity-0 transition-opacity hover:bg-gray-200 hover:text-red-600 focus:opacity-100 group-hover/row:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

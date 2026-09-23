'use client'

import { Building2 } from 'lucide-react'
import { trpc } from '@/lib/trpc/client'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

/**
 * Which clinic you are looking at.
 *
 * ── One control, two places ──────────────────────────────────────────────────
 *
 * This renders in the top bar and again above the worklist table, and both
 * write the SAME state — `User.activePracticeId`, through practices.setActive.
 * They are not a "context" and a "filter" that happen to look alike.
 *
 * Two independent controls was the obvious design and it is wrong: a switcher
 * reading Riverside beside a filter reading Oakwood is an empty table under a
 * strip that says Riverside, and nothing on screen explains it. With one piece
 * of state that is unrepresentable.
 *
 * The consequence to be honest about is that the filter above the table is not
 * a local filter — changing it changes Analytics and Claims too. That is why
 * the top bar tints whenever a practice is isolated: the scope is global, so
 * the indicator has to be somewhere always visible, not on the page that
 * happens to have set it.
 *
 * ── Why the whole cache invalidates ──────────────────────────────────────────
 *
 * Every section reads through practiceProcedure, so switching changes every
 * number in the app. Invalidating all of it is correct rather than lazy: a
 * hand-written list of queries to invalidate is a list that goes stale the next
 * time someone adds a section, and the symptom would be a stale total under a
 * new clinic's name.
 */
export function PracticeSwitcher({
  className,
  compact = false,
}: {
  className?: string
  /** Top-bar rendering: no label, narrower, transparent. */
  compact?: boolean
}) {
  const utils = trpc.useUtils()
  const list = trpc.practices.list.useQuery()
  const setActive = trpc.practices.setActive.useMutation({
    onSuccess: () => utils.invalidate(),
  })

  const practices = list.data?.practices ?? []
  const live = practices.filter(p => !p.archived)

  // A workspace with no practices, or with exactly one and nothing unfiled, has
  // nothing to switch between. Rendering a dropdown with a single option would
  // be furniture that asks a question with one answer — and Phase 2 established
  // that anything in the chrome costs the queue below it.
  const worthShowing = live.length > 1 || (live.length === 1 && (list.data?.unfiled ?? 0) > 0)
  if (!worthShowing) return null

  // The stored value may name an archived practice. The server has already
  // widened to combined for every query; showing "All practices" here is what
  // makes the menu agree with the rows.
  const activeId = list.data?.activePracticeId ?? null
  const isLive = activeId !== null && live.some(p => p.id === activeId)
  const value = isLive ? activeId! : 'all'

  return (
    <div className={cn('flex items-center gap-2', className)}>
      {!compact && (
        <label className="text-xs font-medium text-gray-500" htmlFor="practice-switcher">
          Practice
        </label>
      )}
      <Select
        value={value}
        onValueChange={next =>
          setActive.mutate({ practiceId: next === 'all' ? null : next })
        }
      >
        <SelectTrigger
          id="practice-switcher"
          aria-label="Which practice to show"
          className={cn(
            compact
              ? 'h-8 w-auto gap-1.5 border-transparent bg-transparent px-2 text-xs font-medium shadow-none'
              : 'h-8 w-48 text-xs',
          )}
        >
          {compact && <Building2 className="h-3.5 w-3.5 shrink-0 text-gray-500" />}
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All practices</SelectItem>
          {live.map(p => (
            <SelectItem key={p.id} value={p.id}>
              {/* The open-row count is the reason to open this menu at all: it
                  says where the work is before you commit to looking. */}
              {p.name} · {p.openRows}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

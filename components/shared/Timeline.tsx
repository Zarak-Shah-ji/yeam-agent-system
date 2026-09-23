import { format } from 'date-fns'

/**
 * Everything that has happened to one claim, rendered once.
 *
 * Two surfaces show this list — the claim detail dialog on /claims and the work
 * panel on the worklist — and they show it from the same builder
 * (lib/claims/timeline.ts) over the same four sources. They were drifting
 * before this existed: one of them printed an actor, the other did not; one
 * said "Sent by fax", the other would have invented its own wording.
 *
 * Presentation only. The merging, the ordering and every label live in the pure
 * module, so what a row says is testable without rendering anything.
 */

export type TimelineItem = {
  at: Date | string
  /** Short label for the left column. */
  label: string
  /** The specifics, when there are any. */
  detail: string | null
  /** A person's name, where the event recorded one. */
  actor?: string | null
}

function day(value: Date | string): string {
  const d = typeof value === 'string' ? new Date(value) : value
  return Number.isNaN(d.getTime()) ? '—' : format(d, 'MMM d, yyyy')
}

export function Timeline({
  entries,
  /** What to say when nothing has happened yet. Nothing is rendered without it. */
  empty,
}: {
  entries: TimelineItem[]
  empty?: string
}) {
  if (entries.length === 0) {
    return empty ? <p className="text-sm text-gray-500">{empty}</p> : null
  }

  return (
    <ul className="space-y-1.5">
      {entries.map((entry, i) => (
        <li key={i} className="flex gap-3 text-sm">
          {/*
            A fixed-width date column rather than an inline date: the question
            this list answers is "how often have we chased this", and a ragged
            left edge makes that a reading exercise instead of a glance.
          */}
          <span className="w-24 shrink-0 text-xs text-gray-500">{day(entry.at)}</span>
          <span className="min-w-0">
            <span className="text-gray-900">{entry.label}</span>
            {entry.detail && <span className="text-gray-500"> — {entry.detail}</span>}
            {entry.actor && <span className="text-gray-400"> · {entry.actor}</span>}
          </span>
        </li>
      ))}
    </ul>
  )
}

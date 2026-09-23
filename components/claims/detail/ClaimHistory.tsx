'use client'

import { useState } from 'react'
import { Timeline } from '@/components/shared/Timeline'
import type { ClaimDetail } from './types'

/** How much history is worth showing before it becomes a scroll. */
const RECENT = 3

/**
 * What has actually been done to this claim, newest first.
 *
 * WHY THIS IS NOW COLLAPSED, having argued the opposite. It used to render
 * above the sections, open, on the grounds that "has anyone already chased
 * this" decides whether the rest of the record is worth reading — which is
 * still true, and is exactly why the answer moved to the headline as one clause
 * (see MoneyLine). What stayed behind is the list, and a list is a different
 * thing from an answer: it is read when the clause is not enough, which is
 * during a reconciliation and not during a triage.
 *
 * So the question is answered before this is reached, and this is now what it
 * always was underneath — the evidence for the clause, one click away.
 *
 * Still only the most recent few when opened. A claim chased weekly for three
 * months has a timeline longer than everything else on screen put together, and
 * the fourteenth entry has never once changed what someone did next.
 */
export function ClaimHistory({
  claim,
  onOpen,
}: {
  claim: ClaimDetail
  /** Fired when the list is expanded. See components/shared/use-usage.ts. */
  onOpen?: () => void
}) {
  const [all, setAll] = useState(false)

  const entries = all ? claim.timeline : claim.timeline.slice(0, RECENT)
  const hidden = claim.timeline.length - entries.length

  return (
    <details
      className="rounded-md border border-gray-200"
      onToggle={e => {
        if (e.currentTarget.open) onOpen?.()
      }}
    >
      <summary className="flex cursor-pointer list-none items-baseline gap-2 px-3 py-2.5 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
        <span className="text-xs font-medium uppercase tracking-wide text-gray-500">History</span>
        <span className="text-sm text-gray-700">
          {claim.timeline.length} {claim.timeline.length === 1 ? 'entry' : 'entries'}
          {claim.submissionCount > 0 &&
            ` · ${claim.submissionCount} follow-up${claim.submissionCount === 1 ? '' : 's'} sent`}
        </span>
      </summary>

      <div className="px-3 py-3">
        <Timeline entries={entries} empty="Nothing has happened to this claim yet." />

        {hidden > 0 && (
          <button
            type="button"
            onClick={() => setAll(true)}
            className="mt-1.5 text-xs font-medium text-blue-600 underline"
          >
            {hidden} earlier {hidden === 1 ? 'entry' : 'entries'}
          </button>
        )}
      </div>
    </details>
  )
}

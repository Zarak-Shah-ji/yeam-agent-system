'use client'

import { Send } from 'lucide-react'
import { trpc } from '@/lib/trpc/client'
import { OutcomePanel } from './OutcomePanel'

/**
 * Every attempt at this claim, and what came back from each.
 *
 * This block used to live inside RowDetail — which is to say, inside the FIRST
 * section of a panel that scrolled, while being the LAST thing that happens to
 * a claim. Someone who had just recorded a letter as sent had to scroll back up
 * past the letter and the score breakdown to find the form that closes the loop.
 * It is its own pane now, at the end, where the work actually ends.
 *
 * It runs the submissions query itself rather than taking a list as a prop.
 * That is not a second fetch: WorkPanel asks the same question to decide whether
 * this pane is reachable at all, and react-query serves both from one cache
 * entry under one key. Passing the array down instead would have made the pane's
 * content depend on a prop drilled through a component that has no other use
 * for it.
 *
 * Each attempt keeps its own ruling. A first-level appeal that lost and a
 * second-level one that won are both true, and a row-level outcome column could
 * only ever hold one of them — see OutcomePanel.tsx.
 */
export function OutcomeList({
  rowId,
  onRecorded,
}: {
  rowId: string
  /** The queue's numbers move when a ruling lands, so the table is told. */
  onRecorded: () => void
}) {
  const submissions = trpc.worklist.submissions.useQuery({ rowId })
  const sent = submissions.data ?? []

  if (submissions.isLoading) {
    return <p className="text-sm text-gray-500">Loading what has gone out…</p>
  }

  /*
    Reachable but empty is a real state, not an error.

    The pane is gated on a submission existing, so this shows only in the gap
    between recording one and the query catching up — and in that second the
    honest thing on screen is a sentence, not a spinner that suggests something
    is broken.
  */
  if (sent.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-gray-300 px-3 py-6 text-center text-sm text-gray-500">
        Nothing has gone to the payer yet. Record a submission on the Send step and it will
        appear here, waiting for its ruling.
      </p>
    )
  }

  return (
    <div>
      <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-gray-500">
        <Send className="h-3.5 w-3.5" aria-hidden="true" />
        Submitted
      </p>
      <ul className="mt-2 space-y-2">
        {sent.map(s => (
          <OutcomePanel
            key={s.id}
            submission={s}
            onRecorded={() => {
              void submissions.refetch()
              onRecorded()
            }}
          />
        ))}
      </ul>
    </div>
  )
}

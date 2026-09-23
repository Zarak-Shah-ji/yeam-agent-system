'use client'

import { format } from 'date-fns'
import { ChevronRight } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ViewToggle, useAnalyticsView } from '@/components/charts/ViewToggle'
import { AgingChart } from '@/components/insights/AgingChart'
import { usd } from '@/lib/charts/format'
import type { AgingBucket } from '@/lib/insights/aggregate'
import { cn } from '@/lib/utils'

const AGING_LABEL: Record<string, string> = {
  '0-30': '0–30 days',
  '31-60': '31–60 days',
  '61-90': '61–90 days',
  '91-120': '91–120 days',
  '120+': '120+ days',
}

export type ClaimSummaryData = {
  count: number
  billed: number
  outstanding: number
  denied: number
  deniedBilled: number
  buckets: readonly {
    bucket: AgingBucket
    amount: number
    count: number
    avgDays: number | null
    oldestDays: number | null
  }[]
  undated: { amount: number; count: number }
  truncated: boolean
}

/** One headline figure. Big number, quiet label, no box of its own. */
function Figure({
  label,
  value,
  note,
  tone,
}: {
  label: string
  value: string
  note: React.ReactNode
  tone?: 'money' | 'warning'
}) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      <p
        className={cn(
          'mt-0.5 text-2xl font-bold tabular-nums',
          tone === 'warning' ? 'text-amber-700' : 'text-gray-900',
        )}
      >
        {value}
      </p>
      <div className="mt-0.5 text-xs text-gray-500">{note}</div>
    </div>
  )
}

/**
 * What the claims currently in view add up to.
 *
 * The table below this used to open on six empty dropdowns and a hundred rows of
 * equal weight — every fact present, none of them ranked, and no answer to the
 * question anybody actually arrives with. This is that answer: how much is out
 * there, how old it is, and how much of it has been denied.
 *
 * It re-totals with the filters rather than describing the whole snapshot. A
 * strip that kept reporting $2.1M while the table under it showed one payer's
 * forty claims would be read as broken the first time somebody checked it, and
 * ignored forever after.
 *
 * Aging is the cut, because age is the one column a claims table cannot show
 * you in aggregate by being sorted. Each bucket is a button: this is where the
 * reader decides what to look at, so it is also where the filter belongs,
 * rather than in a dropdown that asks them to guess a bucket first.
 */
export function ClaimsSummary({
  data,
  isLoading,
  filtered,
  activeBucket,
  onPickBucket,
  snapshot,
  unworked,
  onWorkDenied,
  working,
}: {
  data: ClaimSummaryData | undefined
  isLoading: boolean
  /** Whether any filter is on, so the heading can say what it is describing. */
  filtered: boolean
  activeBucket: string | null
  onPickBucket: (bucket: AgingBucket | null) => void
  /** Which export these figures came from. Part of the same scope claim the
   *  heading makes, so it reads as one sentence rather than a stray line. */
  snapshot: { filename: string | null; at: Date | string } | null
  /** How many denied claims in this export nobody is working. The dollars are
   *  already on this figure — a second amount here would only invite adding
   *  the two together. */
  unworked: { count: number } | null
  onWorkDenied: () => void
  working: boolean
}) {
  const [view, setView] = useAnalyticsView()

  if (isLoading && !data) {
    return (
      <Card>
        <CardContent className="p-4">
          <Skeleton className="h-40 w-full" />
        </CardContent>
      </Card>
    )
  }
  if (!data) return null

  // Plotted without the empty tail. A practice with nothing past 90 days should
  // see a three-bar chart, not two bars and a stretch of blank axis implying
  // the data failed to load.
  const plotted = data.buckets.filter(b => b.amount > 0)

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium text-gray-700">
              {filtered ? 'Matching your filters' : 'This snapshot'}
            </h2>
            {/* Which file these figures came from. This used to be a paragraph
                of its own above the card, which made the page open on a
                sentence about de-duplication rather than on a number. The
                heading already asserts a scope; the filename is the rest of
                that same assertion, and the caveat is a click away. */}
            {snapshot && (
              // A div, not a p: the disclosure below is a <details>, and
              // <details> inside <p> is invalid HTML. The browser silently
              // closes the paragraph early, React then hydrates against a tree
              // the parser never built, and the whole page re-renders — which
              // showed up as the theme flickering to light on first paint.
              <div className="mt-0.5 text-xs text-gray-500">
                From{' '}
                <span className="font-medium text-gray-600">
                  {snapshot.filename ?? 'your last export'}
                </span>
                , imported {format(new Date(snapshot.at), 'MMM d, yyyy')}.{' '}
                <details className="inline">
                  <summary className="inline cursor-pointer list-none underline decoration-dotted underline-offset-2">
                    Why only one export
                  </summary>
                  <span className="ml-1">
                    Only your most recent claims export is read, so two monthly snapshots never
                    double-count.
                  </span>
                </details>
              </div>
            )}
          </div>
        </div>

        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          <Figure
            label="Outstanding"
            value={usd(data.outstanding)}
            note={`of ${usd(data.billed)} billed`}
          />
          <Figure
            label="Claims"
            value={data.count.toLocaleString()}
            // Never states a cap figure of its own — the count IS the cap when
            // truncated, and a second number would only invite reconciling two.
            note={
              data.truncated
                ? 'counted to the cap — there are more'
                : filtered
                  ? 'matching your filters'
                  : 'in this snapshot'
            }
          />
          {/*
            The call to action sits on the number it is about. It was a full
            amber banner stacked above this card — a third block competing with
            the figure that already said how many claims were denied.
          */}
          <Figure
            label="Denied"
            value={data.denied.toLocaleString()}
            note={
              <>
                {usd(data.deniedBilled)} billed
                {unworked && unworked.count > 0 && (
                  <>
                    {' · '}
                    <button
                      type="button"
                      disabled={working}
                      onClick={onWorkDenied}
                      className="font-medium text-amber-700 underline disabled:opacity-60"
                    >
                      {working
                        ? 'Adding…'
                        : `${unworked.count} not on your worklist — add them`}
                    </button>
                  </>
                )}
              </>
            }
            tone={data.denied > 0 ? 'warning' : undefined}
          />
        </div>

        {/*
          Aging is the one aggregate a sorted table cannot give you, so it opens
          expanded. It is still a second question after "how much is out
          there", so one click folds it away for anyone who only wants the
          table.
        */}
        <details open className="group mt-4 border-t border-gray-200 pt-3">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs uppercase tracking-wide text-gray-500 hover:text-gray-700">
            <ChevronRight
              className="h-3.5 w-3.5 transition-transform group-open:rotate-90"
              aria-hidden="true"
            />
            Outstanding by age
          </summary>

          <div className="mt-2 flex justify-end">
            <ViewToggle value={view} onChange={setView} />
          </div>

          {view === 'chart' ? (
            <div className="mt-1">
              {plotted.length === 0 ? (
                <p className="py-6 text-center text-sm text-gray-500">
                  Nothing outstanding in view — every claim here is settled.
                </p>
              ) : (
                <AgingChart data={plotted.map(b => ({ ...b }))} />
              )}
            </div>
          ) : (
            <ul className="mt-2 space-y-1">
              {data.buckets.map(b => {
                const selected = activeBucket === b.bucket
                return (
                  <li key={b.bucket}>
                    <button
                      type="button"
                      aria-pressed={selected}
                      // Clicking the bucket you are already in clears it, so the
                      // control that filtered the page is also the way back.
                      onClick={() => onPickBucket(selected ? null : b.bucket)}
                      className={cn(
                        'flex w-full items-baseline justify-between gap-3 rounded px-2 py-1.5 text-sm',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
                        selected ? 'bg-blue-50 font-medium text-blue-800' : 'hover:bg-gray-50',
                      )}
                    >
                      <span className={selected ? '' : 'text-gray-600'}>
                        {AGING_LABEL[b.bucket] ?? b.bucket}
                      </span>
                      <span className="flex items-baseline gap-3 tabular-nums">
                        <span className="text-xs text-gray-500">
                          {b.count} {b.count === 1 ? 'claim' : 'claims'}
                        </span>
                        <span className={selected ? '' : 'font-medium text-gray-900'}>
                          {usd(b.amount)}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}

          {/* An undated balance is a data problem the customer should see, not
              a receivable quietly aged into the oldest bucket. */}
          {data.undated.count > 0 && (
            <p className="mt-2 text-xs text-gray-500">
              {usd(data.undated.amount)} across {data.undated.count}{' '}
              {data.undated.count === 1 ? 'claim' : 'claims'} has no service, submitted or remit
              date, so it cannot be aged.
            </p>
          )}
        </details>
      </CardContent>
    </Card>
  )
}

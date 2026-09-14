'use client'

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
  buckets: readonly { bucket: AgingBucket; amount: number; count: number }[]
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
  note: string
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
      <p className="mt-0.5 text-xs text-gray-500">{note}</p>
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
}: {
  data: ClaimSummaryData | undefined
  isLoading: boolean
  /** Whether any filter is on, so the heading can say what it is describing. */
  filtered: boolean
  activeBucket: string | null
  onPickBucket: (bucket: AgingBucket | null) => void
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-gray-700">
            {filtered ? 'Matching your filters' : 'This snapshot'}
          </h2>
          <ViewToggle value={view} onChange={setView} />
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
          <Figure
            label="Denied"
            value={data.denied.toLocaleString()}
            note={`${usd(data.deniedBilled)} billed`}
            tone={data.denied > 0 ? 'warning' : undefined}
          />
        </div>

        <div className="mt-4 border-t border-gray-200 pt-3">
          <p className="text-xs uppercase tracking-wide text-gray-500">Outstanding by age</p>

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
        </div>
      </CardContent>
    </Card>
  )
}

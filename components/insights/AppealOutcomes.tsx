'use client'

import { useState } from 'react'
import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
import { trpc } from '@/lib/trpc/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { RankedBar } from '@/components/charts/RankedBar'
import { useAnalyticsView } from '@/components/charts/ViewToggle'
import { useChartTheme } from '@/lib/charts/theme'
import { pct, usd } from '@/lib/charts/format'
import { cn } from '@/lib/utils'
import { EmptyCard } from './EmptyCard'
import { outcomeLine, type OutcomeGroup } from '@/lib/denials/outcomes'
import { MIN_SAMPLE } from '@/lib/stats/min-sample'

/**
 * Which arguments actually get paid.
 *
 * Every other card on this page is a fact about the practice that a fresh
 * export would rebuild tomorrow. This one is a fact about the payers, assembled
 * only from what this workspace sent and what came back, and there is no file
 * to restore it from.
 *
 * ── Why one table and a switcher ──────────────────────────────────────────
 *
 * This card used to stack three six-column tables, one per grouping, and ask
 * the reader to scroll past all of them. They answer the same question at
 * different resolutions, which is a control, not a layout: pick the resolution
 * and show one table. That also makes room for the grouping the API had been
 * returning and nobody had ever rendered — by reason code, across payers.
 *
 * ── Thin rows: counted in the chart, listed in the table ──────────────────
 *
 * A 100% win rate on two appeals is not a finding, and a biller who reads it as
 * one stops appealing things they should. But dropping thin rows entirely is
 * worse: absence reads as "no denials from them". So the table lists every row
 * with its denominator and marks the thin ones, while the chart draws only the
 * rows with MIN_SAMPLE rulings and says how many it left out. A grey bar
 * reading "100%" was still the most confident-looking thing on the card.
 *
 * ── One line, not four tiles ──────────────────────────────────────────────
 *
 * The overall figures were four equal tiles — a win rate, recovered dollars, a
 * turnaround, an open count — and a three-line warning above them. With one
 * ruling on record that was a wall announcing "100.0%". They are now one line
 * in the wording the payer panel uses (outcomeLine), a quieter line for the
 * turnaround, and the coverage caveat in a sentence.
 *
 * ── Why coverage is at the top ────────────────────────────────────────────
 *
 * A win rate drawn from the 12 submissions somebody closed out, of 300 sent, is
 * a number about those 12 — and wins get closed out more reliably than losses,
 * so a half-filled ledger reads high. The caveat travels with the number rather
 * than sitting in a footnote.
 */

/** Under this many rulings, a rate is noise. Shown, but never as a finding. */
const THIN = MIN_SAMPLE

type Grouping = 'payerCode' | 'payer' | 'code' | 'artifact'

/**
 * The four resolutions, and what each one is for.
 *
 * The prose moved in here from three separate paragraphs above three separate
 * tables. One line, swapped with the selection, says the same things without
 * asking the reader to hold all of them at once.
 */
const GROUPINGS: { value: Grouping; label: string; header: string; blurb: string }[] = [
  {
    value: 'payerCode',
    label: 'Payer · code',
    header: 'Payer · code',
    blurb:
      'Whether an appeal is worth writing, per payer and reason. Most-decided first.',
  },
  {
    value: 'payer',
    label: 'Payer',
    header: 'Payer',
    blurb: 'Who pays up when challenged.',
  },
  {
    value: 'code',
    label: 'Code',
    header: 'Reason code',
    blurb:
      'Which denials are worth fighting at all, across every payer.',
  },
  {
    value: 'artifact',
    label: 'Document',
    header: 'Document',
    blurb:
      'Which document works — an appeal letter, a reconsideration, a corrected claim.',
  },
]

function RateCell({ g }: { g: OutcomeGroup }) {
  if (g.winRate === null) {
    return <span className="text-gray-400">—</span>
  }
  const thin = g.decided < THIN
  return (
    <span className={thin ? 'text-gray-500' : 'font-medium text-gray-900'}>
      {pct(g.winRate)}
      {thin && <span className="ml-1 text-xs font-normal text-gray-400">thin</span>}
    </span>
  )
}

/** Nothing here is waiting on a file, so nothing here offers to import one. */
function NothingSent() {
  return (
    <EmptyCard
      title="Nothing sent yet"
      need="This table is built from appeals this workspace sent and the answers that came back. There is no file that fills it."
      action={
        <Button asChild variant="outline" size="sm" className="mt-4">
          <Link href="/worklist">Go to the worklist</Link>
        </Button>
      }
    />
  )
}

function OutcomeTable({ groups, header }: { groups: OutcomeGroup[]; header: string }) {
  if (groups.length === 0) {
    return <NothingSent />
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{header}</TableHead>
          <TableHead className="text-right">Decided</TableHead>
          <TableHead className="text-right">Won</TableHead>
          <TableHead className="text-right">Win rate</TableHead>
          <TableHead className="text-right">Recovered</TableHead>
          <TableHead className="text-right">Median days</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {groups.map(g => (
          <TableRow key={g.key}>
            <TableCell className="max-w-[18rem] truncate" title={g.label}>
              {g.label}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {g.decided}
              {g.pending > 0 && (
                <span className="ml-1 text-xs text-gray-400">+{g.pending} open</span>
              )}
            </TableCell>
            <TableCell className="text-right tabular-nums">{g.won}</TableCell>
            <TableCell className="text-right tabular-nums">
              <RateCell g={g} />
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {g.recovered > 0 ? usd(g.recovered) : <span className="text-gray-400">—</span>}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {/* Suffixed like the turnaround stat above it — the same unit
                  should not render two ways on one card. */}
              {g.medianDays === null ? (
                <span className="text-gray-400">—</span>
              ) : (
                `${g.medianDays}d`
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

/**
 * Win rate per group, with the overall rate drawn across it.
 *
 * The reference line is what makes this a chart worth having: the useful
 * question is never "what is Aetna's win rate" but "is Aetna worse than the
 * rest of them", and a bar without the baseline cannot answer it.
 *
 * Only groups with MIN_SAMPLE rulings are drawn; the rest are counted under the
 * chart and listed in full in the Numbers view.
 */
function OutcomeChart({
  groups,
  overall,
}: {
  groups: OutcomeGroup[]
  overall: { winRate: number | null; decided: number }
}) {
  const theme = useChartTheme()
  const rated = groups.filter(g => g.winRate !== null && g.decided >= THIN)
  const left = groups.length - rated.length

  if (rated.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        Nothing in this grouping has {THIN} rulings yet, so nothing is charted. Every attempt is
        listed in the Numbers view.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      <RankedBar
        data={rated.map(g => ({
          key: g.key,
          label: g.label,
          value: g.winRate as number,
          valueLabel: `${Math.round(g.winRate as number)}% of ${g.decided}`,
          note: g.recovered > 0 ? `${usd(g.recovered)} recovered` : undefined,
        }))}
        colors={rated.map(() => theme.series[0])}
        format={v => `${Math.round(v)}%`}
        labelWidth={170}
        // The baseline only once it is itself a rate worth drawing.
        reference={
          overall.winRate !== null && overall.decided >= THIN
            ? { value: overall.winRate, label: 'overall' }
            : undefined
        }
      />
      {left > 0 && (
        <p className="text-xs text-gray-500">
          {left} more with fewer than {THIN} rulings — in the Numbers view.
        </p>
      )}
    </div>
  )
}

export function AppealOutcomes() {
  const outcomes = trpc.insights.appealOutcomes.useQuery()
  const awaiting = trpc.worklist.awaitingOutcome.useQuery({ limit: 100 })
  const [view] = useAnalyticsView()
  const [grouping, setGrouping] = useState<Grouping>('payerCode')

  // Wrapped, unlike the bare skeleton this used to render: an unwrapped block
  // is a different height from the card that replaces it, so the page jumped
  // every time this resolved.
  if (outcomes.isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>What actually gets paid</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-40 w-full" />
        </CardContent>
      </Card>
    )
  }
  if (!outcomes.data) return null

  const { coverage, overall, byPayerAndCode, byPayer, byCode, byArtifact } = outcomes.data
  const open = awaiting.data ?? []

  if (coverage.total === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>What actually gets paid</CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyCard
            title="No appeals sent yet"
            need="Draft a response on the worklist, send it, and record what comes back. This table is built from those answers and cannot be imported from anywhere."
          />
        </CardContent>
      </Card>
    )
  }

  const groups: Record<Grouping, OutcomeGroup[]> = {
    payerCode: byPayerAndCode,
    payer: byPayer,
    code: byCode,
    artifact: byArtifact,
  }
  const active = GROUPINGS.find(g => g.value === grouping)!

  // Nothing any grouping could chart: the switcher would change nothing on
  // screen, so in the chart view it is not offered at all.
  const chartable = Object.values(groups).some(list =>
    list.some(g => g.winRate !== null && g.decided >= THIN),
  )
  const showBreakdown = view === 'numbers' || chartable

  // A median over fewer than MIN_SAMPLE rulings is the same anecdote a rate
  // would be, so the turnaround waits for the same floor.
  const context = [
    overall.medianDays !== null && overall.decided >= THIN
      ? `payers take ${overall.medianDays} days to rule, median`
      : null,
    overall.noResponse > 0 ? `${overall.noResponse} never answered` : null,
  ].filter((x): x is string => x !== null)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-2">
          <span>What actually gets paid</span>
          <Badge variant={coverage.rate !== null && coverage.rate >= 60 ? 'success' : 'warning'}>
            {coverage.resolved} of {coverage.total} closed out
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p className="text-lg font-semibold text-gray-900">{outcomeLine(overall)}</p>
          {context.length > 0 && (
            <p className="mt-0.5 text-sm text-gray-500">
              {context.join(' · ').replace(/^./, c => c.toUpperCase())}
            </p>
          )}
          {/*
            The caveat with the number, not in a footnote: wins get recorded
            more reliably than losses, so a half-filled ledger reads high — the
            direction that costs money to believe. One sentence; the badge above
            already carries the count.
          */}
          {coverage.rate !== null && coverage.rate < 60 && (
            <p className="mt-1.5 flex items-start gap-1.5 text-sm text-amber-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                Rates read high until the rest are closed out — a denial is easier to forget than
                a payment.{' '}
                {open.length > 0 && (
                  <Link href="/worklist" className="font-medium underline">
                    Close them out
                  </Link>
                )}
              </span>
            </p>
          )}
        </div>

        {showBreakdown ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              {/* Built the way ViewToggle is — this codebase has no Tabs
                  primitive and one segmented control is not worth a dependency. */}
              <div
                role="radiogroup"
                aria-label="Group outcomes by"
                className="inline-flex items-center gap-0.5 rounded-md border border-gray-200 bg-gray-50 p-0.5"
              >
                {GROUPINGS.map(option => {
                  const selected = option.value === grouping
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setGrouping(option.value)}
                      className={cn(
                        'rounded px-2.5 py-1 text-xs font-medium transition-colors',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
                        selected
                          ? 'bg-white text-gray-900 shadow-sm'
                          : 'text-gray-500 hover:text-gray-900'
                      )}
                    >
                      {option.label}
                    </button>
                  )
                })}
              </div>
              <p className="text-xs text-gray-500">{active.blurb}</p>
            </div>

            {view === 'chart' ? (
              <OutcomeChart groups={groups[grouping]} overall={overall} />
            ) : (
              <OutcomeTable groups={groups[grouping]} header={active.header} />
            )}
          </div>
        ) : (
          <p className="text-sm text-gray-500">
            Breakdowns by payer, reason and document appear once one of them has {THIN} rulings.
            Every attempt so far is listed in the Numbers view.
          </p>
        )}

        {outcomes.data.truncated && (
          <p className="text-xs text-gray-500">
            Drawn from the most recent submissions only; older attempts are not counted.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

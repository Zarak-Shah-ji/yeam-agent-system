'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { RankedBar, type RankedDatum } from '@/components/charts/RankedBar'
import { payerKey } from '@/lib/billing/payer-key'
import { useChartTheme } from '@/lib/charts/theme'
import { cn } from '@/lib/utils'
import { usd, usdCompact } from '@/lib/charts/format'
import { MIN_SAMPLE } from '@/lib/stats/min-sample'
import type { OutcomeGroup } from '@/lib/denials/outcomes'
import type { PayerRow } from '@/lib/insights/aggregate'

const TOP_N = 10

/** Where the expiring share of a payer's money turns its bar red. */
const URGENT_SHARE = 0.25

/**
 * The payer scorecard, plotted.
 *
 * Four charts rather than one, because the table's columns are not on one scale
 * and never were: a denial rate is a percentage, at-stake is dollars, and
 * days-to-pay is days. Putting any two of them on shared axes would invent a
 * relationship the data does not contain.
 *
 * The split the table is careful about is kept here too. Denial rate and days
 * to pay are of the A/R snapshot; at-stake is of the denial worklist; the win
 * rate is of the outcome ledger. Own cards, never added together.
 *
 * The two cards that can change what someone does today lead — where the money
 * is, and whether arguing with that payer works. Denial rate and days to pay
 * describe the standing relationship, so they sit underneath. Every bar opens
 * the same payer panel the table's rows do.
 *
 * ── One colour of alarm, not two ──────────────────────────────────────────
 *
 * The at-stake chart used to shade a bar amber if any of its money expired
 * within 14 days and red past a quarter of it. Half the bars came out amber —
 * a payer with $15 expiring out of $779 looked as urgent as one with $400 of
 * $500 — and amber had no legend. A bar is now red when a real share of it is
 * about to go, and the ordinary colour otherwise; the exact expiring figure is
 * in its tooltip and on the table.
 *
 * ── Why thin win rates are not drawn ──────────────────────────────────────
 *
 * A bar reading "100%" over one ruling is the most confident-looking thing on
 * the page and the least informed. Payers under MIN_SAMPLE rulings are counted
 * in a line under the chart instead, so none of them silently disappears, and
 * the Numbers view still lists every one as "x of y". Until any payer clears
 * the bar the card is not drawn at all — one summary row says how far off it is.
 */
export function PayerCharts({
  rows,
  outcomes,
  outcomesLoading,
  onSelect,
}: {
  rows: PayerRow[]
  /** Appeal history keyed by payerKey(), as the ledger groups it. */
  outcomes: Map<string, OutcomeGroup>
  outcomesLoading: boolean
  /** Opens the payer's panel — the same one the table's rows open. */
  onSelect: (payer: string) => void
}) {
  const theme = useChartTheme()

  const byAtStake = top(
    rows.filter(r => r.atStake > 0),
    r => r.atStake,
    r => ({
      key: r.payer,
      label: r.payer,
      value: r.atStake,
      note:
        r.expiringSoon > 0
          ? `${usd(r.expiringSoon)} closes within 14 days`
          : `${r.openDenials} open denials`,
    }),
  )
  const atStakeColours = byAtStake.map(datum => {
    const row = rows.find(r => r.payer === datum.key)
    const urgent = row && row.atStake > 0 && row.expiringSoon / row.atStake >= URGENT_SHARE
    return urgent ? theme.status.critical : theme.series[0]
  })

  const appealed = rows
    .map(row => {
      const key = payerKey(row.payer)
      const group = key ? outcomes.get(key) : undefined
      return group && group.decided > 0 ? { row, group } : null
    })
    .filter((x): x is { row: PayerRow; group: OutcomeGroup } => x !== null)
  const rated = appealed.filter(({ group }) => group.decided >= MIN_SAMPLE)
  const thin = appealed.length - rated.length
  const thinRulings = appealed
    .filter(({ group }) => group.decided < MIN_SAMPLE)
    .reduce((sum, { group }) => sum + group.decided, 0)

  const winData: RankedDatum[] = rated
    .sort((a, b) => (b.group.winRate ?? 0) - (a.group.winRate ?? 0))
    .slice(0, TOP_N)
    .map(({ row, group }) => ({
      key: row.payer,
      label: row.payer,
      value: group.winRate ?? 0,
      valueLabel: `${Math.round(group.winRate ?? 0)}% of ${group.decided}`,
      note: `${usd(group.recovered)} recovered`,
    }))

  const byDenialRate = top(
    rows.filter(r => r.denialRate !== null),
    r => r.denialRate as number,
    r => ({
      key: r.payer,
      label: r.payer,
      value: r.denialRate as number,
      valueLabel: `${(r.denialRate as number).toFixed(1)}% of ${r.claims}`,
      detail: r.topCarc ? `Mostly ${r.topCarc.carc} — ${r.topCarc.label}` : undefined,
    }),
  )

  const byDaysToPay = top(
    rows.filter(r => r.medianDaysToPay !== null),
    r => r.medianDaysToPay as number,
    r => ({
      key: r.payer,
      label: r.payer,
      value: r.medianDaysToPay as number,
      note: `${r.filingWindowDays} days to appeal`,
    }),
  )

  // With nothing rateable yet, the win-rate card was a full-height box holding
  // one sentence. It becomes a single summary row instead, and at-stake takes
  // the width — the space goes to the chart that has something to show.
  const showWinChart = outcomesLoading || winData.length > 0

  const atStakeCard = (
    <ChartCard
      title="Still at stake by payer"
      subtitle="Open, still-recoverable denials. Red where a quarter or more closes within 14 days"
      className={showWinChart ? undefined : 'lg:col-span-2'}
    >
      <RankedBar
        data={byAtStake}
        colors={atStakeColours}
        format={usdCompact}
        onSelect={onSelect}
        emptyLabel="Nothing open on the worklist."
      />
    </ChartCard>
  )

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        {atStakeCard}

        {showWinChart && (
          <ChartCard
            title="Appeal win rate by payer"
            subtitle={`Rulings that went your way, from outcomes you recorded. Payers with ${MIN_SAMPLE}+ rulings`}
          >
            {outcomesLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : (
              <>
                <RankedBar
                  data={winData}
                  format={v => `${Math.round(v)}%`}
                  reference={{ value: 50, label: 'even odds' }}
                  onSelect={onSelect}
                />
                {thin > 0 && (
                  <p className="mt-2 text-xs text-gray-500">
                    {thin} more {thin === 1 ? 'payer has' : 'payers have'} fewer than {MIN_SAMPLE}{' '}
                    rulings — see Numbers.
                  </p>
                )}
              </>
            )}
          </ChartCard>
        )}
      </div>

      {!showWinChart && (
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-md border border-gray-200 bg-white px-4 py-3">
          <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
            Appeal win rates
          </span>
          <span className="text-sm text-gray-700">
            {appealed.length === 0
              ? 'Nothing ruled on yet. Record outcomes on the worklist and each payer gets a win rate.'
              : `Shown once a payer has ${MIN_SAMPLE} rulings — ${thinRulings} so far across ${thin} ${thin === 1 ? 'payer' : 'payers'}.`}
          </span>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Denial rate by payer"
          subtitle="Share of each payer's claims denied, from your A/R export"
        >
          <RankedBar
            data={byDenialRate}
            format={v => `${v.toFixed(1)}%`}
            reference={{ value: 10, label: '10% target' }}
            onSelect={onSelect}
            emptyLabel="Needs an A/R export — a denial rate has to divide by every claim, not just the denied ones."
          />
        </ChartCard>

        <ChartCard title="Days to pay by payer" subtitle="Median days from submission to payment">
          <RankedBar
            data={byDaysToPay}
            format={v => `${Math.round(v)}d`}
            onSelect={onSelect}
            emptyLabel="Needs an A/R export with submitted and remit dates."
          />
        </ChartCard>
      </div>

      <p className="text-xs text-gray-400">
        Click a bar to open that payer.
        {rows.length > TOP_N && ` Worst ${TOP_N} of ${rows.length} per chart — Numbers has them all.`}
      </p>
    </div>
  )
}

/**
 * A chart and the one sentence that says what it measures. Flex so an empty
 * state sits in the middle of a card stretched to match its neighbour, rather
 * than at the top of a box that looks half-rendered.
 */
function ChartCard({
  title,
  subtitle,
  className,
  children,
}: {
  title: string
  subtitle: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <Card className={cn('flex flex-col', className)}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        <p className="text-xs text-gray-500">{subtitle}</p>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col">{children}</CardContent>
    </Card>
  )
}

/** Worst first, capped — a chart with forty rows is a table with extra steps. */
function top(
  rows: PayerRow[],
  by: (row: PayerRow) => number,
  toDatum: (row: PayerRow) => RankedDatum,
): RankedDatum[] {
  return [...rows]
    .sort((a, b) => by(b) - by(a))
    .slice(0, TOP_N)
    .map(toDatum)
}

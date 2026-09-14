'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { RankedBar, type RankedDatum } from '@/components/charts/RankedBar'
import { usdCompact } from '@/lib/charts/format'
import type { PayerRow } from '@/lib/insights/aggregate'

const TOP_N = 10

/**
 * The payer scorecard, plotted.
 *
 * Three charts rather than one, because the table's columns are not on one
 * scale and never were: a denial rate is a percentage, at-stake is dollars, and
 * days-to-pay is days. Putting any two of them on shared axes would invent a
 * relationship the data does not contain.
 *
 * The split the table is careful about is kept here too. Denial rate and days
 * to pay are of the A/R snapshot; at-stake is of the denial worklist. They
 * describe the same claims from two angles, so they get their own cards and are
 * never added together.
 */
export function PayerCharts({ rows }: { rows: PayerRow[] }) {
  const byDenialRate = top(
    rows.filter(r => r.denialRate !== null),
    r => r.denialRate as number,
    r => ({ key: r.payer, label: r.payer, value: r.denialRate as number, note: `of ${r.claims} claims` })
  )

  const byAtStake = top(
    rows.filter(r => r.atStake > 0),
    r => r.atStake,
    r => ({ key: r.payer, label: r.payer, value: r.atStake, note: `${r.openDenials} open denials` })
  )

  const byDaysToPay = top(
    rows.filter(r => r.medianDaysToPay !== null),
    r => r.medianDaysToPay as number,
    r => ({
      key: r.payer,
      label: r.payer,
      value: r.medianDaysToPay as number,
      note: `median · ${r.filingWindowDays}d to appeal`,
    })
  )

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Denial rate by payer</CardTitle>
            <p className="text-xs text-gray-500">Share of this payer&rsquo;s claims denied, from your A/R snapshot</p>
          </CardHeader>
          <CardContent>
            <RankedBar
              data={byDenialRate}
              format={v => `${v.toFixed(1)}%`}
              reference={{ value: 10, label: '10% target' }}
              emptyLabel="Needs an A/R export — a denial rate has to divide by every claim, not just the denied ones."
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Still at stake by payer</CardTitle>
            <p className="text-xs text-gray-500">Open, still-recoverable denials on your worklist</p>
          </CardHeader>
          <CardContent>
            <RankedBar
              data={byAtStake}
              format={usdCompact}
              emptyLabel="Nothing open on the worklist."
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Days to pay by payer</CardTitle>
          <p className="text-xs text-gray-500">
            Median days from submission to remittance — the median so one 300-day outlier
            doesn&rsquo;t move it
          </p>
        </CardHeader>
        <CardContent>
          <RankedBar
            data={byDaysToPay}
            format={v => `${Math.round(v)}d`}
            emptyLabel="Needs an A/R export with submitted and remit dates."
          />
        </CardContent>
      </Card>

      <p className="text-xs text-gray-400">
        {rows.length > TOP_N
          ? `Worst ${TOP_N} of ${rows.length} payers per chart. Switch to Numbers for all of them, with collection rates and filing windows.`
          : 'Switch to Numbers for collection rates, filing windows and top denial reason per payer.'}
      </p>
    </div>
  )
}

/** Worst first, capped — a chart with forty rows is a table with extra steps. */
function top(
  rows: PayerRow[],
  by: (row: PayerRow) => number,
  toDatum: (row: PayerRow) => RankedDatum
): RankedDatum[] {
  return [...rows]
    .sort((a, b) => by(b) - by(a))
    .slice(0, TOP_N)
    .map(toDatum)
}

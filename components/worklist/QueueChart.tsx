'use client'

import { RankedBar, type RankedDatum } from '@/components/charts/RankedBar'
import { useChartTheme } from '@/lib/charts/theme'
import { usdCompact } from '@/lib/charts/format'
import { BAND_LABEL, type PriorityBand } from '@/lib/denials/score'

/**
 * The shape of the open queue, in one picture.
 *
 * The four tiles answer "how bad is it" with four unrelated scalars, and a
 * reader has to hold them side by side to get the only answer they actually
 * came for: where the money is sitting and how soon it has to move. That is one
 * distribution, so it is one chart.
 *
 * Dollars rather than counts, because the bands already rank by urgency and the
 * open question within a band is how much is riding on it — sixty "can wait"
 * rows worth $400 are a different afternoon from six worth $60,000. The count
 * travels in the tooltip, and the Numbers view has both to the dollar.
 *
 * Deliberately the same red/amber/grey the table below it washes its rows with,
 * so the chart and the queue read as one surface rather than two opinions. The
 * quiet bands share a neutral: the colour channel here carries urgency, and
 * "can wait" and "not workable" are both simply not urgent — the axis label is
 * what separates them.
 */
export function QueueChart({
  byBand,
}: {
  byBand: readonly { band: PriorityBand; count: number; billed: number }[]
}) {
  const theme = useChartTheme()

  const fill: Record<PriorityBand, string> = {
    now: theme.status.critical,
    soon: theme.status.warning,
    later: theme.muted,
    parked: theme.muted,
  }

  const data: RankedDatum[] = byBand.map(b => ({
    key: b.band,
    label: BAND_LABEL[b.band],
    value: b.billed,
    note: `${b.count} ${b.count === 1 ? 'denial' : 'denials'}`,
  }))

  return (
    <RankedBar
      data={data}
      colors={byBand.map(b => fill[b.band])}
      format={usdCompact}
      labelWidth={104}
      // Urgency order, not size order. Sorting these by dollars would put "can
      // wait" on top the moment it held the most money, which is the one
      // reading of this chart that must never happen.
      keepOrder
      emptyLabel="Nothing open — every denial here is paid or closed."
    />
  )
}

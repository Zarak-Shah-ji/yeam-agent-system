'use client'

import {
  CartesianGrid, Legend, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { useChartTheme } from '@/lib/charts/theme'
import { usd, usdCompact } from '@/lib/charts/format'
import { ChartTooltip } from '@/components/charts/ChartTooltip'

export interface RevenuePoint {
  date: string
  billed: number
  collected: number
}

/**
 * Billed against collected, by month.
 *
 * Two lines on one axis, not bars-plus-line and never two axes. Both series are
 * dollars, so they share a scale honestly, and the gap between the lines is the
 * thing the reader is actually here to see — the money asked for that has not
 * arrived. A second y-scale would let that gap mean whatever the scales
 * happened to be set to.
 */
export function RevenueChart({ data }: { data: RevenuePoint[] }) {
  const theme = useChartTheme()

  return (
    <div style={{ height: 280 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, left: 4, bottom: 4 }}>
          <CartesianGrid stroke={theme.grid} vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11, fill: theme.muted }}
            tickLine={false}
            axisLine={{ stroke: theme.axis }}
          />
          <YAxis
            tick={{ fontSize: 11, fill: theme.muted }}
            tickLine={false}
            axisLine={false}
            tickFormatter={usdCompact}
            width={52}
          />
          <Tooltip
            cursor={{ stroke: theme.axis, strokeWidth: 1 }}
            content={
              <ChartTooltip
                rows={items =>
                  items.map(item => ({
                    key: String(item.dataKey),
                    name: String(item.name ?? ''),
                    value: usd(Number(item.value ?? 0)),
                    color: item.color ?? theme.series[0],
                  }))
                }
              />
            }
          />
          <Legend
            iconType="plainline"
            wrapperStyle={{ fontSize: 12, color: theme.muted, paddingTop: 8 }}
          />
          <Line
            type="monotone"
            dataKey="billed"
            name="Billed"
            stroke={theme.series[0]}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            dot={false}
            // No draw-on animation: these re-render on every background
            // refetch, and a chart that redraws itself each time reads as a
            // flash rather than as new data.
            isAnimationActive={false}
            // The ring is the surface colour, so a marker stays legible where
            // the two lines cross rather than merging into the other one.
            activeDot={{ r: 4, strokeWidth: 2, stroke: theme.surface }}
          />
          <Line
            type="monotone"
            dataKey="collected"
            name="Collected"
            stroke={theme.series[1]}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            dot={false}
            // No draw-on animation: these re-render on every background
            // refetch, and a chart that redraws itself each time reads as a
            // flash rather than as new data.
            isAnimationActive={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: theme.surface }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

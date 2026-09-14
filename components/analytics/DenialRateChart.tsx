'use client'

import {
  CartesianGrid, Line, LineChart, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { useChartTheme } from '@/lib/charts/theme'
import { ChartTooltip } from '@/components/charts/ChartTooltip'

export interface DenialRatePoint {
  date: string
  rate: number
}

/**
 * Denial rate by month, against the 10% line.
 *
 * One series, so no legend — the card title already says what is plotted. The
 * line itself is the ordinary series colour rather than red: the trend is not
 * bad in itself, it is bad relative to a threshold, and that is what the
 * reference line is for. It carries a written label, because a red rule with no
 * text is a colour asking to be interpreted.
 */
export function DenialRateChart({ data }: { data: DenialRatePoint[] }) {
  const theme = useChartTheme()

  return (
    <div style={{ height: 240 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 16, right: 16, left: 4, bottom: 4 }}>
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
            tickFormatter={(v: number) => `${v.toFixed(0)}%`}
            domain={[0, 'auto']}
            width={44}
          />
          <Tooltip
            cursor={{ stroke: theme.axis, strokeWidth: 1 }}
            content={
              <ChartTooltip
                rows={items => [
                  {
                    key: 'rate',
                    name: 'denied',
                    value: `${Number(items[0]?.value ?? 0).toFixed(1)}%`,
                    color: theme.series[0],
                  },
                ]}
              />
            }
          />
          <ReferenceLine
            y={10}
            stroke={theme.status.critical}
            strokeWidth={1}
            label={{
              value: '10% target',
              position: 'insideTopRight',
              fontSize: 10,
              fill: theme.muted,
            }}
          />
          <Line
            type="monotone"
            dataKey="rate"
            name="Denial rate"
            stroke={theme.series[0]}
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

export interface DenialCountPoint {
  date: string
  denied: number
}

/**
 * Denied claims per month, for the workspace that has imported denials but no
 * A/R export.
 *
 * Counts, not a rate: without every claim there is no denominator, and a rate
 * computed over denials alone is always 100%. The trend is still worth seeing,
 * so it gets a line rather than being withheld until a second file shows up.
 */
export function DenialCountChart({ data }: { data: DenialCountPoint[] }) {
  const theme = useChartTheme()

  return (
    <div style={{ height: 240 }}>
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
            allowDecimals={false}
            width={40}
          />
          <Tooltip
            cursor={{ stroke: theme.axis, strokeWidth: 1 }}
            content={
              <ChartTooltip
                rows={items => [
                  {
                    key: 'denied',
                    name: 'denials',
                    value: String(items[0]?.value ?? 0),
                    color: theme.series[0],
                  },
                ]}
              />
            }
          />
          <Line
            type="monotone"
            dataKey="denied"
            name="Denials"
            stroke={theme.series[0]}
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

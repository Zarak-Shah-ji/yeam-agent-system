'use client'

import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ordinalSteps, useChartTheme } from '@/lib/charts/theme'
import { usd, usdCompact } from '@/lib/charts/format'
import { ChartTooltip } from '@/components/charts/ChartTooltip'

interface DataPoint {
  bucket: string
  amount: number
  count: number
}

/**
 * Outstanding dollars by age.
 *
 * Coloured by the one-hue ordinal ramp rather than a single flat colour: age
 * buckets are an ordered scale, so the reader should be able to see that
 * ordering in the bars without reading the axis. Older is further along the
 * ramp — darker in light mode, lighter against a dark card, since a ramp that
 * ran to near-black would lose its far end in the surface.
 */
export function AgingChart({ data }: { data: DataPoint[] }) {
  const theme = useChartTheme()
  const fills = ordinalSteps(theme, data.length)

  return (
    <div style={{ height: 260 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 16, right: 8, left: 4, bottom: 0 }}>
          <CartesianGrid stroke={theme.grid} vertical={false} />
          <XAxis
            dataKey="bucket"
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
            cursor={{ fill: theme.grid, fillOpacity: 0.4 }}
            labelFormatter={label => `${String(label)} days`}
            content={
              <ChartTooltip
                labelFormatter={label => `${label} days`}
                rows={items => {
                  const row = items[0]?.payload as DataPoint | undefined
                  return [
                    {
                      key: 'amount',
                      name: `across ${row?.count ?? 0} claims`,
                      value: usd(Number(items[0]?.value ?? 0)),
                      color: fills[data.findIndex(d => d.bucket === row?.bucket)] ?? theme.ordinal[0],
                    },
                  ]
                }}
              />
            }
          />
          <Bar dataKey="amount" barSize={40} radius={[4, 4, 0, 0]} isAnimationActive={false}>
            {data.map((entry, index) => (
              <Cell key={entry.bucket} fill={fills[index]} />
            ))}
            <LabelList
              dataKey="amount"
              position="top"
              formatter={(value: unknown) => usdCompact(Number(value ?? 0))}
              style={{ fontSize: 10, fill: theme.muted }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

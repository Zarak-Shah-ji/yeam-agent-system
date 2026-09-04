'use client'

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

interface DataPoint {
  bucket: string
  amount: number
  count: number
}

/**
 * Outstanding dollars by age.
 *
 * Coloured by age rather than by series: the point of an aging report is that
 * the right-hand bars are the ones in trouble, and a single-hue chart makes a
 * reader work that out from the axis labels.
 */
const BUCKET_FILL = ['#93c5fd', '#60a5fa', '#fbbf24', '#f87171', '#dc2626']

const TOOLTIP_STYLE = {
  backgroundColor: 'var(--color-white)',
  border: '1px solid var(--color-gray-200)',
  borderRadius: 6,
  color: 'var(--color-gray-900)',
} as const

export function AgingChart({ data }: { data: DataPoint[] }) {
  return (
    <div style={{ height: 240 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-gray-200)" vertical={false} />
          <XAxis dataKey="bucket" tick={{ fontSize: 12, fill: 'var(--color-gray-500)' }} tickLine={false} axisLine={false} />
          <YAxis
            tick={{ fontSize: 12, fill: 'var(--color-gray-500)' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => `$${Math.round(v / 1000)}k`}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelStyle={{ color: 'var(--color-gray-900)' }}
            formatter={(value, _name, item) => [
              `$${Number(value ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}`,
              `${(item?.payload as DataPoint | undefined)?.count ?? 0} claims`,
            ]}
            labelFormatter={label => `${String(label)} days`}
          />
          <Bar dataKey="amount" radius={[4, 4, 0, 0]}>
            {data.map((entry, index) => (
              <Cell key={entry.bucket} fill={BUCKET_FILL[index] ?? '#dc2626'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

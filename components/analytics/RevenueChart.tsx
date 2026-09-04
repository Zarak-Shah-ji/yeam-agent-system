'use client'

import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts'

interface DataPoint {
  date: string
  billed: number
  collected: number
}

interface Props {
  data: DataPoint[]
}

const TOOLTIP_STYLE = {
  backgroundColor: 'var(--color-white)',
  border: '1px solid var(--color-gray-200)',
  borderRadius: 6,
  color: 'var(--color-gray-900)',
} as const

export function RevenueChart({ data }: Props) {
  return (
    <div style={{ height: 280 }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-gray-200)" />
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--color-gray-500)' }} />
          <YAxis tick={{ fontSize: 11, fill: 'var(--color-gray-500)' }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelStyle={{ color: 'var(--color-gray-900)' }}
            formatter={(value: number | string | undefined, name: string | undefined) => [`$${Number(value ?? 0).toLocaleString()}`, name ?? '']}
          />
          <Legend />
          <Bar dataKey="billed" name="Billed" fill="#93c5fd" radius={[3, 3, 0, 0]} />
          <Line
            type="monotone"
            dataKey="collected"
            name="Collected"
            stroke="#2563eb"
            strokeWidth={2}
            dot={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

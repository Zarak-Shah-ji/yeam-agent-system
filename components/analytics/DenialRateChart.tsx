'use client'

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ResponsiveContainer,
} from 'recharts'

interface DataPoint {
  date: string
  rate: number
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

export function DenialRateChart({ data }: Props) {
  return (
    <div style={{ height: 220 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-gray-200)" />
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--color-gray-500)' }} />
          <YAxis
            tick={{ fontSize: 11, fill: 'var(--color-gray-500)' }}
            tickFormatter={v => `${v.toFixed(0)}%`}
            domain={[0, 'auto']}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelStyle={{ color: 'var(--color-gray-900)' }}
            formatter={(v: number | string | undefined) => [`${Number(v ?? 0).toFixed(1)}%`, 'Denial rate']}
          />
          <ReferenceLine y={10} stroke="#f87171" strokeDasharray="4 4" label={{ value: '10% target', fontSize: 10, fill: '#f87171' }} />
          <Line
            type="monotone"
            dataKey="rate"
            name="Denial rate"
            stroke="#ef4444"
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

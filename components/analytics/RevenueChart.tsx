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

export function RevenueChart({ data }: Props) {
  return (
    <div style={{ height: 280 }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
          <Tooltip
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

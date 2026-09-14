'use client'

import type { ReactNode } from 'react'
import { useChartTheme } from '@/lib/charts/theme'

export type TooltipRow = { key: string; name: string; value: string; color: string }

type RechartsPayloadItem = {
  dataKey?: string | number
  name?: string | number
  value?: number | string
  color?: string
  payload?: unknown
}

/**
 * One tooltip listing every series at the hovered position.
 *
 * Two deliberate departures from the recharts default. The value leads and the
 * series name follows it in secondary ink — the reader already knows which
 * series they are pointing at and wants the number. And each row is keyed by a
 * short stroke of the series colour rather than a filled block: at this density
 * a swatch is a lot of coloured ink doing a label's job.
 *
 * Nothing here is the only route to a value. Every chart that uses this has a
 * table twin behind the Numbers toggle.
 */
export function ChartTooltip({
  active,
  payload,
  label,
  rows,
  labelFormatter,
  footer,
}: {
  active?: boolean
  payload?: RechartsPayloadItem[]
  label?: string | number
  /** Builds the rows from the hovered datum. Omit for one row per series. */
  rows?: (items: RechartsPayloadItem[]) => TooltipRow[]
  labelFormatter?: (label: string) => string
  footer?: (items: RechartsPayloadItem[]) => ReactNode
}) {
  const theme = useChartTheme()
  if (!active || !payload || payload.length === 0) return null

  const items = payload
  const built: TooltipRow[] =
    rows?.(items) ??
    items.map((item, i) => ({
      key: String(item.dataKey ?? i),
      name: String(item.name ?? ''),
      value: String(item.value ?? ''),
      color: item.color ?? theme.series[i % theme.series.length],
    }))

  const heading = label === undefined || label === null ? null : String(label)

  return (
    <div className="rounded-md border border-gray-200 bg-white px-2.5 py-2 shadow-lg">
      {heading && (
        <p className="mb-1 text-xs font-medium text-gray-500">
          {labelFormatter ? labelFormatter(heading) : heading}
        </p>
      )}
      <div className="space-y-0.5">
        {built.map(row => (
          <div key={row.key} className="flex items-baseline gap-2">
            <span
              aria-hidden="true"
              className="h-0.5 w-3 shrink-0 rounded-full"
              style={{ backgroundColor: row.color }}
            />
            <span className="text-sm font-semibold tabular-nums text-gray-900">{row.value}</span>
            {row.name && <span className="text-xs text-gray-500">{row.name}</span>}
          </div>
        ))}
      </div>
      {footer && <div className="mt-1 text-xs text-gray-500">{footer(items)}</div>}
    </div>
  )
}

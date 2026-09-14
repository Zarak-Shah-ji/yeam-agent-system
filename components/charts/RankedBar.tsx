'use client'

import {
  Bar, BarChart, Cell, LabelList, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { useChartTheme } from '@/lib/charts/theme'
import { truncate } from '@/lib/charts/format'
import { ChartTooltip } from './ChartTooltip'

export type RankedDatum = {
  /** Stable identity. Colour and ordering follow this, never the row index. */
  key: string
  label: string
  value: number
  /** Second line in the tooltip — a count, a description, whatever qualifies it. */
  note?: string
}

const ROW_HEIGHT = 30
const BAR_SIZE = 18
const AXIS_BAND = 28

/** Rough width of one character at the 11px tick size. Deliberately generous. */
const CHAR_PX = 6.4

/**
 * A category label on exactly one line.
 *
 * The default recharts tick word-wraps to fit the axis width, which turns
 * "Blue Cross Blue Shield" into two cramped lines and pushes the rows out of
 * alignment with their bars. Truncating to a single line is the better trade:
 * the full text is a hover away in the tooltip and spelled out in full in the
 * Numbers view, so nothing is lost, and the axis stays readable.
 */
function CategoryTick({
  x,
  y,
  payload,
  fill,
  chars,
}: {
  x?: number
  y?: number
  payload?: { value?: string | number }
  fill: string
  chars: number
}) {
  return (
    <text x={x} y={y} dy={4} textAnchor="end" fontSize={11} fill={fill}>
      {truncate(String(payload?.value ?? ''), chars)}
    </text>
  )
}

/**
 * Ranked horizontal bars — the form for "which of these is worst".
 *
 * Horizontal because the categories are named things (a CARC code, a payer, a
 * CPT) and a rotated axis label is a tax on the reader.
 *
 * Every bar is one colour by default. Shading each bar darker where it is
 * bigger would spend the identity channel re-encoding the length the reader can
 * already see; where the categories genuinely are ordered — funnel stages — the
 * caller passes the ordinal ramp through `colors` instead.
 */
export function RankedBar({
  data,
  format,
  labelWidth = 130,
  colors,
  reference,
  keepOrder = false,
  emptyLabel = 'Nothing to plot',
}: {
  data: RankedDatum[]
  format: (value: number) => string
  labelWidth?: number
  /** One colour per row, in the order `data` was given. */
  colors?: string[]
  /** A target or threshold, drawn as a hairline with a visible label. */
  reference?: { value: number; label: string }
  /**
   * Keep the caller's row order instead of ranking by value. For sequences
   * where the order carries the meaning — funnel stages, age bands — sorting
   * by size would destroy the thing the chart is showing.
   */
  keepOrder?: boolean
  emptyLabel?: string
}) {
  const theme = useChartTheme()

  // Otherwise callers get whatever order their query returned. `topCarcs`, for
  // one, sorts by total billed while this chart plots what is still at stake,
  // which put $0 rows at the top of a chart calling itself ranked. `colors` is
  // positional, so it is reordered alongside rather than left pointing at the
  // rows it was written for.
  const order = data.map((_, i) => i)
  if (!keepOrder) order.sort((a, b) => data[b].value - data[a].value)
  const rows = order.map(i => data[i])
  const fills = colors ? order.map(i => colors[i]) : null

  if (data.length === 0) {
    return (
      <div className="flex min-h-32 items-center justify-center">
        <p className="max-w-sm text-center text-sm text-gray-500">{emptyLabel}</p>
      </div>
    )
  }

  // Sized to fit the rows plus the axis band, so the card never grows its own
  // little scrollbar around a plot that almost fits.
  const height = rows.length * ROW_HEIGHT + AXIS_BAND + 8

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={rows}
          layout="vertical"
          margin={{ top: 4, right: 56, left: 0, bottom: 4 }}
          barCategoryGap="28%"
        >
          <XAxis
            type="number"
            tickFormatter={format}
            tick={{ fontSize: 11, fill: theme.muted }}
            tickLine={false}
            axisLine={{ stroke: theme.axis }}
          />
          <YAxis
            type="category"
            dataKey="label"
            width={labelWidth}
            tick={<CategoryTick fill={theme.muted} chars={Math.floor((labelWidth - 12) / CHAR_PX)} />}
            tickLine={false}
            axisLine={{ stroke: theme.axis }}
          />
          <Tooltip
            cursor={{ fill: theme.grid, fillOpacity: 0.4 }}
            content={
              <ChartTooltip
                rows={items => {
                  const row = items[0]?.payload as RankedDatum | undefined
                  return [
                    {
                      key: row?.key ?? 'value',
                      name: row?.note ?? '',
                      value: format(Number(items[0]?.value ?? 0)),
                      color: fills?.[rows.findIndex(d => d.key === row?.key)] ?? theme.series[0],
                    },
                  ]
                }}
              />
            }
          />
          {reference && (
            <ReferenceLine
              x={reference.value}
              stroke={theme.status.critical}
              strokeWidth={1}
              label={{
                value: reference.label,
                position: 'top',
                fontSize: 10,
                fill: theme.muted,
              }}
            />
          )}
          {/* Square where it meets the baseline, rounded at the data end. */}
          <Bar dataKey="value" barSize={BAR_SIZE} radius={[0, 4, 4, 0]} isAnimationActive={false}>
            {rows.map((row, i) => (
              <Cell key={row.key} fill={fills?.[i] ?? theme.series[0]} />
            ))}
            {/* Outside the bar end, so a short bar never clips its own value. */}
            <LabelList
              dataKey="value"
              position="right"
              formatter={(value: unknown) => format(Number(value ?? 0))}
              style={{ fontSize: 11, fill: theme.muted }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

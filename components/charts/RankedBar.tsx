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
  /**
   * The long text that will not fit on an axis.
   *
   * A category whose name is a sentence — a CARC description, say — cannot be
   * an axis label at any width worth giving it. Put the code on the axis and
   * the sentence here, and the chart stops hiding the thing it is about.
   */
  detail?: string
  /**
   * What the end of the bar says, where the formatted value alone would be a
   * rate with no denominator — "60% of 20" rather than "60%". Falls back to
   * `format(value)`.
   */
  valueLabel?: string
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
  onSelect,
}: {
  data: RankedDatum[]
  format: (value: number) => string
  labelWidth?: number
  /** One colour per row, in the order `data` was given. */
  colors?: string[]
  /** A target or threshold, drawn as a hairline with a visible label. */
  reference?: { value: number; label: string }
  /**
   * Makes the bars a way in rather than a picture, called with the datum's
   * `key`. Optional: a chart nobody can drill into stays exactly as it was.
   */
  onSelect?: (key: string) => void
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
  // The bar-end text is resolved here, once, so a row with a `valueLabel` and a
  // row without one can share the chart — and so the right margin can be sized
  // to the longest of them rather than guessed.
  const rows = order.map(i => ({
    ...data[i],
    endLabel: data[i].valueLabel ?? format(data[i].value),
  }))
  const fills = colors ? order.map(i => colors[i]) : null
  const endWidth = Math.max(56, Math.ceil(Math.max(0, ...rows.map(r => r.endLabel.length)) * CHAR_PX) + 12)

  if (data.length === 0) {
    return (
      // flex-1 so a card stretched to match its neighbour centres the message
      // instead of leaving it at the top of an empty box. Inert elsewhere.
      <div className="flex min-h-32 flex-1 items-center justify-center">
        <p className="max-w-sm text-center text-sm text-gray-500">{emptyLabel}</p>
      </div>
    )
  }

  // Sized to fit the rows plus the axis band, so the card never grows its own
  // little scrollbar around a plot that almost fits.
  const height = rows.length * ROW_HEIGHT + AXIS_BAND + 8 + (reference ? 12 : 0)

  return (
    // The cursor is the only affordance a bar can carry — there is no hover
    // underline to lean on — and it goes on the wrapper because recharts does
    // not forward style onto the rendered rectangles.
    <div style={{ height }} className={onSelect ? 'cursor-pointer' : undefined}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={rows}
          layout="vertical"
          // Room above the plot for a reference line's label, which otherwise
          // renders half outside the chart and reads as a stray tick.
          margin={{ top: reference ? 16 : 4, right: endWidth, left: 0, bottom: 4 }}
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
            // Every row names its bar. Left to itself recharts drops alternate
            // labels the moment rows get tight, which leaves bars nobody can
            // identify without hovering each one.
            interval={0}
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
                footer={items => {
                  const row = items[0]?.payload as RankedDatum | undefined
                  return row?.detail ?? null
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
          <Bar
            dataKey="value"
            barSize={BAR_SIZE}
            radius={[0, 4, 4, 0]}
            isAnimationActive={false}
            onClick={
              onSelect
                ? (_, index) => {
                    // Guarded rather than indexed blind: recharts owns the
                    // index and a stale one would throw inside an event handler.
                    const row = rows[index]
                    if (row) onSelect(row.key)
                  }
                : undefined
            }
          >
            {rows.map((row, i) => (
              <Cell key={row.key} fill={fills?.[i] ?? theme.series[0]} />
            ))}
            {/* Outside the bar end, so a short bar never clips its own value. */}
            <LabelList
              dataKey="endLabel"
              position="right"
              // A halo in the card's own colour, so a label that lands on the
              // reference line stays legible instead of being struck through.
              style={{
                fontSize: 11,
                fill: theme.muted,
                paintOrder: 'stroke',
                stroke: theme.surface,
                strokeWidth: 3,
                strokeLinejoin: 'round',
              }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

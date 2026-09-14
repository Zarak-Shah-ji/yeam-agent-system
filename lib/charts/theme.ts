'use client'

import { useTheme } from '@/components/layout/theme-context'

/**
 * Every colour a chart is allowed to use.
 *
 * Charts used to hard-code hex (`#93c5fd`, `#2563eb`). That works in one theme
 * only: the app's dark mode re-themes itself by redefining `--color-*`, and a
 * literal hex in an SVG attribute does not follow. A pale blue bar on a dark
 * card was the visible symptom. So the palette is selected per mode here, and
 * charts read it through `useChartTheme()` rather than writing colours down.
 *
 * The values are not eyeballed. Both modes were run through the data-viz
 * validator against the surfaces the charts actually render on — white cards in
 * light mode, `#15181e` (`--color-white` under `.dark`) in dark — checking the
 * lightness band, the chroma floor, colour-blind separation (protanopia and
 * deuteranopia at full severity), the normal-vision floor, and contrast against
 * the surface. All pass. Re-run the validator before changing any hex here.
 */

/**
 * Identity — which series. Assigned in this order and never cycled.
 *
 * Two series is the most any chart in this app carries, so only the first two
 * slots are ever in play; the third is kept for the next one. Past that, the
 * answer is fewer series or a second chart, never a ninth colour.
 */
const SERIES_LIGHT = ['#2a78d6', '#eb6834', '#1baf7a'] as const
const SERIES_DARK = ['#3987e5', '#d95926', '#199e70'] as const

/**
 * Order — aging buckets, funnel stages. One hue, stepped by lightness, so the
 * reader sees the ordering in the colour itself.
 *
 * The ramp is not simply inverted for dark mode. In light mode further along
 * means darker; against a dark surface that would sink the far end into the
 * background, so the anchor flips and further along means lighter. Both
 * directions were validated for monotonic lightness, per-step separation, and
 * a near-surface end that still clears 2:1.
 */
const ORDINAL_LIGHT = ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#104281'] as const
const ORDINAL_DARK = ['#184f95', '#256abf', '#3987e5', '#6da7ec', '#b7d3f6'] as const

/**
 * State — good through critical. Reserved: a status colour never stands in for
 * "series 4", and it never carries meaning on its own. Everywhere one appears
 * it is paired with a label, because on a light surface `warning` and `serious`
 * sit below 3:1 by design.
 */
const STATUS = {
  good: '#0ca30c',
  warning: '#fab219',
  serious: '#ec835a',
  critical: '#d03b3b',
} as const

export type ChartTheme = {
  /** Categorical slots, in fixed order. Index by series position, never by rank. */
  series: readonly string[]
  /** One-hue ramp for ordered categories. Index 0 is the first step. */
  ordinal: readonly string[]
  status: typeof STATUS
  /** The card the chart sits on. Doubles as the gap and ring colour. */
  surface: string
  grid: string
  axis: string
  /** Axis ticks and other recessive chart text. */
  muted: string
  ink: string
}

const LIGHT: ChartTheme = {
  series: SERIES_LIGHT,
  ordinal: ORDINAL_LIGHT,
  status: STATUS,
  surface: '#ffffff',
  grid: '#e5e7eb',
  axis: '#d1d5db',
  muted: '#6b7280',
  ink: '#111827',
}

const DARK: ChartTheme = {
  series: SERIES_DARK,
  ordinal: ORDINAL_DARK,
  status: STATUS,
  surface: '#15181e',
  grid: '#2c3038',
  axis: '#363b45',
  muted: '#9aa1ad',
  ink: '#f2f4f8',
}

export function useChartTheme(): ChartTheme {
  return useTheme().theme === 'dark' ? DARK : LIGHT
}

/**
 * Take the first `count` steps of the ordinal ramp, spread across its range.
 *
 * A three-stage funnel should span light to dark, not stop a third of the way
 * along, so the steps are sampled rather than sliced.
 */
export function ordinalSteps(theme: ChartTheme, count: number): string[] {
  const ramp = theme.ordinal
  if (count <= 1) return [ramp[ramp.length - 1]]
  return Array.from({ length: count }, (_, i) =>
    ramp[Math.round((i / (count - 1)) * (ramp.length - 1))]
  )
}

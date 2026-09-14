/** Shared number formatting, so an axis tick and its table cell never disagree. */

const USD = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

export function usd(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : USD.format(value)
}

/** Axis ticks only. `$12k` fits under a tick where `$12,400` does not. */
export function usdCompact(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`
  if (abs >= 1_000) return `$${Math.round(value / 1_000)}k`
  return `$${Math.round(value)}`
}

/** A percentage, or a dash. 0/0 is not zero and must not render as 0%. */
export function pct(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : `${value.toFixed(1)}%`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** `2026-03` becomes `Mar 26`. */
export function monthLabel(month: string): string {
  const [year, m] = month.split('-')
  return `${MONTHS[Number(m) - 1]} ${year.slice(2)}`
}

/** Long category names get an ellipsis rather than a squeezed axis. */
export function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

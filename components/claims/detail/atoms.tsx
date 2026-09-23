import { format } from 'date-fns'

export const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

/** Wire dates are Date on some paths and strings on others. */
export function day(value: Date | string | null | undefined): string {
  if (!value) return '—'
  const d = typeof value === 'string' ? new Date(value) : value
  return Number.isNaN(d.getTime()) ? '—' : format(d, 'MMM d, yyyy')
}

export function toDateInput(value: Date | string | null | undefined): string {
  if (!value) return ''
  const d = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function Money({ value }: { value: number | null }) {
  return <>{value === null ? '—' : usd.format(value)}</>
}

/** One label/value pair in a facts grid. */
export function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-gray-900">{children}</dd>
    </div>
  )
}

/**
 * A code as imported, plus what the biller says it should have been.
 *
 * Both, never one: "we billed 99213, it should have been 99214" is the
 * correction, and showing only the corrected value destroys the half a
 * corrected claim is actually built from.
 */
export function Code({ imported, corrected }: { imported: string | null; corrected: string | null }) {
  if (!corrected) return <span className="font-mono text-xs">{imported ?? '—'}</span>
  return (
    <span className="font-mono text-xs">
      <span className="text-gray-400 line-through">{imported ?? '—'}</span>{' '}
      <span className="font-semibold text-gray-900">{corrected}</span>
      <span className="ml-1 font-sans text-[11px] font-normal text-gray-500">corrected</span>
    </span>
  )
}

'use client'

import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * One collapsed part of a record, and the row that decides whether to open it.
 *
 * Shared by the claim panel and the payer panel, which follow the same rule:
 * a headline that answers the question the record was opened for, then
 * collapsed sections each summarised well enough to skip. Generic over the id
 * so each panel keeps its own closed set of section names.
 *
 * Deliberately NOT `<details name="…">`, the exclusive-accordion attribute.
 * Support is fine — Baseline since September 2024 — but it fights React in two
 * specific ways. When the browser auto-closes a sibling it sets `open` on the
 * DOM node itself; React still believes `open={true}`, sees no change on the
 * next render, and the next click on that summary does nothing. And opening B
 * fires `toggle` on both B and A, so two handlers race to write the URL and
 * which one wins depends on dispatch order.
 *
 * None of that is needed: one URL param holds one value, so at most one section
 * can be open by construction. The URL is the single source of truth and this
 * only reports back to it.
 */
export function Section<Id extends string>({
  id,
  active,
  onSection,
  summary,
  children,
}: {
  id: Id
  active: Id | null
  onSection: (id: Id | null) => void
  /** The one fact that decides whether this is worth opening. */
  summary: React.ReactNode
  children: React.ReactNode
}) {
  const open = active === id

  return (
    <details
      open={open}
      // Idempotent: a toggle that only reports back the state React already set
      // writes nothing, so this cannot loop against the URL.
      onToggle={e => {
        const next = e.currentTarget.open
        if (next !== open) onSection(next ? id : null)
      }}
      className="rounded-md border border-gray-200"
    >
      <summary
        className={cn(
          'flex cursor-pointer list-none items-center gap-2 px-3 py-2.5',
          'hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
          open && 'border-b border-gray-200',
        )}
      >
        <ChevronRight
          className={cn('h-4 w-4 shrink-0 text-gray-400 transition-transform', open && 'rotate-90')}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">{summary}</div>
      </summary>
      <div className="px-3 py-3">{children}</div>
    </details>
  )
}

/** The label/preview pair every section summary uses, so the rows line up. */
export function SectionSummary({
  label,
  preview,
}: {
  label: string
  preview: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</span>
      <span className="text-sm text-gray-700">{preview}</span>
    </div>
  )
}

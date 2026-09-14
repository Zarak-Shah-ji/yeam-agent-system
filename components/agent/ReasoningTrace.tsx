'use client'

import { useState } from 'react'
import { format } from 'date-fns'
import { ChevronRight, Database, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { labelFor, type TraceStep } from '@/lib/ai/trace'

/**
 * Where an answer came from, under the answer.
 *
 * Open while the turn is running — watching the query being chosen is most of
 * the point — then collapsed to a single line once the answer is there, so a
 * scrollback of twenty turns is readable. A manual toggle sticks: once someone
 * has said they want it open, it stays open when the next chunk arrives.
 */
export function ReasoningTrace({
  steps,
  pending,
  isStreaming,
}: {
  steps: TraceStep[]
  pending: { tool: string; args: Record<string, unknown> } | null
  isStreaming: boolean
}) {
  // Null means "nobody has said" — follow the turn. Once the reader clicks,
  // their choice holds, including after the answer lands. Derived rather than
  // synced in an effect, so there is no render where the two disagree.
  const [override, setOverride] = useState<boolean | null>(null)
  const open = override ?? isStreaming

  if (steps.length === 0 && !pending) return null

  const toggle = () => setOverride(!open)

  return (
    <div className="mb-1.5">
      <button
        onClick={toggle}
        aria-expanded={open}
        className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors"
      >
        <ChevronRight className={cn('h-3 w-3 shrink-0 transition-transform', open && 'rotate-90')} />
        <span>{summarize(steps, pending)}</span>
      </button>

      {open && (
        <ol className="mt-1 ml-1.5 space-y-2 border-l border-gray-200 pl-3">
          {steps.map((step, i) => (
            <li key={`${step.tool}-${i}`} className="relative">
              <span className="absolute -left-[1.0625rem] top-1.5 h-1.5 w-1.5 rounded-full bg-gray-300" />
              <p className="text-xs font-medium text-gray-700">{step.label}</p>

              {step.args.length > 0 && (
                <p className="mt-0.5 flex flex-wrap gap-1">
                  {step.args.map(arg => (
                    <span
                      key={arg.name}
                      className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[11px] text-gray-600"
                    >
                      {arg.name}: {arg.value}
                    </span>
                  ))}
                </p>
              )}

              <p className="mt-0.5 text-xs text-gray-500">{describe(step)}</p>

              {step.source && (
                <p className="mt-0.5 flex items-center gap-1 text-xs text-gray-400">
                  <Database className="h-3 w-3 shrink-0" />
                  {/* Formatted here, not on the server: see TraceStep.source. */}
                  <span className="truncate">
                    {step.source.filename}
                    {step.source.at && ` · imported ${format(new Date(step.source.at), 'MMM d')}`}
                  </span>
                </p>
              )}

              {step.caveat && (
                <p className="mt-0.5 text-xs text-yellow-700">{step.caveat}</p>
              )}
            </li>
          ))}

          {pending && (
            <li className="relative">
              <span className="absolute -left-[1.0625rem] top-1.5 h-1.5 w-1.5 animate-pulse rounded-full bg-blue-400" />
              <p className="flex items-center gap-1.5 text-xs text-gray-500">
                <Loader2 className="h-3 w-3 shrink-0 animate-spin text-blue-400" />
                {labelFor(pending.tool)}…
              </p>
            </li>
          )}
        </ol>
      )}
    </div>
  )
}

/** The collapsed line. Says what was read, not that something was read. */
function summarize(steps: TraceStep[], pending: { tool: string } | null): string {
  if (steps.length === 0) return 'Working…'

  const rows = steps.reduce((sum, s) => sum + (s.count ?? 0), 0)
  const sources = steps.length === 1 ? '1 lookup' : `${steps.length} lookups`
  const suffix = pending ? ' · still reading' : ''

  return rows > 0
    ? `How I got this · ${sources} · ${rows} row${rows === 1 ? '' : 's'}${suffix}`
    : `How I got this · ${sources}${suffix}`
}

/** What came back, in a biller's terms rather than the tool's. */
function describe(step: TraceStep): string {
  if (step.count === null) return 'Read the current totals'
  if (step.count === 0) return 'Nothing matched'
  const of = step.total !== null ? ` of ${step.total} matching` : ''
  return `Returned ${step.count}${of} row${step.count === 1 && !of ? '' : 's'}`
}

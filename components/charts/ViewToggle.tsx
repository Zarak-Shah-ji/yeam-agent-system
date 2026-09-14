'use client'

import { useCallback, useSyncExternalStore } from 'react'
import { BarChart3, Table2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export type AnalyticsView = 'chart' | 'numbers'

const STORAGE_KEY = 'yeam.analytics.view'

/**
 * Charts or numbers, for every analytics surface at once.
 *
 * Charts are the default: the first question anyone brings to this page is
 * "which way is it going", and a table answers that slowly. The numbers are one
 * click away and are the same numbers, not a summary of them — a chart whose
 * values are only reachable by hovering it is not readable, so every chart on
 * these pages has a table twin holding the exact figures.
 *
 * The choice is shared across Analytics and Payers and remembered, because a
 * reader who prefers tables prefers them on both pages and on Monday too.
 *
 * Stored state is read through `useSyncExternalStore` rather than mirrored into
 * component state, for the same reason the theme is: two copies of one
 * preference can disagree, and the render that runs on the server has no
 * localStorage to read. The server snapshot is always the chart view, and React
 * corrects it during hydration.
 */
const listeners = new Set<() => void>()

/**
 * Set once the reader picks a view, and thereafter preferred over storage.
 *
 * In a private window `setItem` throws, so without this the toggle would look
 * like a dead button — clicked, written nowhere, read back as the default.
 */
let chosen: AnalyticsView | null = null

function subscribe(onChange: () => void) {
  listeners.add(onChange)
  return () => {
    listeners.delete(onChange)
  }
}

function getSnapshot(): AnalyticsView {
  if (chosen !== null) return chosen
  try {
    return localStorage.getItem(STORAGE_KEY) === 'numbers' ? 'numbers' : 'chart'
  } catch {
    return 'chart'
  }
}

function getServerSnapshot(): AnalyticsView {
  return 'chart'
}

export function useAnalyticsView(): [AnalyticsView, (next: AnalyticsView) => void] {
  const view = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  const choose = useCallback((next: AnalyticsView) => {
    chosen = next
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Private mode, or storage full — the choice holds for this tab, it just
      // will not outlive it.
    }
    for (const onChange of listeners) onChange()
  }, [])

  return [view, choose]
}

const OPTIONS = [
  { value: 'chart' as const, label: 'Charts', Icon: BarChart3 },
  { value: 'numbers' as const, label: 'Numbers', Icon: Table2 },
]

export function ViewToggle({
  value,
  onChange,
  className,
}: {
  value: AnalyticsView
  onChange: (next: AnalyticsView) => void
  className?: string
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Show analytics as"
      className={cn(
        'inline-flex items-center gap-0.5 rounded-md border border-gray-200 bg-gray-50 p-0.5',
        className
      )}
    >
      {OPTIONS.map(({ value: option, label, Icon }) => {
        const selected = value === option
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
              selected
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-900'
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            {label}
          </button>
        )
      })}
    </div>
  )
}

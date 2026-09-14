'use client'

import { useCallback, useSyncExternalStore } from 'react'
import { THEME_CLASS, THEME_STORAGE_KEY, type Theme } from '@/lib/theme'

// The class on <html> is the single source of truth — the bootstrap script in
// app/layout.tsx sets it before React exists — so the theme is read from the
// DOM rather than mirrored into state that could disagree with it.
const listeners = new Set<() => void>()

function subscribe(onChange: () => void) {
  listeners.add(onChange)
  return () => {
    listeners.delete(onChange)
  }
}

function getSnapshot(): Theme {
  return document.documentElement.classList.contains(THEME_CLASS) ? 'dark' : 'light'
}

// The server renders one HTML for everyone, so this is the default rather than
// the viewer's theme: dark, matching the bootstrap script. A viewer who stored
// 'light' is corrected on hydration, one render later.
function getServerSnapshot(): Theme {
  return 'dark'
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  const toggle = useCallback(() => {
    const next: Theme = getSnapshot() === 'dark' ? 'light' : 'dark'
    document.documentElement.classList.toggle(THEME_CLASS, next === 'dark')
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next)
    } catch {
      // Private mode, or storage full — the theme still applies for this tab.
    }
    for (const onChange of listeners) onChange()
  }, [])

  return { theme, toggle }
}

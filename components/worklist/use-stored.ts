'use client'

import { useSyncExternalStore } from 'react'

/**
 * A layout preference that lives in localStorage, read the way ViewToggle and
 * useIsWideScreen read theirs.
 *
 * ── Why this exists, and what it replaces ────────────────────────────────────
 *
 * The worklist keeps three of these — whether the summary block is open, the
 * column widths, and the split ratio — and all three were written as
 * `useState(readLocalStorage)`. That is a hydration bug, and it produced one:
 * the server has no localStorage, so it renders the default ("Show the
 * breakdown", `aria-expanded={false}`) while the browser hydrates with the
 * stored value ("Hide", `true`), and React throws out the tree.
 *
 * It was intermittent, which is why it survived. `app/(dashboard)/worklist/
 * page.tsx` wraps this view in <Suspense> — it has to, because WorklistView
 * calls useSearchParams — and whether Next server-renders a suspended child
 * varies with how the page was reached and whether the route was already
 * compiled. So the mismatch fires on some loads and not others.
 *
 * ── Why a store rather than state seeded in an effect ────────────────────────
 *
 * Both work, and useSyncExternalStore is the one this codebase already uses
 * twice. It also states the truth plainly: a value owned by the browser, read
 * by React, with a server snapshot that is explicitly the default. An effect
 * would say the same thing less directly and would trip the React compiler lint
 * that rejects setState in an effect body.
 *
 * ── The flash is not avoidable, and the old code did not avoid it ────────────
 *
 * The comment that used to sit on these readers said localStorage was read
 * synchronously on first paint "so there is no flash of default widths". That
 * cannot be true of anything server-rendered: the HTML is built without the
 * browser's storage, so the default is on screen either way. The choice was
 * never flash-or-no-flash, it was flash-or-broken-tree.
 */

export type Stored<T> = {
  /** Subscribe to it. Returns the server default until the browser takes over. */
  use: () => T
  /** The current value without subscribing — for event handlers. */
  read: () => T
  /**
   * Write it.
   *
   * `persist: false` updates the value for this tab without touching
   * localStorage, which is what a drag wants: a resize is one decision, and a
   * synchronous storage write on every pointermove frame is main-thread work
   * nobody asked for. The commit at the end of the gesture persists it.
   */
  set: (next: T, persist?: boolean) => void
}

export function createStored<T>({
  key,
  fallback,
  parse,
  serialize,
}: {
  key: string
  /** The server snapshot, and what an unreadable or corrupt value falls back to. */
  fallback: T
  parse: (raw: string) => T
  serialize: (value: T) => string
}): Stored<T> {
  const listeners = new Set<() => void>()

  /*
    Set once anything writes, and thereafter preferred over storage.

    Two jobs. In a private window `setItem` throws, so without this a drag would
    look like a dead control — moved, written nowhere, read back as the default.
    And it guarantees the reference React sees is stable across reads, which
    useSyncExternalStore requires: returning a freshly parsed object from every
    getSnapshot call is an infinite render loop.
  */
  let chosen: T | null = null

  /** The last parse, and the raw string it came from, for that same stability. */
  let cached: T = fallback
  let cachedRaw: string | null | undefined = undefined

  function getSnapshot(): T {
    if (chosen !== null) return chosen
    let raw: string | null = null
    try {
      raw = localStorage.getItem(key)
    } catch {
      return fallback
    }
    if (raw === null) return fallback
    if (raw !== cachedRaw) {
      cachedRaw = raw
      try {
        cached = parse(raw)
      } catch {
        // A value written by an older release, or hand-edited. The default is a
        // better answer than a crash on a page somebody works in all day.
        cached = fallback
      }
    }
    return cached
  }

  const getServerSnapshot = () => fallback

  function subscribe(onChange: () => void) {
    listeners.add(onChange)
    return () => {
      listeners.delete(onChange)
    }
  }

  return {
    use: () => useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot),
    read: () => (typeof window === 'undefined' ? fallback : getSnapshot()),
    set(next, persist = true) {
      chosen = next
      if (persist) {
        try {
          localStorage.setItem(key, serialize(next))
        } catch {
          // Private mode, or storage full. The choice holds for this tab; it
          // just will not outlive it.
        }
      }
      for (const onChange of listeners) onChange()
    },
  }
}

'use client'

import { useCallback, useMemo, useRef } from 'react'
import { trpc } from '@/lib/trpc/client'
import type { UsageEventName } from '@/lib/usage/events'

/**
 * Record what someone did, without ever getting in their way.
 *
 * Three properties, and each one is a way this could otherwise become a bug
 * that a biller notices:
 *
 *  1. IT CANNOT FAIL LOUDLY. No retry, no toast, no thrown promise. A dropped
 *     count is a worse dataset; a failed click is a worse product.
 *  2. IT CANNOT BLOCK. Nothing awaits it and nothing invalidates a query off
 *     it, so it never delays the render it describes.
 *  3. IT CANNOT DOUBLE-COUNT A RENDER. `once` keys an event to a string the
 *     caller chooses — the claim id for an open — and fires at most one per
 *     key. React strict mode double-invokes effects in development, and a
 *     dialog that refetches on focus would otherwise report two opens for one.
 *     This is the half the server cannot do: by the time a request arrives, a
 *     remount and a second visit look identical.
 *
 * The keys live for the lifetime of the mounted component. Closing the dialog
 * and reopening the same claim unmounts it and counts again, which is right —
 * that is two opens.
 */
export function useUsage() {
  const record = trpc.usage.record.useMutation({
    retry: false,
    // Swallowed on purpose. See property 1.
    onError: () => {},
  })
  // Held in a ref rather than state: firing an event must never cause a render.
  const fired = useRef(new Set<string>())

  // `mutate` is referentially stable across renders in react-query v5, which is
  // what lets these be useCallback'd at all — and callers do put them in effect
  // dependency lists.
  const { mutate } = record

  const track = useCallback(
    (name: UsageEventName, detail?: string) => {
      mutate({ name, detail: detail ?? null })
    },
    [mutate],
  )

  const once = useCallback(
    (key: string, name: UsageEventName, detail?: string) => {
      if (fired.current.has(key)) return
      fired.current.add(key)
      mutate({ name, detail: detail ?? null })
    },
    [mutate],
  )

  // Memoised so the returned object is stable across renders: callers put this
  // in effect dependency lists, and a fresh object every render would re-run
  // them forever. `track` and `once` are already stable.
  return useMemo(() => ({ track, once }), [track, once])
}

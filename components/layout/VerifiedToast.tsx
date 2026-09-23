'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import { CheckCircle2, AlertCircle, X } from 'lucide-react'

type Outcome = 'ok' | 'invalid'

/**
 * The outcome in the URL, read once per page load.
 *
 * Captured on first read rather than re-read each render, because the param is
 * stripped as soon as it has been seen (below) — re-reading would make the toast
 * vanish the moment it appeared. A verification link always arrives as a full
 * page load (it is a server redirect), which starts this module fresh, so the
 * capture never outlives the navigation it describes.
 */
let captured: { outcome: Outcome | null } | null = null

function readOutcome(): Outcome | null {
  if (!captured) {
    const value = new URLSearchParams(window.location.search).get('verified')
    captured = { outcome: value === 'ok' || value === 'invalid' ? value : null }
  }
  return captured.outcome
}

/** Nothing to subscribe to: the URL is read once, not watched. */
const noSubscription = () => () => {}

/**
 * The outcome of clicking a verification link.
 *
 * Without this the redeem route was as silent as the login page used to be: a
 * good link left you on the worklist with the banner gone, which is legible
 * enough, but a dead one left you on the worklist with the banner still there
 * and no clue why. Same silent-failure shape, same fix — say what happened.
 *
 * Read from window rather than useSearchParams so this does not opt the
 * dashboard out of static rendering, matching the login page. It is read through
 * useSyncExternalStore — null on the server and during hydration, the real value
 * straight after — which is how React wants browser-only state read. The earlier
 * version set state from an effect, which lint rightly refuses
 * (react-hooks/set-state-in-effect) and which kept CI red.
 *
 * The param is then stripped with replaceState: it describes one navigation,
 * and leaving it on the URL means a refresh or a shared link re-announces a
 * verification that already happened.
 */
export function VerifiedToast() {
  const outcome = useSyncExternalStore(noSubscription, readOutcome, () => null)
  const [dismissed, setDismissed] = useState(false)

  // Syncing an external system (the address bar), so no state is set here.
  useEffect(() => {
    if (!outcome) return
    const url = new URL(window.location.href)
    url.searchParams.delete('verified')
    window.history.replaceState({}, '', url.pathname + url.search + url.hash)
  }, [outcome])

  // Success is transient — the banner disappearing is the durable signal, so
  // the toast only has to confirm why. A failure stays until dismissed, because
  // it is asking the reader to do something.
  useEffect(() => {
    if (outcome !== 'ok') return
    const t = setTimeout(() => setDismissed(true), 6000)
    return () => clearTimeout(t)
  }, [outcome])

  const state = dismissed ? null : outcome

  if (!state) return null

  const ok = state === 'ok'

  return (
    <div
      role="status"
      className={`mb-4 flex items-center gap-3 rounded-lg border px-4 py-3 ${
        ok
          ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
          : 'border-amber-200 bg-amber-50 text-amber-900'
      }`}
    >
      {ok ? (
        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
      ) : (
        <AlertCircle className="h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
      )}

      <p className="min-w-0 flex-1 text-sm">
        {ok
          ? 'Your email is confirmed.'
          : 'That confirmation link has already been used or has expired. Send yourself a new one.'}
      </p>

      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        className={`shrink-0 rounded p-1 transition-colors ${
          ok ? 'text-emerald-600 hover:bg-emerald-100' : 'text-amber-600 hover:bg-amber-100'
        }`}
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  )
}

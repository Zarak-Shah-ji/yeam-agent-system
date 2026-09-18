'use client'

import { useEffect, useState } from 'react'
import { CheckCircle2, AlertCircle, X } from 'lucide-react'

/**
 * The outcome of clicking a verification link.
 *
 * Without this the redeem route was as silent as the login page used to be: a
 * good link left you on the worklist with the banner gone, which is legible
 * enough, but a dead one left you on the worklist with the banner still there
 * and no clue why. Same silent-failure shape, same fix — say what happened.
 *
 * Read from window rather than useSearchParams so this does not opt the
 * dashboard out of static rendering, matching the login page. The param is then
 * stripped with replaceState: it describes one navigation, and leaving it on
 * the URL means a refresh or a shared link re-announces a verification that
 * already happened.
 */
export function VerifiedToast() {
  const [state, setState] = useState<'ok' | 'invalid' | null>(null)

  useEffect(() => {
    const url = new URL(window.location.href)
    const value = url.searchParams.get('verified')
    if (value !== 'ok' && value !== 'invalid') return

    setState(value)
    url.searchParams.delete('verified')
    window.history.replaceState({}, '', url.pathname + url.search + url.hash)
  }, [])

  // Success is transient — the banner disappearing is the durable signal, so
  // the toast only has to confirm why. A failure stays until dismissed, because
  // it is asking the reader to do something.
  useEffect(() => {
    if (state !== 'ok') return
    const t = setTimeout(() => setState(null), 6000)
    return () => clearTimeout(t)
  }, [state])

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
        onClick={() => setState(null)}
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

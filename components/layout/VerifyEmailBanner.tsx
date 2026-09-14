'use client'

import { useState } from 'react'
import { Mail, Check, Loader2, X } from 'lucide-react'
import { trpc } from '@/lib/trpc/client'

/**
 * "Confirm your email", with a way to get another link.
 *
 * Deliberately not a gate. Nothing in the app checks emailVerified before
 * letting someone work, and it should stay that way until delivery is proven:
 * every account that existed before verification shipped has emailVerified
 * null, so a gate written today would lock out the whole customer base to catch
 * nobody. This tells the truth and offers the fix.
 *
 * Dismissible, and dismissal is per tab rather than stored. A banner that stays
 * gone forever after one impatient click defeats the point; one that reappears
 * on the next page load is a nudge rather than a wall.
 */
export function VerifyEmailBanner({ email }: { email: string }) {
  const [dismissed, setDismissed] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  const resend = trpc.auth.resendVerification.useMutation({
    onSuccess: () => {
      setDone(true)
      setError('')
    },
    onError: err => setError(err.message),
  })

  if (dismissed) return null

  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
      <Mail className="h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />

      <p className="min-w-0 flex-1 text-sm text-amber-900">
        {done ? (
          <>
            Sent. Check <span className="font-medium">{email}</span> for the link — it
            expires in 24 hours.
          </>
        ) : (
          <>
            Confirm <span className="font-medium">{email}</span> so we know we can reach
            you about this workspace.
          </>
        )}
        {error && <span className="ml-1 text-amber-700">{error}</span>}
      </p>

      {!done && (
        <button
          type="button"
          onClick={() => resend.mutate()}
          disabled={resend.isPending}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-amber-300 bg-white px-2.5 py-1.5 text-xs font-medium text-amber-900 transition-colors hover:bg-amber-100 disabled:opacity-60"
        >
          {resend.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          Send the link
        </button>
      )}

      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        className="shrink-0 rounded p-1 text-amber-600 transition-colors hover:bg-amber-100 hover:text-amber-900"
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  )
}

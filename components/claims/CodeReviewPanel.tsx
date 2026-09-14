'use client'

import { format } from 'date-fns'
import { Check, Loader2, Sparkles } from 'lucide-react'
import { trpc } from '@/lib/trpc/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { UpgradeButton, PlanChip } from '@/components/subscription/Upgrade'
import { isUpgradeRequired, upgradeReason } from '@/lib/plans'
import { Skeleton } from '@/components/ui/skeleton'

const SCOPE_LABEL: Record<string, string> = {
  'payer+cpt': 'this payer, this code',
  cpt: 'this code, all payers',
  payer: 'this payer, all codes',
}

/**
 * What this practice's own data says about the claim's codes.
 *
 * The computed half renders first and always — the payer's reason code and the
 * practice's own paid rates are the evidence, and they need no model and no API
 * key. The generated reading is offered on top, behind an explicit click,
 * because it costs a call.
 *
 * Every rate shows the number of claims behind it. A 100% paid rate over two
 * claims is not a fact about a payer, and printing it bare is how it becomes
 * one. The same reason the candidate list says what it is: diagnoses this
 * practice has actually been paid for on this procedure, not a policy table and
 * not a model's recollection.
 */
export function CodeReviewPanel({
  claimNumber,
  onApplyIcd10,
}: {
  claimNumber: string
  onApplyIcd10: (code: string) => void
}) {
  const signals = trpc.claims.signals.useQuery({ claimNumber })
  const utils = trpc.useUtils()

  const review = trpc.claims.review.useMutation({
    onSuccess: () => void utils.claims.signals.invalidate({ claimNumber }),
  })

  if (signals.isLoading) return <Skeleton className="h-24 w-full" />

  // Same rule as the dialog: a failed query says so rather than vanishing. The
  // panel is one section of a larger record, so it fails in place.
  if (signals.error) {
    return (
      <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
        Code review could not be loaded: {signals.error.message}
      </p>
    )
  }
  if (!signals.data) return null

  const { signals: s, available, cached } = signals.data
  const body = review.data?.body ?? cached?.body ?? null
  const at = review.data?.at ?? cached?.at ?? null

  return (
    <div className="rounded-md border border-gray-200 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Code review</p>
        {s.coherence === 'consistent' && (
          <Badge variant="success" className="gap-1">
            <Check className="h-3 w-3" aria-hidden="true" />
            Pairing checks out
          </Badge>
        )}
      </div>

      {(s.cptDescription || s.icdDescription) && (
        <p className="mt-1.5 text-sm text-gray-700">
          {s.cpt && (
            <>
              <span className="font-mono text-xs">{s.cpt}</span>
              {s.cptDescription ? ` — ${s.cptDescription}` : ''}
            </>
          )}
          {s.icd10 && (
            <>
              {s.cpt ? ' · ' : ''}
              <span className="font-mono text-xs">{s.icd10}</span>
              {s.icdDescription ? ` — ${s.icdDescription}` : ''}
            </>
          )}
        </p>
      )}

      {/* The practice's own history. Never a rate without its denominator. */}
      {s.history && (
        <p className="mt-2 text-sm text-gray-700">
          Across <span className="font-medium">{s.history.n}</span> of your claims (
          {SCOPE_LABEL[s.history.scope] ?? s.history.scope}):{' '}
          <span className="font-medium">{s.history.paidRate}% paid</span>,{' '}
          {s.history.deniedRate}% denied
          {s.history.topCarc && (
            <>
              , most often for{' '}
              <span className="font-mono text-xs">{s.history.topCarc.code}</span> (
              {s.history.topCarc.count})
            </>
          )}
          .
        </p>
      )}

      {s.candidates.length > 0 && (
        <div className="mt-2">
          <p className="text-xs text-gray-500">
            Diagnoses your practice has been paid for on this procedure:
          </p>
          <ul className="mt-1 space-y-1">
            {s.candidates.map(c => (
              <li key={c.icd10} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-mono text-xs">{c.icd10}</span>
                {c.description && <span className="text-gray-600">{c.description}</span>}
                <span className="text-xs text-gray-500">
                  {c.paidRate}% paid · {c.n} claim{c.n === 1 ? '' : 's'}
                  {c.thin && ' · too few to rely on'}
                </span>
                {c.current ? (
                  <Badge variant="outline">on this claim</Badge>
                ) : (
                  <button
                    type="button"
                    className="text-xs font-medium text-blue-600 underline"
                    onClick={() => onApplyIcd10(c.icd10)}
                  >
                    Use as correction
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {s.limits.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {s.limits.map((limit, i) => (
            <li key={i} className="text-xs text-gray-500">
              {limit}
            </li>
          ))}
        </ul>
      )}

      {body && (
        <div className="mt-3 border-t border-gray-200 pt-3">
          <p className="whitespace-pre-wrap text-sm text-gray-800">{body}</p>
          {at && (
            <p className="mt-1.5 text-xs text-gray-400">
              Reviewed {format(new Date(at), 'MMM d, yyyy')}
            </p>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {isUpgradeRequired(review.error) ? (
          // The plan wall, shown where the button was. Everything above this —
          // the computed signals — is free and stays on the screen, so the wall
          // covers the reading and not the evidence.
          <>
            <PlanChip label="Practice plan" />
            <p className="text-xs text-gray-500">{upgradeReason(review.error)}</p>
            <UpgradeButton variant="outline">Upgrade</UpgradeButton>
          </>
        ) : available ? (
          <Button
            size="sm"
            variant="outline"
            disabled={review.isPending}
            onClick={() => review.mutate({ claimNumber })}
          >
            {review.isPending ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                Reading…
              </>
            ) : (
              <>
                <Sparkles className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                {body ? 'Review again' : 'Read this back to me'}
              </>
            )}
          </Button>
        ) : (
          <p className="text-xs text-gray-500">
            Written review needs GEMINI_API_KEY. The figures above are computed and do not.
          </p>
        )}
      </div>

      {review.error && !isUpgradeRequired(review.error) && (
        <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {review.error.message}
        </p>
      )}

      {/*
        The boundary, on screen rather than buried: this server holds no chart
        note, by design. Everything above is drawn from codes, amounts and what
        the payer said — which cannot tell you what was actually done at a visit.
      */}
      <p className="mt-2 text-xs text-gray-500">
        Based on your claims data and the payer&rsquo;s reason codes. Nothing here has seen the
        chart — verify against the documentation before resubmitting.
      </p>
    </div>
  )
}

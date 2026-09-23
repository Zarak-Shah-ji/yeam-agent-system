'use client'

import { Loader2, ShieldCheck } from 'lucide-react'
import { trpc } from '@/lib/trpc/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { UpgradeButton, PlanChip } from '@/components/subscription/Upgrade'
import { isUpgradeRequired, upgradeReason } from '@/lib/plans'
import { LEAVE_AS_BILLED, type Verdict } from '@/lib/claims/predict'

/**
 * The bounded verdict, and what it was and was not asked.
 *
 * Every number here is a probability the model actually returned, not a
 * rewording of one. The chosen diagnosis came out of a finite map built from
 * this practice's own settled claims, so it cannot be a code you have never
 * been paid for — that is a property of how it was asked, not a claim about the
 * model's care.
 *
 * A judgment that was skipped says why and stops. That is the whole discipline:
 * a question with no evidence behind it gets no answer rather than a plausible
 * one, because a plausible one is indistinguishable from a real one on screen.
 */
function Row({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-1.5">
      <span className="w-40 shrink-0 text-xs uppercase tracking-wide text-gray-500">{label}</span>
      <span className="min-w-0 flex-1 text-sm text-gray-800">{children}</span>
    </div>
  )
}

function Skipped({ because }: { because: string }) {
  return <span className="text-gray-500">Not asked — {because}</span>
}

/**
 * How concentrated the answer was — NOT how likely it is to be right.
 *
 * TypeSafe's own guidance is explicit about this: confidence summarises how
 * tightly the probability sat on one option, not overall correctness or
 * permission to act. Several acceptable alternatives spread it out. Printing it
 * as "82% confident" invites a biller to read it as "82% likely correct", which
 * is a different and much stronger claim than the number supports.
 */
function Spread({ value }: { value: number }) {
  const pct = Math.round(value * 100)
  return (
    <span
      className="ml-1 text-xs text-gray-500"
      title="How concentrated the answer was across the options — not a probability of being correct."
    >
      · {pct}% of the weight on this option
    </span>
  )
}

export function VerdictPanel({
  claimNumber,
  verdict,
  available,
}: {
  claimNumber: string
  verdict: Verdict | null
  available: boolean
}) {
  const utils = trpc.useUtils()
  const predict = trpc.claims.predict.useMutation({
    onSuccess: () => void utils.claims.signals.invalidate({ claimNumber }),
  })

  const current = predict.data?.verdict ?? verdict

  return (
    <div className="mt-3 border-t border-gray-200 pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-gray-500">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
          Prediction
        </p>
        {current && (
          <Badge variant="outline" className="font-normal">
            bounded to {current.allowedCodes.length} code
            {current.allowedCodes.length === 1 ? '' : 's'} from your history
          </Badge>
        )}
      </div>

      {current && (
        <div className="mt-1.5 divide-y divide-gray-100">
          <Row label="Remedy">
            {current.remedy.asked ? (
              <>
                <span className="font-medium">{current.remedy.label}</span>
                <Spread value={current.remedy.confidence} />
              </>
            ) : (
              <Skipped because={current.remedy.because} />
            )}
          </Row>

          <Row label="Diagnosis">
            {current.bestIcd10.asked ? (
              current.bestIcd10.choice === LEAVE_AS_BILLED ? (
                <>
                  <span className="font-medium">Leave as billed</span>
                  <Spread value={current.bestIcd10.confidence} />
                  <span className="ml-1 text-xs text-gray-500">
                    — nothing in your settled history is better evidenced
                  </span>
                </>
              ) : (
                <>
                  <span className="font-mono font-medium">{current.bestIcd10.choice}</span>
                  <Spread value={current.bestIcd10.confidence} />
                  <span className="ml-1 text-xs text-gray-500">
                    chosen from {current.bestIcd10.options.length} option
                    {current.bestIcd10.options.length === 1 ? '' : 's'}
                  </span>
                </>
              )
            ) : (
              <Skipped because={current.bestIcd10.because} />
            )}
          </Row>

          <Row label="If resubmitted as billed">
            {current.denyAgain.asked ? (
              <>
                <span className="font-medium">
                  {Math.round(current.denyAgain.probability * 100)}% chance
                </span>{' '}
                this payer denies it again
              </>
            ) : (
              <Skipped because={current.denyAgain.because} />
            )}
          </Row>

          <Row label="Worth working">
            {current.worthIt.asked ? (
              <>
                <span className="font-medium">{current.worthIt.label}</span>
                {/* The raw weighted position, because it is genuinely more
                    informative than the nearest word: 2.2 of 3 is a claim
                    leaning past "worth working", and 1.6 of 3 is not. */}
                <span className="ml-1 text-xs text-gray-500">
                  · {current.worthIt.position.toFixed(1)} of {current.worthIt.levels - 1}
                </span>
              </>
            ) : (
              <Skipped because={current.worthIt.because} />
            )}
          </Row>
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {isUpgradeRequired(predict.error) ? (
          // The wall covers the call, never the computed evidence above it.
          <>
            <PlanChip label="Practice plan" />
            <p className="text-xs text-gray-500">{upgradeReason(predict.error)}</p>
            <UpgradeButton variant="outline">Upgrade</UpgradeButton>
          </>
        ) : available ? (
          <Button
            size="sm"
            variant="outline"
            disabled={predict.isPending}
            onClick={() => predict.mutate({ claimNumber })}
          >
            {predict.isPending ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                Predicting…
              </>
            ) : current ? (
              'Predict again'
            ) : (
              'Predict from my history'
            )}
          </Button>
        ) : (
          <p className="text-xs text-gray-500">
            Prediction needs TYPESAFE_API_KEY. The figures above are computed and do not.
          </p>
        )}
      </div>

      {predict.data && !predict.data.verdict && (
        <p className="mt-2 text-xs text-gray-500">
          There was nothing to predict on this claim — it is settled, carries no balance and the
          payer gave no reason code.
        </p>
      )}

      {predict.error && !isUpgradeRequired(predict.error) && (
        <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {predict.error.message}
        </p>
      )}
    </div>
  )
}

'use client'

import { denialSummary, lastTouchLine } from '@/lib/claims/section-summary'
import { Code, Fact, Money, day, usd } from './atoms'
import type { ClaimDetail } from './types'

/**
 * One number, and the three words that decide what to do about it.
 *
 * This was a grid of twelve labelled cells, then six, then a balance with four
 * clauses under it. Each cut asked the same question and got a better answer:
 * what is a claim actually opened to decide?
 *
 * It is opened to decide whether to spend the next twenty minutes on it. That
 * takes exactly three facts — how much is stuck, how long there is to act, and
 * whether a colleague is already acting. Everything else is confirmation after
 * the fact, which is what the disclosure below is for.
 *
 * WHAT CAME OFF THIS LINE, and why it is not a loss. "Billed" sat next to the
 * balance it is a component of, so the two competed for the same glance and
 * neither changed a decision — the balance is what is chaseable. "Days old" was
 * a second clock beside the filing window, and only one of them runs out: age
 * is a sorting key for a list, not a deadline for one claim. Both are one click
 * down, unchanged, where a reconciliation question still finds them.
 *
 * WHAT CAME ON. Who last touched this. It was previously three timeline rows
 * below the fold of a dialog, which meant the single most expensive mistake in
 * the job — phoning a payer about a claim a colleague phoned about yesterday —
 * was guarded by a list you had to read. See lastHumanTouch in
 * lib/claims/timeline.ts.
 *
 * The codes are deliberately NOT here in the normal case: the code review
 * section below already leads with them, and a fact repeated twice on one
 * screen reads as two facts. They surface only when a biller has corrected one,
 * because a correction is the exceptional state and the thing someone needs to
 * notice without going looking.
 */
export function MoneyLine({
  claim,
  onFigures,
}: {
  claim: ClaimDetail
  /** Fired when the figures grid is expanded. See components/shared/use-usage.ts. */
  onFigures?: () => void
}) {
  const corrected = claim.work?.correctedCpt || claim.work?.correctedIcd10

  // One definition of "the filing window is close enough to shout about",
  // shared with the denial section rather than re-guessed here.
  const denial = denialSummary(claim.denial)
  const daysLeft = denial?.daysLeft ?? null

  /*
    One clock, not two. The filing window wins wherever there is one, because it
    is the only number on the screen that runs out; age stands in for it on a
    claim with no reason code, where nothing is counting down and "how long has
    this been sitting" is the next best question.
  */
  const clock =
    daysLeft !== null
      ? daysLeft > 0
        ? `${daysLeft} days to file`
        : 'filing window closed'
      : claim.ageDays !== null
        ? `${claim.ageDays} days old`
        : null

  const meta = [clock, lastTouchLine(claim.lastTouch)].filter(Boolean) as string[]

  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {claim.balance > 0 ? (
          <>
            <span className="text-3xl font-bold tabular-nums text-gray-900">
              {usd.format(claim.balance)}
            </span>
            <span className="text-sm text-gray-500">outstanding</span>
          </>
        ) : (
          <span className="text-2xl font-semibold text-gray-900">Settled</span>
        )}
      </div>

      <p className="mt-1 text-sm text-gray-500">
        {meta.join(' · ')}
        {/* Urgency is the one thing here allowed to shout. */}
        {denial?.urgent && (
          <span className="ml-2 font-medium text-red-700">
            {(daysLeft ?? 0) > 0 ? 'File soon' : 'Too late to file'}
          </span>
        )}
      </p>

      {/* A correction always renders alongside what was imported, never over
          it — see the Code atom. On the headline because it is the exception. */}
      {corrected && (
        <p className="mt-1.5 flex flex-wrap items-center gap-x-3 text-xs text-gray-600">
          <span>
            CPT <Code imported={claim.cpt} corrected={claim.work?.correctedCpt ?? null} />
          </span>
          <span>
            ICD-10 <Code imported={claim.icd10} corrected={claim.work?.correctedIcd10 ?? null} />
          </span>
        </p>
      )}

      {/*
        `onToggle` fires in both directions; only the opening is counted. A
        biller closing a grid they have finished reading is not a second visit
        to it, and counting it would double every reconciliation in the data.
      */}
      <details
        className="mt-2"
        onToggle={e => {
          if (e.currentTarget.open) onFigures?.()
        }}
      >
        <summary className="cursor-pointer list-none text-xs text-gray-500 underline decoration-dotted underline-offset-2">
          All the figures
        </summary>
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
          <Fact label="Billed">
            <Money value={claim.billed} />
          </Fact>
          <Fact label="Allowed">
            <Money value={claim.allowed} />
          </Fact>
          <Fact label="Paid">
            <Money value={claim.paid} />
          </Fact>
          <Fact label="Patient resp.">
            <Money value={claim.patientResp} />
          </Fact>
          <Fact label="Adjustment">
            <Money value={claim.adjustment} />
          </Fact>
          <Fact label="Age">
            {claim.ageDays === null ? '—' : `${claim.ageDays} days · ${claim.agingBucket}`}
          </Fact>
          <Fact label="Service date">{day(claim.serviceDate)}</Fact>
          <Fact label="Submitted">{day(claim.submittedDate)}</Fact>
          <Fact label="Remitted">{day(claim.remitDate)}</Fact>
          <Fact label="CPT">
            <Code imported={claim.cpt} corrected={claim.work?.correctedCpt ?? null} />
          </Fact>
          <Fact label="ICD-10">
            <Code imported={claim.icd10} corrected={claim.work?.correctedIcd10 ?? null} />
          </Fact>
        </dl>
      </details>
    </div>
  )
}

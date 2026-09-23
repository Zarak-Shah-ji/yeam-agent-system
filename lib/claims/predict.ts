/**
 * The bounded verdict on one claim.
 *
 * Four judgments, one call, every answer drawn from a finite set built out of
 * this practice's own settled claims:
 *
 *   1. Which diagnosis, of the ones you have actually been paid for on this
 *      procedure — or leave it as billed.
 *   2. Whether resubmitting it unchanged gets denied again.
 *   3. Whether the correction is worth a biller's time.
 *   4. Appeal, correct and resubmit, or write off.
 *
 * The constraint is structural, not instructional. lib/claims/code-signals.ts
 * already computes which diagnoses this payer has paid for on this CPT and how
 * many claims stand behind each; that list becomes the criteria map, and the
 * model can only return a key from it. Nothing here asks a model to be careful.
 *
 * Every question is gated on the evidence it needs. A question with nothing to
 * reason from is skipped and says why — the same discipline CodeSignals.limits
 * already follows, because a manufactured answer is worse than a missing one.
 */

import {
  MIN_SAMPLE,
  type CodeHistory,
  type CodeSignals,
  type DiagnosisCandidate,
  signalsHash,
} from './code-signals'
import { EXPIRING_SOON_DAYS } from '@/lib/denials/triage'
import {
  askTypeSafe,
  scoreBand,
  type ChoiceAnswer,
  type NoulAnswer,
  type ScoreAnswer,
  type TypeSafeFailure,
  type TypeSafeQuestion,
} from '@/lib/ai/typesafe-client'

/** The option that must always exist, so the choice is never foregone. */
export const LEAVE_AS_BILLED = 'LEAVE_AS_BILLED'

/**
 * The three things a biller can actually do next.
 *
 * Deliberately NOT lib/denials/triage.ts's `Remedy` union, which has five
 * members and a different vocabulary (corrected_claim, reprocess, appeal,
 * not_recoverable, unknown). Two overlapping things both called "remedy" is how
 * the worklist and the claim detail end up recommending different actions for
 * the same CARC, so this one is named for what it is: a prediction, not the
 * playbook's classification. Where they disagree, the UI says both.
 */
export type PredictedRemedy = 'appeal' | 'correct_and_resubmit' | 'write_off'

export const PREDICTED_REMEDY_LABEL: Record<PredictedRemedy, string> = {
  appeal: 'Appeal',
  correct_and_resubmit: 'Correct and resubmit',
  write_off: 'Write off',
}

/**
 * Everything TypeSafe is allowed to see.
 *
 * A closed shape, so a field added later is a type change somebody has to make
 * on purpose — the same reasoning __tests__/no-phi-columns.test.ts applies to
 * the schema, applied to the wire. Every field here already goes to Gemini
 * today, so this introduces no new disclosure.
 *
 * claimNumber is deliberately absent. It contributes nothing to a judgment; it
 * is only an anchor for a model to echo back.
 */
export type PredictionState = {
  payer: string | null
  claim: {
    status: string
    billed: number
    allowed: number | null
    paid: number | null
    balance: number
    ageDays: number | null
  }
  filing: { daysLeft: number | null; windowDays: number; windowSource: string }
  codes: {
    cpt: string | null
    cptDescription: string | null
    icd10: string | null
    icdDescription: string | null
    coherence: 'consistent' | 'unknown'
  }
  denial: {
    code: string
    label: string | null
    note: string | null
    playbookRemedy: string | null
    payerPosition: string | null
    strategy: string | null
    avoid: string | null
  } | null
  history: CodeHistory | null
  candidates: DiagnosisCandidate[]
  limits: string[]
}

export function buildPredictionState(input: {
  signals: CodeSignals
  status: string
  billed: number
  allowed: number | null
  paid: number | null
  balance: number
  ageDays: number | null
  filing: { daysLeft: number | null; windowDays: number; windowSource: string }
  denial: PredictionState['denial']
}): PredictionState {
  return {
    payer: input.signals.payer,
    claim: {
      status: input.status,
      billed: input.billed,
      allowed: input.allowed,
      paid: input.paid,
      balance: input.balance,
      ageDays: input.ageDays,
    },
    filing: input.filing,
    codes: {
      cpt: input.signals.cpt,
      cptDescription: input.signals.cptDescription,
      icd10: input.signals.icd10,
      icdDescription: input.signals.icdDescription,
      coherence: input.signals.coherence,
    },
    denial: input.denial,
    history: input.signals.history,
    candidates: input.signals.candidates,
    limits: input.signals.limits,
  }
}

type Gate = { asked: false; because: string }

export type QuestionKey = 'bestIcd10' | 'denyAgain' | 'worthIt' | 'remedy'

/**
 * One diagnosis option, described by the evidence behind it.
 *
 * Every description states its denominator. "No rate without its n" is already
 * the rule on screen (lib/claims/code-signals.ts, CodeReviewPanel); a criteria
 * map is the same claim made to a model, and a bare "82% paid" would invite it
 * to rank a two-claim fluke over a forty-claim pattern.
 */
function describeCandidate(c: DiagnosisCandidate, cpt: string | null): string {
  const what = c.description ?? 'no description in the built-in reference'
  const evidence = `paid on ${c.paid} of ${c.n} of this practice's claims for ${cpt ?? 'this procedure'}`
  const thin = c.thin
    ? `, which is fewer than ${MIN_SAMPLE} claims and too few to rely on`
    : ''
  const current = c.current ? '. This is the diagnosis currently on the claim.' : ''
  return `${what} — ${evidence}${thin}${current}`
}

export function buildQuestions(state: PredictionState): {
  questions: Partial<Record<QuestionKey, TypeSafeQuestion>>
  skipped: Partial<Record<QuestionKey, string>>
} {
  const questions: Partial<Record<QuestionKey, TypeSafeQuestion>> = {}
  const skipped: Partial<Record<QuestionKey, string>> = {}

  // --- a) which diagnosis ---------------------------------------------------
  if (state.candidates.length > 0) {
    const criteria: Record<string, string> = {}
    for (const c of state.candidates) criteria[c.icd10] = describeCandidate(c, state.codes.cpt)

    // Unconditional. Without it a claim with one candidate has a foregone
    // answer, and a confidence attached to a one-option choice is a number
    // manufactured out of having asked.
    criteria[LEAVE_AS_BILLED] =
      `Leave the diagnosis as billed${state.codes.icd10 ? ` (${state.codes.icd10})` : ''}. ` +
      `Choose this when nothing in this practice's own settled history is better evidenced ` +
      `than what is already on the claim, or when the payer's reason code did not question ` +
      `the diagnosis at all. Nobody here has seen the chart.`

    questions.bestIcd10 = {
      type: 'choice',
      instructions:
        'Which diagnosis code best fits this claim, judged only by what this practice has ' +
        'actually been paid for on this procedure with this payer, and by what the payer said ' +
        'on the remittance? A larger number of claims behind an option is stronger evidence ' +
        `than a higher rate over few claims; fewer than ${MIN_SAMPLE} claims is not evidence. ` +
        'You have no clinical documentation, so never choose a code on the grounds that it ' +
        'would pay more.',
      criteria,
    }
  } else {
    skipped.bestIcd10 =
      'No settled claim in your data carries this procedure with a diagnosis, so there is ' +
      'nothing to compare against.'
  }

  // --- b) denied again? ----------------------------------------------------
  const denied = state.claim.status === 'DENIED' || state.claim.status === 'REJECTED'
  if (denied || state.denial) {
    questions.denyAgain = {
      type: 'noul',
      instructions:
        'Resubmitted exactly as billed, with no change to the codes, does this payer deny it ' +
        'again? Use only this practice\'s own settled history for this procedure and payer and ' +
        `what the payer said on the remittance. Fewer than ${MIN_SAMPLE} matching claims is not ` +
        'evidence: where the sample is thin, or where `limits` says a rate is unreliable, stay ' +
        'near 0.5 rather than committing.',
      criteria: {
        true: 'Resubmitted exactly as billed, this payer denies it again.',
        false: 'Resubmitted exactly as billed, this payer pays it.',
      },
    }
  } else {
    skipped.denyAgain = 'This claim has not been denied, so there is nothing to resubmit.'
  }

  // --- c) worth the effort? ------------------------------------------------
  if (state.claim.balance > 0) {
    questions.worthIt = {
      type: 'score',
      instructions:
        'How much of a biller\'s time is this claim worth? Weigh the outstanding balance ' +
        `(${state.claim.balance}), how long is left to file ` +
        `(${state.filing.daysLeft ?? 'unknown'} of ` +
        `${state.filing.windowDays} days), and how much evidence stands behind any change. ` +
        'Effort means a person\'s time. A correction with no evidence behind it is effort with ' +
        'no expected return, however large the balance.',
      criteria: [
        'Not worth touching. The balance does not cover the minutes it would take, or the filing window has already closed.',
        'Only if it is quick. A small balance, or thin evidence for any change.',
        'Worth working. The balance justifies the effort and the evidence points somewhere specific.',
        'Work this first. A large balance, a defect the payer itself named, and time left to file.',
      ],
    }
  } else {
    skipped.worthIt = 'This claim has no outstanding balance.'
  }

  // --- d) which remedy ------------------------------------------------------
  if (state.denial) {
    questions.remedy = {
      type: 'choice',
      instructions:
        'What should be done with this claim next? ' +
        (state.denial.playbookRemedy
          ? `The reason-code playbook for ${state.denial.code} says: ${state.denial.playbookRemedy}. ` +
            'Weigh that against this practice\'s own history — if you disagree with it, choose ' +
            'differently and the disagreement will be shown to the biller.'
          : 'There is no playbook entry for this reason code, so judge from the history alone.'),
      criteria: {
        appeal:
          'Appeal. The claim as billed is defensible and the payer is wrong — the coding is ' +
          'supported by what this practice is normally paid for, and the denial reason is one ' +
          'that gets overturned rather than one that names a defect in the claim.',
        correct_and_resubmit:
          'Correct and resubmit. The payer named something fixable and this practice\'s own ' +
          'settled history points at a specific change.',
        write_off:
          'Write off. The filing window has closed, or the balance does not justify the work, ' +
          'or nothing in the data suggests a resubmission would land differently.',
      },
    }
  } else {
    skipped.remedy = 'The payer gave no reason code, so there is nothing to remedy.'
  }

  return { questions, skipped }
}

export type Judgment<T> = ({ asked: true } & T) | Gate

export type Verdict = {
  model: string
  at: string
  bestIcd10: Judgment<{
    choice: string
    confidence: number
    /** The criteria map actually sent, so a later reader can prove the choice
     *  was in it without re-deriving signals that have since moved. */
    options: string[]
  }>
  denyAgain: Judgment<{ probability: number }>
  worthIt: Judgment<{
    band: number
    levels: number
    label: string
    /** The raw probability-weighted position, e.g. 1.13 across four levels. */
    position: number
    confidence: number
  }>
  remedy: Judgment<{ choice: PredictedRemedy; label: string; confidence: number }>
  /**
   * Every ICD-10 anything downstream is permitted to print. Always contains the
   * diagnosis actually on the claim, or the written review could not legally
   * state what was billed.
   */
  allowedCodes: string[]
  usage: { input_tokens: number; output_tokens: number }
}

const REMEDIES = new Set<string>(['appeal', 'correct_and_resubmit', 'write_off'])

export type PredictResult =
  | { ok: true; verdict: Verdict }
  | { ok: false; reason: TypeSafeFailure | 'nothing-to-ask'; skipped: Partial<Record<QuestionKey, string>> }

export async function predictClaim(state: PredictionState): Promise<PredictResult> {
  const { questions, skipped } = buildQuestions(state)

  // Nothing to ask: a settled claim with no balance, no reason code and no
  // history to compare. No call is made rather than one that spends tokens
  // confirming there is nothing to say.
  if (Object.keys(questions).length === 0) {
    return { ok: false, reason: 'nothing-to-ask', skipped }
  }

  const result = await askTypeSafe(state, questions as Record<QuestionKey, TypeSafeQuestion>)
  if (!result.ok) return { ok: false, reason: result.reason, skipped }

  const gate = (key: QuestionKey): Gate => ({
    asked: false,
    because: skipped[key] ?? 'Not asked.',
  })

  const answers = result.answers as Partial<Record<QuestionKey, unknown>>

  const icdAnswer = answers.bestIcd10 as ChoiceAnswer | undefined
  const denyAnswer = answers.denyAgain as NoulAnswer | undefined
  const worthAnswer = answers.worthIt as ScoreAnswer | undefined
  const remedyAnswer = answers.remedy as ChoiceAnswer | undefined

  // The client already checked that a choice is a key of the map it was sent.
  // This is the narrower claim: the remedy is one of OUR three, so the rest of
  // the app can switch on it exhaustively.
  if (remedyAnswer && !REMEDIES.has(remedyAnswer.choice)) {
    return { ok: false, reason: 'malformed', skipped }
  }

  const icdOptions = Object.keys(
    (questions.bestIcd10 as { criteria?: Record<string, string> } | undefined)?.criteria ?? {},
  )

  // The billed diagnosis is always printable, whether or not it was the choice.
  const allowedCodes = [
    ...new Set(
      [
        state.codes.icd10,
        ...icdOptions.filter(c => c !== LEAVE_AS_BILLED),
      ].filter((c): c is string => Boolean(c)),
    ),
  ]

  const worth = worthAnswer ? scoreBand(worthAnswer) : null

  return {
    ok: true,
    verdict: {
      model: result.model,
      at: new Date().toISOString(),
      bestIcd10: icdAnswer
        ? {
            asked: true,
            choice: icdAnswer.choice,
            confidence: icdAnswer.confidence,
            options: icdOptions,
          }
        : gate('bestIcd10'),
      denyAgain: denyAnswer ? { asked: true, probability: denyAnswer.noul } : gate('denyAgain'),
      worthIt:
        worthAnswer && worth
          ? {
              asked: true,
              band: worth.band,
              levels: worth.levels,
              label: worth.label,
              position: worth.position,
              confidence: worthAnswer.confidence,
            }
          : gate('worthIt'),
      remedy: remedyAnswer
        ? {
            asked: true,
            choice: remedyAnswer.choice as PredictedRemedy,
            label: PREDICTED_REMEDY_LABEL[remedyAnswer.choice as PredictedRemedy],
            confidence: remedyAnswer.confidence,
          }
        : gate('remedy'),
      allowedCodes,
      usage: result.usage,
    },
  }
}

/**
 * Which bucket the filing window falls in.
 *
 * Bucketed rather than raw, because a day count changes every morning and a
 * cache keyed on it would never hit. The thresholds are the ones the UI already
 * treats as different situations.
 */
function windowBucket(daysLeft: number | null): string {
  if (daysLeft === null) return '-'
  if (daysLeft <= 0) return 'closed'
  if (daysLeft <= EXPIRING_SOON_DAYS) return `<=${EXPIRING_SOON_DAYS}`
  if (daysLeft <= 30) return '<=30'
  if (daysLeft <= 60) return '<=60'
  return '>60'
}

/**
 * A fingerprint of everything a verdict was drawn from.
 *
 * signalsHash covers the codes, the payer and the history, which is all the
 * written review depends on. The verdict also weighs the balance and how long
 * is left to file — so a claim whose filing window had lapsed would go on
 * serving "work this first" forever if this reused that hash.
 *
 * It composes signalsHash rather than replacing it: changing that function
 * would invalidate every cached review in production at once.
 */
export function predictionHash(
  signals: CodeSignals,
  extras: { status: string; balance: number; daysLeft: number | null; carc: string | null },
): string {
  const raw = [
    signalsHash(signals),
    extras.status,
    String(Math.round(extras.balance)),
    windowBucket(extras.daysLeft),
    extras.carc ?? '-',
  ].join('|')

  let h = 0
  for (let i = 0; i < raw.length; i++) h = (Math.imul(h, 31) + raw.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

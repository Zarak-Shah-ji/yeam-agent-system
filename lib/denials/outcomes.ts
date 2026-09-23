import type { ArtifactType } from '@/lib/billing/appeal-prompt'
import type { SubmissionChannelValue } from '@/lib/billing/submission'
import { usd } from '@/lib/charts/format'
import { MIN_SAMPLE } from '@/lib/stats/min-sample'

/**
 * What came back, and what it adds up to.
 *
 * The product could draft the right document, route it to the right place and
 * prove it was filed on time, and then had nothing to say about the only
 * question that decides whether any of that was worth doing: did it get paid.
 *
 * ── Why this file is pure ─────────────────────────────────────────────────
 *
 * Everything here takes plain records and returns plain records. The router
 * loads rows and hands them over; nothing in here touches Prisma, so the
 * aggregate can be tested against hand-written cases where the answer is known
 * by inspection. That matters more here than elsewhere in the codebase, because
 * a win rate that is quietly wrong is worse than no win rate — a biller who
 * stops appealing CO-97 to Aetna on the strength of a bad number loses money
 * that was recoverable, and never finds out.
 *
 * ── The counting rules, and why they are these ────────────────────────────
 *
 * PENDING submissions are excluded from every rate, not counted as losses. An
 * appeal filed last Tuesday has not lost; treating it as one makes every recent
 * argument look bad and makes the whole table swing with filing volume.
 *
 * A PARTIAL is a win. It is counted as one because it is one — the payer moved
 * — but the dollars tell the rest of the story, which is why recovery is
 * reported next to the rate rather than folded into it.
 *
 * NO_RESPONSE is neither. A payer that never answered has not decided, and
 * scoring it as a denial blames the argument for the payer's silence. It is
 * counted and shown separately, because a payer with a high silence rate is
 * itself a finding.
 *
 * WITHDRAWN drops out entirely. The biller pulled it; the payer never ruled.
 */

/**
 * Every outcome a submission can be recorded against.
 *
 * Exported for the same reason SUBMISSION_CHANNELS is: the form, the router
 * input and the Prisma enum have to agree by construction. A UI holding a plain
 * string and casting it at the call site type-checks and is a lie.
 */
export const SUBMISSION_OUTCOMES = [
  'PENDING',
  'PAID',
  'PARTIAL',
  'DENIED',
  'NO_RESPONSE',
  'WITHDRAWN',
] as const

export type SubmissionOutcomeValue = (typeof SUBMISSION_OUTCOMES)[number]

/** The outcomes a human can actually record. PENDING is where a row starts. */
export const RESOLVABLE_OUTCOMES = SUBMISSION_OUTCOMES.filter(
  o => o !== 'PENDING',
) as readonly Exclude<SubmissionOutcomeValue, 'PENDING'>[]

export const OUTCOME_LABEL: Record<SubmissionOutcomeValue, string> = {
  PENDING: 'Waiting on the payer',
  PAID: 'Paid in full',
  PARTIAL: 'Paid in part',
  DENIED: 'Denied again',
  NO_RESPONSE: 'No response',
  WITHDRAWN: 'Withdrawn',
}

/** One line of help under each choice, so the counting rules are visible. */
export const OUTCOME_HINT: Record<SubmissionOutcomeValue, string> = {
  PENDING: 'Still open. Not counted as a win or a loss.',
  PAID: 'The payer allowed the claim.',
  PARTIAL: 'The payer moved but did not allow all of it. Counts as a win.',
  DENIED: 'The payer upheld the denial. Record the code they used.',
  NO_RESPONSE: 'Past their own turnaround with nothing back. Not counted as a loss.',
  WITHDRAWN: 'You pulled it. Left out of the numbers entirely.',
}

export type OutcomeSourceValue = 'BILLER' | 'REMITTANCE'

export function isResolved(outcome: SubmissionOutcomeValue): boolean {
  return outcome !== 'PENDING'
}

/** Did the payer move? PARTIAL counts; see the counting rules above. */
export function isWin(outcome: SubmissionOutcomeValue): boolean {
  return outcome === 'PAID' || outcome === 'PARTIAL'
}

/** Did the payer rule at all? Silence and a withdrawal are not rulings. */
export function isRuling(outcome: SubmissionOutcomeValue): boolean {
  return outcome === 'PAID' || outcome === 'PARTIAL' || outcome === 'DENIED'
}

/**
 * Where the row should land once the payer has answered.
 *
 * Returns null where the outcome does not decide the row's fate. A denial of a
 * first-level appeal does NOT close the row — a second-level appeal to a
 * different address is the normal next step, and moving the row to DEAD would
 * bury recoverable money. So DENIED reopens it to TO_WORK and lets the queue
 * re-rank it against the filing deadline that is now much shorter.
 */
export function rowStatusForOutcome(
  outcome: SubmissionOutcomeValue,
): 'PAID' | 'TO_WORK' | 'SENT' | null {
  switch (outcome) {
    case 'PAID':
    case 'PARTIAL':
      return 'PAID'
    case 'DENIED':
    case 'NO_RESPONSE':
      return 'TO_WORK'
    case 'WITHDRAWN':
      return null
    case 'PENDING':
      return 'SENT'
  }
}

/**
 * Days the payer took, or null when either end is missing.
 *
 * Derived on every read and never stored, the same rule the filing deadline and
 * the aging buckets follow. A day count written to the database is a number
 * about the moment it was written, not about the claim.
 */
export function daysToResolution(sentAt: Date, outcomeAt: Date | null): number | null {
  if (!outcomeAt) return null
  const days = Math.round((outcomeAt.getTime() - sentAt.getTime()) / 86_400_000)
  // A determination dated before the submission is a typo, not a negative
  // turnaround. Drop it rather than let it pull a median backwards.
  return days < 0 ? null : days
}

/** One resolved-or-pending attempt, flattened with the facts of its row. */
export interface OutcomeRecord {
  payerKey: string | null
  payerLabel: string | null
  carc: string
  cpt: string | null
  artifact: ArtifactType | null
  channel: SubmissionChannelValue
  outcome: SubmissionOutcomeValue
  sentAt: Date
  outcomeAt: Date | null
  /** The row's billed amount — what was at stake on this attempt. */
  billed: number
  amountRecovered: number | null
  /** The code the payer denied the appeal under, where it gave one. */
  outcomeCarc: string | null
}

export interface OutcomeTally {
  attempts: number
  pending: number
  /** Rulings: PAID + PARTIAL + DENIED. The denominator of winRate. */
  decided: number
  won: number
  partial: number
  denied: number
  noResponse: number
  withdrawn: number
  /**
   * Percent of rulings that went the practice's way, or null when nothing has
   * been ruled on yet. Percentage points, not a fraction — the same convention
   * lib/insights/aggregate.ts uses, so pct() renders it without a conversion at
   * the call site that would eventually be forgotten in one place.
   *
   * Null rather than 0 on purpose. Zero reads as "this never works"; null is
   * "we do not know yet", and those must not look the same on a screen someone
   * is about to make a decision from.
   */
  winRate: number | null
  /** Dollars the wins actually brought in, where a number was recorded. */
  recovered: number
  /** Dollars that were at stake across every decided attempt. */
  atStake: number
  /** Median days to a ruling. Median, not mean: one 400-day appeal is normal. */
  medianDays: number | null
}

function emptyTally(): OutcomeTally {
  return {
    attempts: 0,
    pending: 0,
    decided: 0,
    won: 0,
    partial: 0,
    denied: 0,
    noResponse: 0,
    withdrawn: 0,
    winRate: null,
    recovered: 0,
    atStake: 0,
    medianDays: null,
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** Percent, or null when there is no denominator. A rate of 0/0 is not zero. */
function rate(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null
  return round2((numerator / denominator) * 100)
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid]
}

/**
 * Fold a set of attempts into one tally.
 *
 * Exported on its own because every grouping below is this function plus a key,
 * and because the counting rules are the part worth testing directly.
 */
export function tally(records: readonly OutcomeRecord[]): OutcomeTally {
  const out = emptyTally()
  const days: number[] = []

  for (const r of records) {
    out.attempts += 1
    switch (r.outcome) {
      case 'PENDING':
        out.pending += 1
        continue
      case 'WITHDRAWN':
        out.withdrawn += 1
        continue
      case 'NO_RESPONSE':
        out.noResponse += 1
        continue
      case 'PAID':
      case 'PARTIAL':
      case 'DENIED':
        break
    }

    out.decided += 1
    out.atStake += r.billed
    if (r.outcome === 'PARTIAL') out.partial += 1
    if (isWin(r.outcome)) {
      out.won += 1
      out.recovered += r.amountRecovered ?? 0
    } else {
      out.denied += 1
    }

    const d = daysToResolution(r.sentAt, r.outcomeAt)
    if (d !== null) days.push(d)
  }

  out.winRate = rate(out.won, out.decided)
  out.recovered = round2(out.recovered)
  out.atStake = round2(out.atStake)
  out.medianDays = median(days)
  return out
}

export interface OutcomeGroup extends OutcomeTally {
  key: string
  label: string
}


function group(
  records: readonly OutcomeRecord[],
  keyOf: (r: OutcomeRecord) => string | null,
  labelOf: (r: OutcomeRecord) => string,
): OutcomeGroup[] {
  const buckets = new Map<string, { label: string; rows: OutcomeRecord[] }>()
  for (const r of records) {
    const key = keyOf(r)
    if (key === null) continue
    const existing = buckets.get(key)
    if (existing) existing.rows.push(r)
    else buckets.set(key, { label: labelOf(r), rows: [r] })
  }
  return [...buckets].map(([key, b]) => ({ key, label: b.label, ...tally(b.rows) }))
}

/**
 * The table this whole feature exists for.
 *
 * payer x reason code x instrument -> did it work. Everything else on this page
 * is a roll-up of it. Sorted by decided volume because a 100% win rate on one
 * appeal is noise and must not head the list; the UI is responsible for saying
 * which rows are too thin to act on, and `decided` is the number it says it
 * with.
 */
export function byPayerAndCode(records: readonly OutcomeRecord[]): OutcomeGroup[] {
  return group(
    records,
    r => (r.payerKey ? `${r.payerKey}|${r.carc}|${r.artifact ?? 'unknown'}` : null),
    r => `${r.payerLabel ?? 'Unknown payer'} · ${r.carc}`,
  ).sort((a, b) => b.decided - a.decided || b.attempts - a.attempts)
}

export function byPayer(records: readonly OutcomeRecord[]): OutcomeGroup[] {
  return group(
    records,
    r => r.payerKey,
    r => r.payerLabel ?? 'Unknown payer',
  ).sort((a, b) => b.decided - a.decided || b.attempts - a.attempts)
}

export function byCode(records: readonly OutcomeRecord[]): OutcomeGroup[] {
  return group(
    records,
    r => r.carc,
    r => r.carc,
  ).sort((a, b) => b.decided - a.decided || b.attempts - a.attempts)
}

/**
 * Which document works, for one reason code.
 *
 * The one comparison that can change what the product does. artifactFor() picks
 * the instrument from a static playbook; if reconsiderations beat appeal letters
 * on CO-97 for a payer, that is evidence the mapping is wrong, and it is
 * evidence nobody else has.
 */
export function byArtifact(records: readonly OutcomeRecord[]): OutcomeGroup[] {
  return group(
    records,
    r => r.artifact,
    r => r.artifact ?? 'unknown',
  ).sort((a, b) => b.decided - a.decided)
}

/**
 * How much of the ledger is actually filled in.
 *
 * Shown at the top of the outcomes view, because a win rate drawn from 12 of 300
 * submissions is a number about the 12 people bothered to close out, and that
 * caveat has to travel with it.
 */
export function coverage(records: readonly OutcomeRecord[]): {
  total: number
  resolved: number
  pending: number
  rate: number | null
} {
  const total = records.length
  const pending = records.filter(r => r.outcome === 'PENDING').length
  return {
    total,
    resolved: total - pending,
    pending,
    rate: rate(total - pending, total),
  }
}

/**
 * A tally in one line, worded the same everywhere a win rate appears — the
 * payer panel and the Analytics outcomes card both print this, so the two can
 * never describe the same rulings two ways.
 *
 * Counts before rates. "Won 3 of 4" carries its own denominator; a percentage
 * is added only once MIN_SAMPLE rulings stand behind it, because below that
 * "75%" reads as a finding and is really an anecdote.
 *
 * Null when nothing was ever sent — there is nothing to summarise.
 */
export function outcomeLine(t: OutcomeTally | null): string | null {
  if (!t || t.attempts === 0) return null

  const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

  if (t.decided === 0) {
    if (t.pending > 0) return `${plural(t.pending, 'appeal')} sent, waiting on a ruling`
    if (t.noResponse > 0) return `${plural(t.noResponse, 'appeal')} sent, never answered`
    return 'Nothing ruled on yet'
  }

  const rulings = plural(t.decided, 'ruling')
  const parts = [
    t.decided >= MIN_SAMPLE && t.winRate !== null
      ? `Won ${t.won} of ${rulings} (${Math.round(t.winRate)}%)`
      : `Won ${t.won} of ${rulings} — too few to judge`,
  ]
  if (t.recovered > 0) parts.push(`${usd(t.recovered)} recovered`)
  if (t.pending > 0) parts.push(`${t.pending} waiting`)
  return parts.join(' · ')
}

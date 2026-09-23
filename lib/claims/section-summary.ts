/**
 * What a collapsed section says about itself.
 *
 * The claim detail used to render everything at once: twelve fact cells, the
 * denial card, the code review, the note box, the status control and the
 * history, in one scroll. Nothing was hidden, so nothing was emphasised. It is
 * now three collapsed rows, and a collapsed row is only an improvement if it
 * says enough to decide whether to open it. "Code review ›" is not information,
 * it is a click tax.
 *
 * So each summary carries the one fact that decides: which code the payer
 * objected to, how much history stands behind the codes, whether anybody has
 * touched this claim yet.
 *
 * These are plain functions rather than JSX because vitest runs `environment:
 * 'node'` here with no React testing library — a string built inside a
 * component is a string nothing can assert on. The rule that matters most, that
 * a rate never appears without the number of claims behind it, is exactly the
 * kind of thing that has to be tested rather than reviewed.
 */

import { format, formatDistanceStrict, formatDistanceToNowStrict } from 'date-fns'

function asDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null
  const d = typeof value === 'string' ? new Date(value) : value
  return Number.isNaN(d.getTime()) ? null : d
}

export type DenialSummary = {
  code: string
  label: string | null
  daysLeft: number | null
  /** The filing window is close enough to matter. Same threshold the badge uses. */
  urgent: boolean
}

/**
 * Null when there is no reason code — and then the section is not rendered at
 * all. A row that opens onto "no denial information" is precisely the clutter
 * this redesign removes; an empty disabled row is worse than no row.
 */
export function denialSummary(
  denial: { code: string; label: string | null; daysLeft: number | null } | null,
): DenialSummary | null {
  if (!denial) return null
  return {
    code: denial.code,
    label: denial.label,
    daysLeft: denial.daysLeft,
    urgent: denial.daysLeft !== null && denial.daysLeft <= 14,
  }
}

export type CodeReviewSummaryInput = {
  cpt: string | null
  icd10: string | null
  /** Straight from CodeSignals. `n` is not optional, because the rate is not
   *  quotable without it. */
  history: { n: number; paidRate: number } | null
  /** True while claims.signals is still in flight. */
  loading?: boolean
  /** Set when the plan wall covers the written reading. The computed figures
   *  are free and stay on the line regardless — the wall covers the reading,
   *  never the evidence. */
  walled?: boolean
}

/**
 * The codes, and what this practice's own history says about them.
 *
 * Every branch that quotes a percentage also states the claims behind it. A
 * 100% paid rate over two claims is not a fact about a payer, and a collapsed
 * one-liner is the easiest place in the whole surface to let that slip.
 */
export function codeReviewSummary(input: CodeReviewSummaryInput): string {
  if (input.loading) return 'Checking your history…'

  const codes = [input.cpt, input.icd10].filter(Boolean).join(' + ')
  const head = codes || 'No codes on this claim'

  if (!input.history) {
    return input.cpt
      ? `${head} · no settled claims to compare`
      : `${head} · nothing to compare against`
  }

  const { n, paidRate } = input.history
  const rate = `${n} of your claims, ${paidRate}% paid`

  return input.walled ? `${head} · ${rate} — the written reading is on the Practice plan` : `${head} · ${rate}`
}

export type RecordWorkInput = {
  statusOverride: string | null
  statusLabel: string | null
  note: string | null
  followUpAt: Date | string | null
  lastTouchedAt: Date | string | null
}

/**
 * Whether anybody has worked this claim, in the order a biller asks it: what it
 * was marked, when to come back, and how stale the note is.
 */
export function recordWorkSummary(work: RecordWorkInput | null): string {
  if (!work) return 'Nothing recorded yet'

  const parts: string[] = []

  if (work.statusOverride) parts.push(`Marked ${work.statusLabel ?? work.statusOverride}`)

  const followUp = asDate(work.followUpAt)
  if (followUp) parts.push(`follow up ${format(followUp, 'MMM d')}`)

  const touched = asDate(work.lastTouchedAt)
  if (work.note?.trim() && touched) parts.push(`note from ${formatDistanceToNowStrict(touched)} ago`)
  else if (work.note?.trim()) parts.push('note added')

  return parts.length > 0 ? parts.join(' · ') : 'Nothing recorded yet'
}

export type LastTouch = {
  at: Date | string
  /** The timeline's own label for what happened. */
  label: string
  kind: 'event' | 'draft' | 'submission'
  /** A colleague's name, where the event recorded one. */
  actor: string | null
}

/**
 * Who last did something to this claim, in one clause.
 *
 * This is the third and least obvious part of the headline. The balance says
 * how much is stuck and the filing clock says how long there is to act; this
 * says whether acting is even yours to do. A claim a colleague phoned about
 * yesterday and a claim nobody has touched in four months are the same row in
 * every list in this product, and they are not remotely the same decision.
 *
 * WORDED FROM THE KIND, NOT THE STATUS. "Chased" is reserved for a submission,
 * because a letter that was drafted and never sent has not chased anybody — and
 * that distinction is precisely the one a biller is about to act on. Everything
 * else borrows the timeline's own label so the clause and the list below it
 * cannot drift into describing the same event two ways.
 *
 * `now` is a parameter rather than a call to Date.now() so the wording is
 * testable, which is the same reason this file holds plain functions instead of
 * JSX.
 */
export function lastTouchLine(touch: LastTouch | null, now: Date = new Date()): string {
  if (!touch) return 'nobody has worked this yet'

  const at = asDate(touch.at)
  if (!at) return 'nobody has worked this yet'

  const ago = `${formatDistanceStrict(at, now)} ago`
  const by = touch.actor ? ` by ${touch.actor}` : ''

  // A submission is the only entry that means the payer heard from us.
  if (touch.kind === 'submission') return `last chased ${ago}${by}`

  return `${touch.label.toLowerCase()} ${ago}${by}`
}

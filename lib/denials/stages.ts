import { filingWindow } from './triage'
import type { CallVerdict } from './score'

/**
 * Where one denial has got to, and what is owed next.
 *
 * The product could say what a row's status was and nothing about its shape over
 * time. "Drafted" is a state; "drafted eleven days ago, with nine days left to
 * file" is the thing a biller acts on, and it was only reconstructable by
 * opening the row and reading three separate blocks.
 *
 * Pure, and with no database or React in it, for the same reason score.ts is:
 * the mapping from a row's facts to a stage is the part that is easy to get
 * subtly wrong, and it is worth being able to test it against a fixed date.
 *
 * ── Nothing here is stored ───────────────────────────────────────────────────
 *
 * Same rule as the rest of lib/denials: a stage written to the database is wrong
 * the next morning, because "awaiting" becomes "awaiting too long" by the
 * passage of time and nothing else. It is derived on read, every read.
 *
 * ── The ETA is not invented here ─────────────────────────────────────────────
 *
 * callGuidance() in score.ts already decides when a payer is late, from that
 * payer's measured median days-to-pay, with a labelled 30-day rule of thumb when
 * there is no A/R snapshot to measure. That arithmetic is not repeated here — it
 * is passed in. Two places deciding independently when the same payer is late is
 * how a badge and a banner end up contradicting each other about one claim.
 */

export const STAGES = ['imported', 'to_work', 'drafted', 'sent', 'awaiting', 'resolved'] as const

export type Stage = (typeof STAGES)[number]

export type StageInput = {
  /** DenialRow.status. */
  status: string
  /** How many drafts exist for this row. */
  draftCount: number
  /** Remittance date where the export had one, service date otherwise. */
  denialDate: Date | null
  payer: string | null
  followUpAt: Date | null
  /** The verdict and ETA callGuidance already computed for this row. */
  call: { verdict: CallVerdict; expectedBy: Date | string | null }
}

export type StageView = {
  /** The furthest stage this row has actually reached. */
  current: Stage
  /**
   * Every stage genuinely reached — NOT the prefix up to `current`.
   *
   * A row written off before anybody drafted anything reaches `imported`,
   * `to_work` and `resolved` and never the three between. Filling those in to
   * make the bar tidy would claim work that never happened, and "written off
   * without being worked" is exactly the thing a billing manager wants to see.
   */
  reached: Stage[]
  /** What is owed next, or null once the row is finished. */
  expectedBy: Date | null
  /** The sentence that goes with that date. Null when there is no date. */
  expectation: string | null
  /** The date has passed. */
  overdue: boolean
}

export const STAGE_LABEL: Record<Stage, string> = {
  imported: 'Imported',
  to_work: 'To work',
  drafted: 'Drafted',
  sent: 'Sent',
  awaiting: 'Awaiting',
  resolved: 'Resolved',
}

/**
 * The six labels for one row, with the last one named after what happened.
 *
 * "Resolved" is true of money that arrived and of a claim somebody gave up on,
 * and reading the same word for both is how a queue stops being trustworthy.
 */
export function stageLabels(status: string): Record<Stage, string> {
  return {
    ...STAGE_LABEL,
    resolved: status === 'DEAD' ? 'Written off' : status === 'PAID' ? 'Recovered' : 'Resolved',
  }
}

const MS_PER_DAY = 86_400_000

/** Whole days between two dates, ignoring time of day. Mirrors triage.ts. */
function daysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate())
  return Math.round((b - a) / MS_PER_DAY)
}

function asDate(value: Date | string | null): Date | null {
  if (!value) return null
  const d = typeof value === 'string' ? new Date(value) : value
  return Number.isNaN(d.getTime()) ? null : d
}

export function stageFor(input: StageInput, today: Date): StageView {
  const { status } = input

  // A draft is proof on its own: a row reopened after a denial goes back to
  // TO_WORK while keeping every letter ever written for it, and pretending it
  // was never drafted would lose the history the reopen exists to preserve.
  const drafted =
    input.draftCount > 0 || status === 'DRAFTED' || status === 'SENT' || status === 'PAID'
  const sent = status === 'SENT' || status === 'PAID'

  /*
    `sent` and `awaiting` are the same event seen from two sides, and the line
    between them is the payer's own median rather than a fixed number of days.

    A letter that went out four days ago to a payer that takes thirty-four is
    `sent`: the clock is running normally and there is nothing to do. The same
    letter at day forty is `awaiting` — still no answer, and now past what this
    payer usually takes. That is the moment the row needs a person again, and it
    arrives on a different date for every payer.
  */
  const pastExpectation =
    input.call.verdict === 'due' ||
    input.call.verdict === 'overdue' ||
    input.call.verdict === 'unknown'
  const awaiting = status === 'PAID' || (sent && pastExpectation)
  const resolved = status === 'PAID' || status === 'DEAD'

  const reachedBy: Record<Stage, boolean> = {
    imported: true,
    // Every denial row is in the queue the moment it is imported. The two are
    // simultaneous, which makes `imported` a stage the bar starts from rather
    // than one a row ever rests at.
    to_work: true,
    drafted,
    sent,
    awaiting,
    resolved,
  }

  const reached = STAGES.filter(s => reachedBy[s])
  const current = reached[reached.length - 1]

  const { expectedBy, expectation } = expectationFor(input, current)
  const overdue = expectedBy !== null && daysBetween(expectedBy, today) > 0

  return { current, reached, expectedBy, expectation, overdue }
}

/**
 * What the row is waiting on, and by when.
 *
 * Two clocks, and which one applies depends entirely on who holds the ball. Up
 * to the moment a letter goes out the deadline is ours — the payer's filing
 * window, after which the claim is dead whatever its merits. Once it has gone
 * out the deadline is theirs, and it is measured from what that payer actually
 * does rather than from a number we picked.
 */
function expectationFor(
  input: StageInput,
  current: Stage,
): { expectedBy: Date | null; expectation: string | null } {
  if (current === 'resolved') return { expectedBy: null, expectation: null }

  if (current === 'sent' || current === 'awaiting') {
    const payerEta = asDate(input.call.expectedBy)
    if (payerEta) {
      return {
        expectedBy: payerEta,
        expectation: 'An answer from the payer is expected by',
      }
    }
    // Marked sent without a date to measure from. The biller's own follow-up
    // date is then the only honest expectation on the row.
    const followUp = asDate(input.followUpAt)
    return followUp
      ? { expectedBy: followUp, expectation: 'You said you would look again on' }
      : { expectedBy: null, expectation: null }
  }

  // imported / to_work / drafted — the filing window, which is ours to miss.
  const denialDate = asDate(input.denialDate)
  if (!denialDate) {
    return {
      expectedBy: null,
      expectation: null,
    }
  }
  const window = filingWindow(input.payer ?? undefined)
  const deadline = new Date(denialDate)
  deadline.setDate(deadline.getDate() + window.days)
  return {
    expectedBy: deadline,
    expectation:
      window.source === 'payer'
        ? `${window.name} stops accepting this after`
        : 'The filing window is estimated to close',
  }
}

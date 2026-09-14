import type { SubmissionOutcomeValue } from './outcomes'

/**
 * Outcomes the A/R export already knows about.
 *
 * ── Why this exists at all ────────────────────────────────────────────────
 *
 * The outcome ledger is only worth having if it gets filled in, and asking a
 * billing team to come back six weeks later and close out every appeal by hand
 * is asking for the one thing they have never had time for. Left to manual
 * entry, the wins get recorded (someone is happy) and the losses do not, which
 * does not produce a thin dataset — it produces a confidently wrong one.
 *
 * But a practice that uploads a monthly A/R export is already telling us the
 * answer. A claim that was denied, appealed in March, and shows PAID on the
 * April snapshot with a remit date after the appeal went out is an appeal that
 * worked, and nobody had to type anything.
 *
 * ── What this deliberately will not do ────────────────────────────────────
 *
 * It never proposes a loss. A claim still showing DENIED on a later snapshot is
 * far more likely to be a line the payer has not revisited than a ruling on the
 * appeal, and the two are indistinguishable from an A/R export. Writing those
 * as denials would push every win rate down by however long the payer takes,
 * which is the one direction of error that costs the customer money: a biller
 * reads "CO-97 to Aetna never works", stops appealing it, and never finds out.
 * Silence stays PENDING and stays in the follow-up queue where a human sees it.
 *
 * It also requires the remit to be dated AFTER the submission. Without that
 * test, the original remittance that caused the denial in the first place
 * matches its own appeal and books every single one as an instant win.
 *
 * Everything here is pure. The commit route loads the rows, calls this, and
 * writes what comes back.
 */

/** A submission still waiting on an answer, flattened with its row's facts. */
export interface OpenSubmission {
  id: string
  rowId: string
  /** The row's claim number. Null rows can never be matched and are skipped. */
  claimNumber: string | null
  sentAt: Date
  /** The row's billed amount, for deciding full versus partial payment. */
  billed: number
}

/** A line from the snapshot being committed. */
export interface SnapshotClaim {
  claimNumber: string | null
  status: string
  paid: number | null
  remitDate: Date | null
}

export interface OutcomeProposal {
  submissionId: string
  rowId: string
  outcome: Extract<SubmissionOutcomeValue, 'PAID' | 'PARTIAL'>
  outcomeAt: Date
  amountRecovered: number | null
  /** Written into outcomeNote so the biller can see where the answer came from. */
  note: string
}

/**
 * Looser than the exact string match the claim list joins on.
 *
 * A denials export and an A/R export out of the same billing system routinely
 * disagree on case and padding for the same claim, and an unmatched claim here
 * costs a real outcome. Case and surrounding whitespace only — punctuation is
 * left alone, because "12345-01" and "1234501" are two claims often enough that
 * collapsing them would be worse than missing one.
 */
export function claimKey(n: string | null | undefined): string | null {
  const t = (n ?? '').trim().toUpperCase()
  return t.length > 0 ? t : null
}

const PAID_STATUSES = new Set(['PAID', 'PARTIAL'])

export function reconcileOutcomes(input: {
  open: readonly OpenSubmission[]
  claims: readonly SnapshotClaim[]
}): OutcomeProposal[] {
  if (input.open.length === 0) return []

  // Best line per claim number: the one with the latest remit date, so a
  // snapshot carrying several lines for a claim resolves against the most
  // recent word on it rather than whichever happened to be read first.
  const byClaim = new Map<string, SnapshotClaim>()
  for (const c of input.claims) {
    const key = claimKey(c.claimNumber)
    if (!key) continue
    if (!PAID_STATUSES.has(c.status)) continue
    const seen = byClaim.get(key)
    if (!seen || (c.remitDate?.getTime() ?? 0) > (seen.remitDate?.getTime() ?? 0)) {
      byClaim.set(key, c)
    }
  }

  const proposals: OutcomeProposal[] = []
  // One proposal per row, not per submission: a row with a first-level and a
  // second-level appeal both open has one payment to account for, and crediting
  // it to both would double the recovered dollars and inflate both win rates.
  // The most recent submission is the one the payment answers.
  const newestPerRow = new Map<string, OpenSubmission>()
  for (const s of input.open) {
    const seen = newestPerRow.get(s.rowId)
    if (!seen || s.sentAt.getTime() > seen.sentAt.getTime()) newestPerRow.set(s.rowId, s)
  }

  for (const sub of newestPerRow.values()) {
    const key = claimKey(sub.claimNumber)
    if (!key) continue
    const claim = byClaim.get(key)
    if (!claim?.remitDate) continue

    // The test that stops the original denial remit booking itself as a win.
    if (claim.remitDate.getTime() <= sub.sentAt.getTime()) continue

    const paid = claim.paid ?? 0
    if (paid <= 0) continue

    // Full versus partial is decided on the dollars, not on the exported
    // status: a snapshot that labels everything PAID the moment any money moves
    // would otherwise book a $40 payment on a $400 claim as a clean win.
    // A cent of rounding either way is not a partial payment.
    const full = paid >= sub.billed - 0.01
    proposals.push({
      submissionId: sub.id,
      rowId: sub.rowId,
      outcome: full ? 'PAID' : 'PARTIAL',
      outcomeAt: claim.remitDate,
      amountRecovered: paid,
      note: full
        ? 'Matched to a paid claim on a later A/R export. Confirm before relying on it.'
        : `Matched to a part-paid claim on a later A/R export ($${paid.toFixed(2)} of $${sub.billed.toFixed(2)}). Confirm before relying on it.`,
    })
  }

  return proposals
}

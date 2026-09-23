/**
 * What the payer panel says about itself before anyone opens anything.
 *
 * The panel used to render everything at once: eleven figure tiles of equal
 * weight, a six-row reasons table, the appeal record, the send-to block and a
 * sentence of explanation under every heading — with three of the figures
 * printed twice. Nothing was hidden, so nothing was emphasised, and the one
 * thing a biller opens a payer to find out was the same size as everything
 * else.
 *
 * It now follows the claim panel (lib/claims/section-summary.ts): one headline
 * that answers "is there money to go and get from this payer, and is any of it
 * about to expire", then collapsed sections, each summarised well enough that
 * most of them never need opening. These functions are those summaries.
 *
 * Plain functions rather than JSX for the same reason the claim ones are:
 * vitest runs in node with no React testing library, and the rule that matters
 * most — a rate never appears without the count behind it — has to be tested,
 * not reviewed.
 *
 * TWO SOURCES, STILL NEVER SUMMED. The headline and the reasons come from the
 * denial worklist; "how they pay" comes from the A/R snapshot; appeals come
 * from the outcome ledger. Each summary reads exactly one of them.
 */

import { usd } from '@/lib/charts/format'
import { EXPIRING_SOON_DAYS } from '@/lib/denials/triage'
import type { ResolvedDestination, SubmissionOption } from '@/lib/billing/submission'
import { outcomeLine } from '@/lib/denials/outcomes'
import type { PayerReason, PayerRow } from '@/lib/insights/aggregate'

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/* -------------------------------------------------------------- headline --- */

export type PayerHeadline = {
  /** The big figure. Null when there is no money to show, and `lead` says why. */
  amount: number | null
  /** Beside the amount ("recoverable"), or the whole headline without one. */
  lead: string
  /** Quiet context: how many denials, how long the window is. */
  context: string[]
  /** The only clauses allowed to shout — money about to be lost, or lost. */
  urgent: string[]
}

/**
 * The one number a payer is opened for, and the clauses that decide whether to
 * act on it today.
 *
 * Recoverable money leads because it is the only figure on the panel that can
 * be acted on this morning. The denial rate and days to pay describe a standing
 * relationship; they are one click down, in the section that owns them.
 */
export function payerHeadline(
  row: Pick<
    PayerRow,
    | 'atStake'
    | 'openDenials'
    | 'expiringSoon'
    | 'expired'
    | 'expiredBilled'
    | 'filingWindowDays'
    | 'filingWindowSource'
  >,
): PayerHeadline {
  const window = `${row.filingWindowDays}-day appeal window${row.filingWindowSource === 'default' ? ' (estimated)' : ''}`

  const urgent: string[] = []
  if (row.expiringSoon > 0) {
    urgent.push(`${usd(row.expiringSoon)} closes within ${EXPIRING_SOON_DAYS} days`)
  }
  if (row.expired > 0) urgent.push(`${usd(row.expiredBilled)} already past the window`)

  if (row.openDenials === 0) {
    return { amount: null, lead: 'Nothing open on the worklist', context: [window], urgent: [] }
  }

  if (row.atStake <= 0) {
    return {
      amount: null,
      lead: 'Nothing recoverable',
      context: [plural(row.openDenials, 'open denial'), window],
      urgent,
    }
  }

  return {
    amount: row.atStake,
    lead: 'recoverable',
    context: [`on ${plural(row.openDenials, 'open denial')}`, window],
    urgent,
  }
}

/* --------------------------------------------------------------- reasons --- */

export type ReasonsSummary = { carc: string; label: string; more: number }

/**
 * The reason they deny on most, and how many others there are.
 *
 * Null when there are no open denials to read reasons from — and then the
 * section is not rendered. A row that opens onto "nothing here" is the clutter
 * this panel was rebuilt to remove.
 */
export function reasonsSummary(reasons: readonly PayerReason[]): ReasonsSummary | null {
  const [top, ...rest] = reasons
  if (!top) return null
  return { carc: top.carc, label: top.label, more: rest.length }
}

/* -------------------------------------------------------------- payments --- */

/**
 * How this payer treats a claim in general, from the A/R snapshot.
 *
 * The denial rate always travels with the number of claims it was taken over:
 * "5.4%" is a finding about 240 claims and a coin toss about four.
 *
 * Null when no claim in the snapshot names this payer. There is no
 * denominator, so there is no section.
 */
export function paymentsSummary(
  row: Pick<PayerRow, 'claims' | 'denialRate' | 'medianDaysToPay'>,
): string | null {
  if (row.claims <= 0) return null

  const parts: string[] = []
  if (row.denialRate !== null) {
    parts.push(`Deny ${row.denialRate.toFixed(1)}% of ${plural(row.claims, 'claim')}`)
  }
  if (row.medianDaysToPay !== null) parts.push(`typically pay in ${plural(row.medianDaysToPay, 'day')}`)

  return parts.length > 0 ? parts.join(' · ') : plural(row.claims, 'claim')
}

/* --------------------------------------------------------------- appeals --- */

/**
 * What came back from appealing this payer. The ledger's own one-line wording
 * (outcomeLine in lib/denials/outcomes.ts), so the payer panel and the
 * Analytics outcomes card say the same thing about the same rulings. Null when
 * nothing has ever been sent to them — the section is then not rendered.
 */
export const appealsSummary = outcomeLine

/* ------------------------------------------------------------------ send --- */

const CHANNEL: Record<SubmissionOption['channel'], string> = {
  PORTAL: 'Portal',
  FAX: 'Fax',
  MAIL: 'Mail',
  CLEARINGHOUSE: 'Clearinghouse',
}

/** One channel as a clause. An address is its first line; the rest is below. */
export function channelLine(option: SubmissionOption, ediPayerId: string | null): string {
  if (option.channel === 'CLEARINGHOUSE') {
    return ediPayerId ? `Clearinghouse · EDI payer ID ${ediPayerId}` : 'Clearinghouse'
  }
  const first = option.label.split('\n')[0].trim()
  return `${CHANNEL[option.channel] ?? option.channel} · ${first}`
}

/**
 * Where a response to this payer goes, in one line.
 *
 * Says when the answer came from our directory rather than the customer's own
 * saved entry: an address a biller has not checked is the one they should
 * check, and that is worth four words on the summary.
 */
export function sendSummary(dest: ResolvedDestination | null, loading = false): string {
  if (loading) return 'Looking it up…'
  if (!dest || dest.options.length === 0) return 'Nothing on file yet'

  const [first, ...rest] = dest.options
  const parts = [channelLine(first, dest.ediPayerId)]
  if (rest.length > 0) parts.push(`${rest.length} more`)
  if (dest.source === 'org') parts.push('saved by you')
  else if (dest.needsVerification) parts.push('check before sending')
  return parts.join(' · ')
}

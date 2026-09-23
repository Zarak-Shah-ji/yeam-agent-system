/**
 * How a payer's name is shown, grouped and matched.
 *
 * ── Why this is its own file ──────────────────────────────────────────────
 *
 * payerKey lived in lib/billing/submission.ts, and payerOf and UNKNOWN_PAYER in
 * lib/insights/aggregate.ts, each next to the code that uses it most. That is
 * the right neighbourhood for reading them and the wrong one for importing
 * them: submission.ts pulls in the payer directory, the CARC playbooks and the
 * drafting rules — some 57KB of prompt text — and aggregate.ts the CARC and
 * procedure tables, while the payer scorecard needs a few lines of string
 * handling to match a win rate to a row. A client-side import of a name
 * normaliser should not ship the letter writer.
 *
 * submission.ts and aggregate.ts re-export them, so every existing call site
 * is unchanged.
 */

/** The heading rows that named no payer are filed under. */
export const UNKNOWN_PAYER = 'Unknown payer'

/**
 * A payer as it is displayed and grouped: the name as the export wrote it,
 * trimmed, or UNKNOWN_PAYER for a blank.
 *
 * Distinct from payerKey below, which is for matching rather than showing —
 * "AETNA " and "Aetna" group under their own spellings here and meet at the
 * same key there.
 */
export function payerOf(value: string | null | undefined): string {
  const name = (value ?? '').trim()
  return name || UNKNOWN_PAYER
}

/**
 * Normalize a free-text payer name to a stable key.
 *
 * "UnitedHealthcare", "United Healthcare" and "UNITED HEALTHCARE  " must find
 * the same PayerDestination row, or a biller who saved an address once is asked
 * for it again on the next import.
 */
export function payerKey(name: string | null | undefined): string | null {
  const trimmed = (name ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  return trimmed ? trimmed.replace(/\s+/g, '-') : null
}

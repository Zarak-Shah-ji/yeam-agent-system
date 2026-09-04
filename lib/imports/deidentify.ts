/**
 * The de-identification boundary. One constant, one place.
 *
 * DE-IDENTIFICATION IS ENFORCED HERE. Only the fields a profile explicitly names
 * are ever read out of an upload; a patient name, member ID or date of birth is
 * dropped before a Prisma call can see it, and no table in the denial workspace
 * has a column to hold one anyway. That is what lets a workspace run without a
 * signed BAA, so treat any change here as a legal change, not a schema change.
 *
 * This used to live inside lib/denials/parse-claims.ts, which was fine while
 * there was exactly one parser. It moved the moment a second one existed: a
 * per-parser copy of this pattern is how the promise quietly stops being true
 * for whichever parser was written last.
 *
 * Every import profile MUST import isIgnorableColumn from here, and no profile's
 * field union may name an identifier. Both halves are covered by tests.
 */

/** Columns we deliberately never read. Surfaced in the UI so it's visible. */
const IGNORED_PATTERN =
  /\b(patient|member|subscriber|dob|birth|ssn|mrn|npi|address|phone|email|guarantor|first\s*name|last\s*name)\b/i

/**
 * The one narrow exception, and why it exists.
 *
 * "Patient Responsibility", "Patient Balance" and "Pt Portion" are standard
 * columns in an A/R export and are dollar amounts, not identifiers — but they
 * contain the word "patient", so the veto above refuses them and the coinsurance
 * half of every balance disappears from the aging report.
 *
 * This is anchored to the WHOLE header and every phrase it admits names money.
 * That is what keeps it safe: "Patient Name", "Patient DOB" and "Patient Member
 * ID" cannot match it, because a trailing or leading identifier word breaks the
 * anchor. Do not relax the anchors, and do not add a term that could name a
 * person. Widening this is a legal change.
 */
const PERMITTED_MONEY_PATTERN =
  /^(patient|pt|member)[\s_-]*(responsibility|resp(onsible)?|balance|portion|share|due|owes|liability|copay|co[\s-]*pay|coinsurance|deductible)[\s_-]*(amount|amt|due|balance|\$)?$/i

export function isIgnorableColumn(header: string): boolean {
  const name = (header ?? '').trim()
  if (PERMITTED_MONEY_PATTERN.test(name)) return false
  return IGNORED_PATTERN.test(name)
}

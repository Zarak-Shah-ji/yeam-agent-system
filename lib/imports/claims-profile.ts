/**
 * The A/R + claims export profile.
 *
 * A denials export has no denominator. You cannot compute a denial rate, a
 * collection rate or an A/R aging bucket from denials alone — you need the
 * claims that were paid too. This profile reads the "all claims" or "A/R aging"
 * export every billing system can produce, which is what makes the money charts
 * real rather than a multiple of what was collected.
 *
 * DE-IDENTIFICATION: the field union below names no patient identifier, and the
 * veto in lib/imports/deidentify.ts is applied to every header before it can be
 * mapped. A claims export usually carries a patient name column; it is refused
 * here exactly as it is in the denials profile, and named back to the customer
 * in the import preview. Widening ClaimFieldId is a legal change.
 *
 * A claims batch is a SNAPSHOT, not an accumulation. Unioning January's export
 * with February's double-counts every claim that appears in both, so analytics
 * reads the most recent claims batch only. See lib/insights/aggregate.ts.
 */

import { isIgnorableColumn } from './deidentify'
import {
  cellReader,
  detectMapping,
  type HeaderPattern,
  type Mapping as GenericMapping,
} from './mapping'
import { parseDate, parseMoney } from './table'

/* ---------------------------------------------------------------- status --- */

/** Mirrors the OrgClaimStatus enum in prisma/schema.prisma. */
export const CLAIM_STATUSES = [
  'PAID',
  'PARTIAL',
  'DENIED',
  'PENDING',
  'REJECTED',
  'WRITTEN_OFF',
  'UNKNOWN',
] as const

export type ClaimStatus = (typeof CLAIM_STATUSES)[number]

/**
 * Status text as it arrives, normalised. Ordered most specific first: "partially
 * paid" must not read as "paid", and "denied - appeal pending" must not read as
 * "pending".
 */
const STATUS_PATTERNS: [ClaimStatus, RegExp][] = [
  ['WRITTEN_OFF', /\b(written?[\s-]*off|write[\s-]*off|w\/?o|adjust(ed|ment)?[\s-]*off|bad\s*debt|closed[\s-]*no[\s-]*pay)\b/i],
  ['DENIED', /\b(denied|denial|dn|non[\s-]*covered|not\s*covered)\b/i],
  ['REJECTED', /\b(reject(ed|ion)?|rj|returned|invalid|scrub\s*fail)\b/i],
  ['PARTIAL', /\b(partial(ly)?|part[\s-]*paid|underpaid|short[\s-]*paid)\b/i],
  ['PAID', /\b(paid|pd|closed[\s-]*paid|adjudicated[\s-]*paid|remitted)\b/i],
  ['PENDING', /\b(pending|in[\s-]*process(ing)?|submitted|sent|open|outstanding|awaiting|in[\s-]*review|accepted|clean)\b/i],
]

/**
 * A status string we do not recognise reads as UNKNOWN, never as a guess. An
 * unrecognised status counted as PAID would overstate collections; counted as
 * DENIED it would invent a denial rate. Both are worse than saying so.
 */
export function normalizeStatus(raw: string | undefined): ClaimStatus {
  const s = (raw ?? '').trim()
  if (!s) return 'UNKNOWN'
  for (const [status, pattern] of STATUS_PATTERNS) {
    if (pattern.test(s)) return status
  }
  return 'UNKNOWN'
}

/**
 * Where the export has no status column at all, infer one from the money.
 *
 * Common in A/R aging reports, which assume every row is outstanding. Kept
 * separate from normalizeStatus so the preview can tell the customer the status
 * was derived rather than read, and deliberately conservative: a reason code
 * with nothing paid is the only thing that reads as a denial.
 */
export function deriveStatus(input: {
  billed: number
  paid?: number
  carc?: string
}): ClaimStatus {
  const paid = input.paid ?? 0
  if (paid > 0) return paid + 0.005 >= input.billed ? 'PAID' : 'PARTIAL'
  if (input.carc && input.carc.trim()) return 'DENIED'
  return 'PENDING'
}

/* --------------------------------------------------------------- mapping --- */

export type ClaimFieldId =
  | 'claimNumber'
  | 'payer'
  | 'status'
  | 'billed'
  | 'allowed'
  | 'paid'
  | 'patientResp'
  | 'adjustment'
  | 'serviceDate'
  | 'submittedDate'
  | 'remitDate'
  | 'cpt'
  | 'icd10'
  | 'carc'

export const CLAIM_FIELD_LABEL: Record<ClaimFieldId, string> = {
  claimNumber: 'Claim number',
  payer: 'Payer',
  status: 'Claim status',
  billed: 'Billed amount',
  allowed: 'Allowed amount',
  paid: 'Paid amount',
  patientResp: 'Patient responsibility',
  adjustment: 'Adjustment / write-off',
  serviceDate: 'Date of service',
  submittedDate: 'Date submitted',
  remitDate: 'Remit or paid date',
  cpt: 'Procedure (CPT)',
  icd10: 'Diagnosis (ICD-10)',
  carc: 'Reason code (CARC)',
}

export const CLAIM_FIELD_IDS: ClaimFieldId[] = Object.keys(CLAIM_FIELD_LABEL) as ClaimFieldId[]

/**
 * Most specific first, and dates ahead of money.
 *
 * detectMapping gives one header to at most one field, so listing "Paid Date"'s
 * pattern above the paid-amount pattern is what stops a date column being read
 * as dollars.
 */
export const CLAIM_HEADER_PATTERNS: HeaderPattern<ClaimFieldId>[] = [
  ['serviceDate', /\b(dos|service\s*date|date\s*of\s*service|from\s*date|svc\s*date)\b/i],
  ['submittedDate', /\b(submit(ted)?\s*date|date\s*submitted|billed\s*date|date\s*billed|filed\s*date|entry\s*date)\b/i],
  ['remitDate', /\b(remit(tance)?\s*date|paid\s*date|check\s*date|eob\s*date|posted\s*date|payment\s*date|date\s*paid)\b/i],
  ['status', /\b(claim\s*status|status|disposition|claim\s*state)\b/i],
  ['allowed', /\b(allowed|allowable|contract(ed)?\s*(amount|rate)|approved\s*amount)\b/i],
  ['patientResp', /\b(patient\s*resp\w*|pat\s*resp|copay|co[\s-]*pay|coinsurance|deductible|responsibility)\b/i],
  ['adjustment', /\b(adjust\w*|write[\s-]*off|writeoff|contractual)\b/i],
  ['paid', /\b(paid|payment|reimburse\w*|insurance\s*paid|amount\s*paid|pmt)\b/i],
  ['billed', /\b(billed|charge[ds]?|billed\s*amount|charge\s*amount|total\s*charge|gross)\b/i],
  ['carc', /\b(carc|reason\s*code|adjustment\s*code|denial\s*code|group\s*code)\b/i],
  ['payer', /\b(payer|payor|insurance|carrier|plan\s*name)\b/i],
  ['claimNumber', /\b(claim\s*(number|no|num|#|id)|icn)\b/i],
  ['cpt', /\b(cpt|hcpcs|procedure\s*code|proc\s*code)\b/i],
  ['icd10', /\b(icd|diagnosis|dx)\b/i],
]

export type ClaimMapping = GenericMapping<ClaimFieldId>

export function detectClaimMapping(headers: string[]): ClaimMapping {
  return detectMapping(headers, CLAIM_HEADER_PATTERNS)
}

/**
 * What the file must carry to be worth importing.
 *
 * An amount, and at least one date. Aging, revenue-by-month and every trend in
 * the product are computed from a date; a claims snapshot without one produces
 * charts with a single undated bar, which is worse than refusing the file.
 */
export function missingRequiredClaims(mapping: ClaimMapping): string[] {
  const missing: string[] = []
  if (mapping.billed === undefined) missing.push(CLAIM_FIELD_LABEL.billed)
  if (
    mapping.serviceDate === undefined &&
    mapping.submittedDate === undefined &&
    mapping.remitDate === undefined
  ) {
    missing.push('a date column (service, submitted or remit)')
  }
  return missing
}

/* ----------------------------------------------------------------- rows --- */

export type ClaimRecord = {
  claimNumber?: string
  payer?: string
  status: ClaimStatus
  billed: number
  allowed?: number
  paid?: number
  patientResp?: number
  adjustment?: number
  serviceDate: Date | null
  submittedDate: Date | null
  remitDate: Date | null
  cpt?: string
  icd10?: string
  carc?: string
}

export type BuildClaimsResult = {
  rows: ClaimRecord[]
  skipped: number
  /** True when no status column existed and status came from the amounts. */
  statusDerived: boolean
}

/**
 * Turn mapped cells into claim records.
 *
 * A row with no amount and no date carries nothing usable, so it is counted as
 * skipped rather than dropped silently — a file that mostly fails to map should
 * look wrong, not look empty. Same rule as buildRows() in the denials profile.
 */
export function buildClaimRows(
  dataRows: string[][],
  mapping: ClaimMapping,
): BuildClaimsResult {
  const at = cellReader(mapping)
  const statusDerived = mapping.status === undefined

  const rows: ClaimRecord[] = []
  let skipped = 0

  const optionalMoney = (row: string[], field: ClaimFieldId): number | undefined => {
    const raw = at(row, field)
    return raw ? parseMoney(raw) : undefined
  }

  for (const row of dataRows) {
    const billedRaw = at(row, 'billed')
    const serviceDate = parseDate(at(row, 'serviceDate'))
    const submittedDate = parseDate(at(row, 'submittedDate'))
    const remitDate = parseDate(at(row, 'remitDate'))

    if (!billedRaw && !serviceDate && !submittedDate && !remitDate) {
      skipped += 1
      continue
    }

    const billed = parseMoney(billedRaw)
    const paid = optionalMoney(row, 'paid')
    const carc = at(row, 'carc') || undefined

    rows.push({
      claimNumber: at(row, 'claimNumber') || undefined,
      payer: at(row, 'payer') || undefined,
      status: statusDerived
        ? deriveStatus({ billed, paid, carc })
        : normalizeStatus(at(row, 'status')),
      billed,
      allowed: optionalMoney(row, 'allowed'),
      paid,
      patientResp: optionalMoney(row, 'patientResp'),
      adjustment: optionalMoney(row, 'adjustment'),
      serviceDate,
      submittedDate,
      remitDate,
      cpt: at(row, 'cpt') || undefined,
      icd10: at(row, 'icd10') || undefined,
      carc,
    })
  }

  return { rows, skipped, statusDerived }
}

/* -------------------------------------------------------------- profiles --- */

export type ImportProfile = 'denials' | 'claims'

export type ProfileDetection = {
  profile: ImportProfile
  confident: boolean
  /**
   * The columns that decided it. Naming them is what lets the upload UI say
   * "this has Paid and Allowed columns, so it is an A/R export" instead of the
   * unactionable "this could be read either way".
   */
  evidence: string[]
}

/**
 * Guess which kind of export this is.
 *
 * The signal is settlement money — an allowed or paid AMOUNT — not a status
 * column. A denials export routinely carries a status column too; the shipped
 * sample workbook has one, reading DENIED on every row. Treating that as a
 * claims export would import denials as a snapshot and report a 100% denial
 * rate against a denominator of only the denied claims.
 *
 * Date columns are excluded from the money test, so a "Paid Date" on a denials
 * export does not read as a payment amount.
 *
 * A confident answer here beats the profile the customer dropped the file on —
 * see parseImport. An A/R export imported through the denials box lands as
 * denial rows, and the Claims page then correctly reports that no claims have
 * been imported, which is a very hard thing to work out from the outside.
 */
export function detectProfile(headers: string[]): ProfileDetection {
  const visible = headers.filter(h => h && !isIgnorableColumn(h))
  const named = (pattern: RegExp) => visible.filter(h => pattern.test(h)).map(h => h.trim())
  const amounts = (pattern: RegExp) =>
    visible.filter(h => pattern.test(h) && !/\bdate\b/i.test(h)).map(h => h.trim())

  const paid = amounts(/\b(paid|payment|reimburse\w*|pmt)\b/i)
  const allowed = amounts(/\b(allowed|allowable|approved\s*amount|contract(ed)?\s*(amount|rate))\b/i)
  const carc = named(/\b(carc|reason\s*code|adjustment\s*code|denial\s*code)\b/i)
  const status = named(/\b(claim\s*status|status|disposition)\b/i)

  const money = [...new Set([...paid, ...allowed])]
  if (money.length > 0) return { profile: 'claims', confident: true, evidence: money }
  if (carc.length > 0) return { profile: 'denials', confident: true, evidence: carc }
  if (status.length > 0) return { profile: 'claims', confident: false, evidence: status }
  return { profile: 'denials', confident: false, evidence: [] }
}

/**
 * The denied-claims export profile.
 *
 * Every billing system — Athena, eCW, Kareo, AdvancedMD — will export "denials,
 * last 90 days" to CSV or XLSX. That export is the only integration Yeam needs
 * to say something true about a billing company's own denials: no API, no IT
 * ticket, no clearinghouse feed.
 *
 * The column-mapping rules below are ported verbatim from lib/parseClaims.ts in
 * the yeam_website repo, so a file triaged in the free browser tool maps
 * identically once it is saved here. See lib/denials/triage.ts for the note on
 * keeping the two copies honest.
 *
 * This file used to own the file reader, the coercion helpers and the
 * de-identification pattern too. Those now live in lib/imports/ so the A/R
 * export profile shares one implementation rather than growing a second, weaker
 * copy — in particular the identifier veto, which is imported by every profile
 * and cannot be opted out of. The moved symbols are re-exported below so this
 * module stays the one place to import the denials profile from.
 *
 * DE-IDENTIFICATION: only the eight fields in FieldId are ever read out of an
 * upload. See lib/imports/deidentify.ts — widening that is a legal change, not a
 * schema change.
 */

import type { ClaimRow } from './triage'
import {
  cellReader,
  detectMapping as detectMappingWith,
  missingRequired as missingRequiredWith,
  type HeaderPattern,
  type Mapping as GenericMapping,
} from '@/lib/imports/mapping'
import { parseDate, parseMoney } from '@/lib/imports/table'

export { isIgnorableColumn } from '@/lib/imports/deidentify'
export { reportColumns, applyOverrides, type ColumnReport } from '@/lib/imports/mapping'
export {
  parseMoney,
  parseDate,
  readClaimsTable,
  ClaimsFileError,
  MAX_CLAIMS_FILE_BYTES,
} from '@/lib/imports/table'

/* --------------------------------------------------------------- mapping --- */

export type FieldId =
  | 'claimNumber'
  | 'payer'
  | 'carc'
  | 'billed'
  | 'denialDate'
  | 'cpt'
  | 'icd10'
  | 'reason'

export const FIELD_LABEL: Record<FieldId, string> = {
  claimNumber: 'Claim number',
  payer: 'Payer',
  carc: 'Reason code (CARC)',
  billed: 'Billed amount',
  denialDate: 'Remit or service date',
  cpt: 'Procedure (CPT)',
  icd10: 'Diagnosis (ICD-10)',
  reason: 'Denial reason text',
}

export const FIELD_IDS: FieldId[] = Object.keys(FIELD_LABEL) as FieldId[]

/** Without a code and an amount there is nothing to triage. */
export const REQUIRED_FIELDS: FieldId[] = ['carc', 'billed']

/**
 * Header patterns, most specific first. A remittance date beats a service date
 * for deadline purposes, so it is matched ahead of the DOS fallback.
 */
export const HEADER_PATTERNS: HeaderPattern<FieldId>[] = [
  ['carc', /\b(carc|reason\s*code|adjustment\s*code|denial\s*code|group\s*code)\b/i],
  ['billed', /\b(billed|charge[ds]?|billed\s*amount|charge\s*amount|total\s*charge)\b/i],
  ['denialDate', /\b(remit|remittance|denial\s*date|denied\s*on|eob\s*date|check\s*date|paid\s*date)\b/i],
  ['denialDate', /\b(dos|service\s*date|date\s*of\s*service|from\s*date)\b/i],
  ['payer', /\b(payer|payor|insurance|carrier|plan\s*name)\b/i],
  ['claimNumber', /\b(claim\s*(number|no|num|#|id)|icn)\b/i],
  ['cpt', /\b(cpt|hcpcs|procedure\s*code|proc\s*code)\b/i],
  ['icd10', /\b(icd|diagnosis|dx)\b/i],
  ['reason', /\b(denial\s*reason|reason\s*desc|description|remark)\b/i],
]

export type Mapping = GenericMapping<FieldId>

export function detectMapping(headers: string[]): Mapping {
  return detectMappingWith(headers, HEADER_PATTERNS)
}

export function missingRequired(mapping: Mapping): FieldId[] {
  return missingRequiredWith(mapping, REQUIRED_FIELDS)
}

export type BuildResult = { rows: ClaimRow[]; skipped: number }

/**
 * Turn mapped cells into claim rows. Rows with no reason code are counted as
 * skipped rather than silently dropped — a file that mostly fails to map should
 * look wrong, not look empty.
 */
export function buildRows(dataRows: string[][], mapping: Mapping): BuildResult {
  const at = cellReader(mapping)

  const rows: ClaimRow[] = []
  let skipped = 0

  for (const row of dataRows) {
    const carc = at(row, 'carc')
    if (!carc) {
      skipped += 1
      continue
    }
    rows.push({
      claimNumber: at(row, 'claimNumber') || undefined,
      payer: at(row, 'payer') || undefined,
      carc,
      billed: parseMoney(at(row, 'billed')),
      denialDate: parseDate(at(row, 'denialDate')),
      cpt: at(row, 'cpt') || undefined,
      icd10: at(row, 'icd10') || undefined,
      reason: at(row, 'reason') || undefined,
    })
  }
  return { rows, skipped }
}

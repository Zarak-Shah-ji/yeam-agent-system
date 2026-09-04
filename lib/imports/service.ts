/**
 * Parsing an upload, and saving it.
 *
 * One module behind both /api/imports/preview and /api/imports/commit so the two
 * cannot disagree about what a file says. Preview persists nothing; commit runs
 * the identical parse and writes the result. If they ever diverge, the customer
 * confirms one mapping and gets another.
 *
 * Profile-agnostic on the surface: a caller passes bytes and gets back a field
 * list with the header each field matched and the value it parsed to. That is
 * what the preview renders, and it is the answer to a problem the denials parser
 * has had since it shipped — a DD/MM export silently misreads every date, and
 * dates drive every filing deadline and every aging bucket in the product.
 */

import { isIgnorableColumn } from './deidentify'
import { applyOverrides, reportColumns, type Mapping } from './mapping'
import { ClaimsFileError, parseDate, parseMoney, readClaimsTable } from './table'
import {
  CLAIM_FIELD_IDS,
  CLAIM_FIELD_LABEL,
  CLAIM_HEADER_PATTERNS,
  buildClaimRows,
  detectClaimMapping,
  detectProfile,
  missingRequiredClaims,
  normalizeStatus,
  type ClaimFieldId,
  type ClaimRecord,
  type ImportProfile,
} from './claims-profile'
import {
  FIELD_IDS,
  FIELD_LABEL,
  HEADER_PATTERNS,
  buildRows,
  detectMapping,
  missingRequired,
  type FieldId,
} from '@/lib/denials/parse-claims'
import type { ClaimRow } from '@/lib/denials/triage'

export { ClaimsFileError }
export type { ImportProfile }

/** How a field's value should be shown back in the preview. */
type FieldKind = 'text' | 'money' | 'date' | 'status'

const DENIAL_FIELD_KIND: Record<FieldId, FieldKind> = {
  claimNumber: 'text',
  payer: 'text',
  carc: 'text',
  billed: 'money',
  denialDate: 'date',
  cpt: 'text',
  icd10: 'text',
  reason: 'text',
}

const CLAIM_FIELD_KIND: Record<ClaimFieldId, FieldKind> = {
  claimNumber: 'text',
  payer: 'text',
  status: 'status',
  billed: 'money',
  allowed: 'money',
  paid: 'money',
  patientResp: 'money',
  adjustment: 'money',
  serviceDate: 'date',
  submittedDate: 'date',
  remitDate: 'date',
  cpt: 'text',
  icd10: 'text',
  carc: 'text',
}

/** What the preview shows for one field of the profile. */
export type PreviewField = {
  id: string
  label: string
  kind: FieldKind
  required: boolean
  /** Index into headers, or null when nothing matched. */
  headerIndex: number | null
  headerName: string | null
  /** The cell as it appeared, and as it was understood. */
  sampleRaw: string | null
  sampleParsed: string | null
}

export type PreviewResult = {
  profile: ImportProfile
  /** False when detection had to fall back to a weak signal. */
  profileConfident: boolean
  filename: string
  headers: string[]
  /** Header indexes a field may be pointed at — identifier columns excluded. */
  selectableHeaders: { index: number; name: string }[]
  fields: PreviewField[]
  missing: string[]
  refusedColumns: string[]
  unusedColumns: string[]
  /** Overrides that named an identifier column and were not honoured. */
  refusedOverrides: string[]
  rowCount: number
  skipped: number
  statusDerived: boolean
}

type ParsedDenials = { kind: 'denials'; rows: ClaimRow[]; skipped: number }
type ParsedClaims = {
  kind: 'claims'
  rows: ClaimRecord[]
  skipped: number
  statusDerived: boolean
}
export type ParsedFile = (ParsedDenials | ParsedClaims) & {
  preview: PreviewResult
}

function display(kind: FieldKind, raw: string): string | null {
  if (!raw) return null
  switch (kind) {
    case 'money':
      return parseMoney(raw).toFixed(2)
    case 'date': {
      const d = parseDate(raw)
      return d ? d.toISOString().slice(0, 10) : 'could not read as a date'
    }
    case 'status':
      return normalizeStatus(raw)
    default:
      return raw
  }
}

/** First non-empty value in a column, so the sample is not a blank cell. */
function firstValue(dataRows: string[][], index: number): string | null {
  for (const row of dataRows.slice(0, 50)) {
    const v = (row[index] ?? '').trim()
    if (v) return v
  }
  return null
}

function buildFields<F extends string>(
  ids: readonly F[],
  labels: Record<F, string>,
  kinds: Record<F, FieldKind>,
  required: readonly string[],
  mapping: Mapping<F>,
  headers: string[],
  dataRows: string[][],
): PreviewField[] {
  return ids.map(id => {
    const idx = mapping[id]
    const raw = idx === undefined ? null : firstValue(dataRows, idx)
    return {
      id,
      label: labels[id],
      kind: kinds[id],
      required: required.includes(labels[id]) || required.includes(id),
      headerIndex: idx ?? null,
      headerName: idx === undefined ? null : (headers[idx] ?? '').trim() || null,
      sampleRaw: raw,
      sampleParsed: raw === null ? null : display(kinds[id], raw),
    }
  })
}

/**
 * Read a file into rows plus everything the preview needs to describe them.
 *
 * Throws ClaimsFileError for anything the customer can fix — an unreadable
 * format, a missing required column, a file with nothing in it. Route handlers
 * turn those into a 422 with the message intact.
 */
export async function parseImport(options: {
  buffer: Buffer
  filename: string
  profile?: ImportProfile
  mappingOverride?: Record<string, number>
}): Promise<ParsedFile> {
  const { buffer, filename, mappingOverride = {} } = options
  const { headers, dataRows } = await readClaimsTable(buffer, filename)

  const detected = detectProfile(headers)
  const profile = options.profile ?? detected.profile

  const selectableHeaders = headers
    .map((name, index) => ({ index, name: (name ?? '').trim() }))
    .filter(h => h.name && !isIgnorableColumn(h.name))

  if (profile === 'claims') {
    const base = detectClaimMapping(headers)
    const { mapping, refusedOverrides } = applyOverrides(
      base,
      mappingOverride as Partial<Record<ClaimFieldId, number>>,
      headers,
      CLAIM_FIELD_IDS,
    )
    const missing = missingRequiredClaims(mapping)
    const built =
      missing.length > 0
        ? { rows: [] as ClaimRecord[], skipped: 0, statusDerived: false }
        : buildClaimRows(dataRows, mapping)
    const columns = reportColumns(headers, mapping)

    return {
      kind: 'claims',
      rows: built.rows,
      skipped: built.skipped,
      statusDerived: built.statusDerived,
      preview: {
        profile,
        profileConfident: detected.confident && detected.profile === profile,
        filename,
        headers,
        selectableHeaders,
        fields: buildFields(
          CLAIM_FIELD_IDS,
          CLAIM_FIELD_LABEL,
          CLAIM_FIELD_KIND,
          ['billed'],
          mapping,
          headers,
          dataRows,
        ),
        missing,
        refusedColumns: columns.refused,
        unusedColumns: columns.unused,
        refusedOverrides,
        rowCount: built.rows.length,
        skipped: built.skipped,
        statusDerived: built.statusDerived,
      },
    }
  }

  const base = detectMapping(headers)
  const { mapping, refusedOverrides } = applyOverrides(
    base,
    mappingOverride as Partial<Record<FieldId, number>>,
    headers,
    FIELD_IDS,
  )
  const missingFields = missingRequired(mapping)
  const built =
    missingFields.length > 0
      ? { rows: [] as ClaimRow[], skipped: 0 }
      : buildRows(dataRows, mapping)
  const columns = reportColumns(headers, mapping)

  return {
    kind: 'denials',
    rows: built.rows,
    skipped: built.skipped,
    preview: {
      profile,
      profileConfident: detected.confident && detected.profile === profile,
      filename,
      headers,
      selectableHeaders,
      fields: buildFields(
        FIELD_IDS,
        FIELD_LABEL,
        DENIAL_FIELD_KIND,
        ['carc', 'billed'],
        mapping,
        headers,
        dataRows,
      ),
      missing: missingFields.map(f => FIELD_LABEL[f]),
      refusedColumns: columns.refused,
      unusedColumns: columns.unused,
      refusedOverrides,
      rowCount: built.rows.length,
      skipped: built.skipped,
      statusDerived: false,
    },
  }
}

/**
 * The message a customer can act on when required columns are missing.
 *
 * Naming the columns it could not find beats "invalid file" — the fix is usually
 * a differently-titled column, which the biller can point at in the preview.
 */
export function missingColumnsMessage(preview: PreviewResult): string {
  return (
    `Could not find ${preview.missing.join(' or ')} in that file. ` +
    `Columns read: ${preview.headers.filter(Boolean).join(', ')}`
  )
}

export { HEADER_PATTERNS, CLAIM_HEADER_PATTERNS }

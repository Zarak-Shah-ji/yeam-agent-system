/**
 * Reading an uploaded spreadsheet into a table, and coercing its cells.
 *
 * Field-agnostic on purpose: this module knows about bytes, sheets, money and
 * dates, and nothing at all about denials or claims. Import profiles layer their
 * column knowledge on top (see lib/imports/mapping.ts).
 *
 * The coercion rules are ported verbatim from lib/parseClaims.ts in the
 * yeam_website repo, so a file triaged in the free browser tool reads identically
 * once it is saved here. What is deliberately NOT ported is that file's
 * hand-rolled ZIP/XLSX reader: it exists to avoid a supply chain in the browser,
 * and on the server SheetJS is already a dependency parsing untrusted uploads in
 * lib/appeals/parse-upload.ts.
 */

import { parse as parseCsvSync } from 'csv-parse/sync'

/* -------------------------------------------------------------- coercion --- */

/** "$1,234.50", "(75.00)" and "1234.5" all mean what you think they mean. */
export function parseMoney(raw: string): number {
  const s = (raw ?? '').trim()
  if (!s) return 0
  const negative = /^\(.*\)$/.test(s) || s.startsWith('-')
  const n = Number.parseFloat(s.replace(/[^0-9.]/g, ''))
  if (!Number.isFinite(n)) return 0
  return negative ? -n : n
}

const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30)
const MONTHS = 'jan feb mar apr may jun jul aug sep oct nov dec'.split(' ')

/**
 * Dates arrive as US-formatted text, ISO text, or an Excel serial number.
 *
 * US ordering (MM/DD) is assumed for slash dates — these are US payer remittance
 * exports. A DD/MM export would misread, which is why the import preview shows
 * the parsed date back and lets the column be remapped before anything is saved.
 */
export function parseDate(raw: string): Date | null {
  const s = (raw ?? '').trim()
  if (!s) return null

  // Excel serial. Bounded to a sane window so a claim ID never reads as a date.
  if (/^\d+(\.\d+)?$/.test(s)) {
    const serial = Number.parseFloat(s)
    if (serial > 20_000 && serial < 80_000) {
      return new Date(EXCEL_EPOCH_UTC + Math.floor(serial) * 86_400_000)
    }
    return null
  }

  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (iso) return new Date(+iso[1], +iso[2] - 1, +iso[3])

  const us = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/)
  if (us) {
    let year = +us[3]
    if (year < 100) year += year < 70 ? 2000 : 1900
    return new Date(year, +us[1] - 1, +us[2])
  }

  const named = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3,})[-\s](\d{4})$/)
  if (named) {
    const m = MONTHS.indexOf(named[2].slice(0, 3).toLowerCase())
    if (m >= 0) return new Date(+named[3], m, +named[1])
  }

  const parsed = new Date(s)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/* ------------------------------------------------------ reading the file --- */

/** Anything larger is a report, not a claims export. */
export const MAX_CLAIMS_FILE_BYTES = 8 * 1024 * 1024

export class ClaimsFileError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ClaimsFileError'
  }
}

/** A cell value from either reader, normalised to trimmed text. */
function cell(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).trim()
}

/**
 * Read an uploaded export into a header row plus data rows.
 *
 * Mirrors readClaimsFile() in the website copy, but takes bytes rather than a
 * browser File so it can run in a route handler.
 */
export async function readClaimsTable(
  buffer: Buffer,
  filename: string,
): Promise<{ headers: string[]; dataRows: string[][] }> {
  if (buffer.byteLength > MAX_CLAIMS_FILE_BYTES) {
    throw new ClaimsFileError('That file is larger than 8 MB. Export a narrower date range.')
  }

  const ext = filename.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? ''
  let table: string[][]

  if (ext === '.xlsx' || ext === '.xls') {
    const XLSX = await import('xlsx')
    const workbook = XLSX.read(buffer, { type: 'buffer' })
    const first = workbook.SheetNames[0]
    if (!first) throw new ClaimsFileError('That workbook has no readable worksheet.')
    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[first], {
      header: 1,
      blankrows: false,
    })
    table = rows.map(row => (row ?? []).map(cell))
  } else if (ext === '.csv' || ext === '.txt') {
    const rows = parseCsvSync(buffer.toString('utf8'), {
      bom: true,
      relax_column_count: true,
      skip_empty_lines: true,
    }) as unknown[][]
    table = rows.map(row => (row ?? []).map(cell))
  } else {
    throw new ClaimsFileError(
      'Upload a claims or denied-claims export as .csv or .xlsx. For a single denial letter or EOB, use the appeal drafter instead.',
    )
  }

  table = table.filter(row => row.some(c => c !== ''))
  if (table.length < 2) {
    throw new ClaimsFileError('That file has no data rows under its header.')
  }

  return { headers: table[0].map(h => h ?? ''), dataRows: table.slice(1) }
}

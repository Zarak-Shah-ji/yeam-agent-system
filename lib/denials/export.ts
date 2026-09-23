import { format } from 'date-fns'
import { BAND_LABEL, type PriorityBand } from './score'
import { statusLabel } from './status'
import type { BuiltWorklistRow } from './worklist-row'

/**
 * The worklist as a spreadsheet.
 *
 * A billing manager does not work the queue in a browser all day — they send a
 * slice of it to a contractor, reconcile it against the practice management
 * system, or put it in front of a physician who wants to see what is being
 * written off. All three are spreadsheet jobs, and all three used to mean
 * copying out of the table by hand.
 *
 * ── Built on BuiltWorklistRow, deliberately ──────────────────────────────────
 *
 * Every derived value here — daysLeft, remedyLabel, band, the call verdict — is
 * read off the row that buildWorklistRow already produced, never recomputed.
 * The failure this avoids is not an exception, it is worse: an export whose
 * deadlines are a day out from the deadlines on screen, discovered by the
 * customer, with no way to tell which one was right. One builder, one answer.
 *
 * ── No PHI, structurally ─────────────────────────────────────────────────────
 *
 * DenialRow has no patient column (__tests__/no-phi-columns.test.ts), so there
 * is nothing here to leak. EXPORT_COLUMNS being a fixed list rather than
 * `Object.keys(row)` is the second half of that: a column added to the schema
 * later cannot walk into a file a customer emails to someone, because it has to
 * be named here first. __tests__/worklist-export.test.ts runs the same
 * forbidden-field regex over these labels.
 */

/**
 * The columns, in the order they appear in the file.
 *
 * Doubles as the header row: json_to_sheet is handed this list, and exportRow
 * returns a record keyed by exactly these strings. They are human labels rather
 * than field names because the reader is a person in Excel, not a parser.
 *
 * Ordered the way the row is read rather than the way it is stored — which
 * clinic, then what claim this is, then what it is worth and when it dies, then
 * how the queue ranked it, then the diagnosis, then what this biller has already
 * done about it.
 *
 * Practice leads because it is what the file gets SORTED by. The manager who
 * exports in combined mode is usually about to split the result per clinic and
 * send each one somewhere different; without this column that is not possible
 * at all, and a workspace with no practices simply reads a column of blanks.
 * It is the clinic's own label, never a patient — see the PHI note above.
 */
export const EXPORT_COLUMNS = [
  'Practice',
  'Claim number',
  'Payer',
  'Status',
  'Billed',
  'Denial date',
  'Days left',
  'Filing window (days)',
  'Deadline source',
  'Expired',
  'Priority',
  'Score',
  'CARC',
  'Denial reason',
  'Remittance text',
  'CPT',
  'ICD-10',
  'Remedy',
  'Actionable',
  'Suggested next step',
  'RARC',
  'Likely cause',
  'Recommended action',
  'Payer status',
  'Expected by',
  'Follow-up date',
  'Last touched',
  'Last change',
  'Note',
] as const

export type ExportColumn = (typeof EXPORT_COLUMNS)[number]

/**
 * One row of the file.
 *
 * Values are primitives only. A Date or an object reaching SheetJS gets
 * serialised by rules that differ between the CSV and XLSX writers, which is how
 * one format ends up with `[object Object]` in a cell that the other renders
 * fine — and nobody opens both.
 */
export type ExportRecord = Record<ExportColumn, string | number | null>

/**
 * A date as the spreadsheet should carry it.
 *
 * `yyyy-MM-dd` through date-fns, which formats in the server's own zone.
 * `toISOString().slice(0, 10)` would have been shorter and wrong: it converts to
 * UTC first, so a row touched at 7pm Pacific reports the following day.
 *
 * Date only, never a time. Nothing in the queue is decided at an hour's
 * resolution, and a timestamp in a cell is one more thing Excel reformats.
 */
function day(d: Date | string | null | undefined): string | null {
  if (!d) return null
  const date = d instanceof Date ? d : new Date(d)
  return Number.isNaN(date.getTime()) ? null : format(date, 'yyyy-MM-dd')
}

/** Yes/No rather than TRUE/FALSE: the reader is a person, and Excel agrees. */
function yesNo(value: boolean): string {
  return value ? 'Yes' : 'No'
}

/**
 * A row, flattened.
 *
 * Money and the score stay numbers so a column of them can be summed and sorted
 * in the sheet. Everything else that is not a date is text.
 */
export function exportRow(row: BuiltWorklistRow): ExportRecord {
  return {
    Practice: row.practiceName ?? null,
    'Claim number': row.claimNumber ?? null,
    Payer: row.payer ?? null,
    Status: statusLabel(row.status),
    Billed: row.billed,
    'Denial date': day(row.denialDate),
    'Days left': row.daysLeft,
    'Filing window (days)': row.windowDays,
    // Whether the deadline beside it is this payer's published rule or the
    // fallback. Someone about to act on "Days left" is entitled to know which.
    'Deadline source': row.windowSource === 'payer' ? 'Payer rule' : 'Default',
    Expired: yesNo(row.expired),
    Priority: BAND_LABEL[row.band as PriorityBand] ?? row.band,
    Score: row.score,
    CARC: row.carc,
    'Denial reason': row.carcLabel,
    'Remittance text': row.reason ?? null,
    CPT: row.cpt ?? null,
    'ICD-10': row.icd10 ?? null,
    Remedy: row.remedyLabel,
    Actionable: yesNo(row.actionable),
    // triageRow's `note`, which is the guidance for this CARC — not the
    // biller's own note. The two are separate fields on the row for exactly
    // this reason, and collapsing them here would put boilerplate in the column
    // someone scans for what their colleague said.
    'Suggested next step': row.note,
    RARC: row.refinement?.rarc ?? null,
    'Likely cause': row.refinement?.cause ?? null,
    'Recommended action': row.refinement?.action ?? null,
    'Payer status': row.call.label,
    'Expected by': day(row.call.expectedBy),
    'Follow-up date': day(row.followUpAt),
    'Last touched': day(row.lastTouchedAt),
    'Last change': day(row.changedAt),
    Note: row.userNote,
  }
}

/**
 * What the file says when it does not hold everything.
 *
 * lib/insights/facts.ts sets the precedent and the reason: an under-report has
 * to be loud. A silently short export is the worst artefact this product could
 * produce — someone reconciles against it, finds the totals agree with nothing,
 * and has no way to tell that rows were dropped.
 */
export const TRUNCATION_NOTICE = '— truncated at 50,000 rows —'

/** The notice as a final row, so it survives into CSV as well as XLSX. */
export function truncationRow(): ExportRecord {
  const row = Object.fromEntries(EXPORT_COLUMNS.map(c => [c, null])) as ExportRecord
  row['Claim number'] = TRUNCATION_NOTICE
  return row
}

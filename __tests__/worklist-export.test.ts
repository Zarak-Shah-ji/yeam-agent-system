import { describe, it, expect } from 'vitest'
import {
  EXPORT_COLUMNS,
  TRUNCATION_NOTICE,
  exportRow,
  truncationRow,
} from '@/lib/denials/export'
import {
  buildWorklistRow,
  type PersistedDenialRow,
} from '@/lib/denials/worklist-row'

/**
 * The export is the one artefact that leaves the product.
 *
 * Everything else a customer sees is behind their own session. A spreadsheet
 * gets emailed to a contractor, dropped in a shared drive and opened on a
 * machine nobody here controls, so the no-PHI promise has to hold at this seam
 * specifically — and hold by construction, not by the current schema happening
 * to be clean.
 */

const ROW: PersistedDenialRow = {
  id: 'row_1',
  status: 'SENT',
  note: 'Called Aetna, they want the op note',
  claimNumber: 'AET-2026-90114',
  payer: 'Aetna',
  carc: 'CO-50',
  billed: 1240.5,
  denialDate: new Date(2026, 7, 1),
  cpt: '99213',
  icd10: 'M54.5',
  reason: 'Not medically necessary',
  lastTouchedAt: new Date(2026, 8, 1),
  reconciledAt: null,
  practiceId: null,
  followUpAt: new Date(2026, 9, 1),
}

const TODAY = new Date(2026, 8, 15)

const build = (over: Partial<PersistedDenialRow> = {}) =>
  buildWorklistRow({ ...ROW, ...over }, {
    today: TODAY,
    payerMedianDaysToPay: 30,
    draftCount: 0,
  })

describe('EXPORT_COLUMNS carries no patient identifier', () => {
  /*
    The same regex as __tests__/no-phi-columns.test.ts, against the headers
    rather than against the schema. That test proves there is no PHI column to
    read; this one proves nobody has added a header that would invite one — a
    "Patient name" column with a TODO under it is how the first leak would look.

    Never widen this. Patient identifiers belong in the browser, in
    lib/appeals/merge.ts, and nowhere a server can serialise them.
  */
  const FORBIDDEN_FIELD =
    /^(patient\w*|member(Id|Name|Number)|subscriber\w*|dob|dateOfBirth|birthDate|ssn|mrn|guarantor\w*|firstName|lastName|patientName)$/i

  /** "Patient name" and "Date of birth" have to be tested as one word each. */
  const asField = (label: string) => label.replace(/[^A-Za-z0-9]/g, '')

  it('rejects every forbidden field name', () => {
    const offenders = EXPORT_COLUMNS.filter(label => FORBIDDEN_FIELD.test(asField(label)))
    expect(offenders).toEqual([])
  })

  it('the regex still matches what it is supposed to catch', () => {
    // A guard that matches nothing passes forever. These are the labels that
    // would appear if someone added the column this test exists to prevent.
    for (const label of ['Patient name', 'Patient', 'Date of birth', 'DOB', 'MRN', 'Member ID']) {
      expect(FORBIDDEN_FIELD.test(asField(label)), label).toBe(true)
    }
  })
})

describe('exportRow', () => {
  it('emits exactly the columns the header declares, in that order', () => {
    // json_to_sheet is handed EXPORT_COLUMNS as its header list. A key here
    // that is not in that list is a value silently dropped from the file; a
    // column there with no key is a blank column nobody notices until a
    // customer asks why.
    expect(Object.keys(exportRow(build()))).toEqual([...EXPORT_COLUMNS])
  })

  it('emits primitives only', () => {
    // A Date or an object reaching SheetJS serialises differently between the
    // CSV and XLSX writers, and nobody opens both.
    for (const [column, value] of Object.entries(exportRow(build()))) {
      const ok = value === null || typeof value === 'string' || typeof value === 'number'
      expect(ok, `${column} is ${typeof value}`).toBe(true)
    }
  })

  it('reports dates in the local zone, not UTC', () => {
    // toISOString().slice(0, 10) would report the 2nd for a row touched on the
    // evening of the 1st anywhere west of Greenwich.
    const row = exportRow(build({ denialDate: new Date(2026, 7, 1, 19, 30) }))
    expect(row['Denial date']).toBe('2026-08-01')
  })

  it('leaves a missing date blank rather than inventing one', () => {
    const row = exportRow(build({ denialDate: null, followUpAt: null, lastTouchedAt: null }))
    expect(row['Denial date']).toBeNull()
    expect(row['Follow-up date']).toBeNull()
    expect(row['Last touched']).toBeNull()
  })

  it('keeps money and the score as numbers so the sheet can add them up', () => {
    const row = exportRow(build())
    expect(row.Billed).toBe(1240.5)
    expect(typeof row.Score).toBe('number')
  })

  it('carries the labels the table shows, not the enum values', () => {
    const row = exportRow(build({ status: 'DEAD' }))
    expect(row.Status).toBe('Written off')
    expect(row.Priority).not.toMatch(/^(now|soon|later|parked)$/)
  })

  it('does not put the CARC guidance in the biller note column', () => {
    // `note` on the built row is remedy guidance; `userNote` is what the biller
    // typed. They are separate fields for this reason.
    const row = exportRow(build())
    expect(row.Note).toBe('Called Aetna, they want the op note')
    expect(row['Suggested next step']).not.toBe(row.Note)
  })

  it('agrees with the builder about the derived values', () => {
    // The whole reason exportRow takes a BuiltWorklistRow. A file whose
    // deadlines are a day out from the screen is worse than no file.
    const built = build()
    const row = exportRow(built)
    expect(row['Days left']).toBe(built.daysLeft)
    expect(row['Filing window (days)']).toBe(built.windowDays)
    expect(row.Score).toBe(built.score)
  })
})

describe('truncationRow', () => {
  it('says so loudly, in the first column, with every other cell blank', () => {
    const row = truncationRow()
    expect(Object.keys(row)).toEqual([...EXPORT_COLUMNS])
    expect(row['Claim number']).toBe(TRUNCATION_NOTICE)
    const rest = EXPORT_COLUMNS.filter(c => c !== 'Claim number').map(c => row[c])
    expect(rest.every(v => v === null)).toBe(true)
  })
})

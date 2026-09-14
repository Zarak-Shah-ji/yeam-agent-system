import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { isIgnorableColumn } from '@/lib/imports/deidentify'
import { readClaimsTable } from '@/lib/imports/table'
import { reportColumns, detectMapping, applyOverrides } from '@/lib/imports/mapping'
import {
  buildClaimRows,
  detectClaimMapping,
  detectProfile,
  deriveStatus,
  missingRequiredClaims,
  normalizeStatus,
  CLAIM_FIELD_IDS,
  CLAIM_HEADER_PATTERNS,
} from '@/lib/imports/claims-profile'
import { parseImport } from '@/lib/imports/service'

const AR_HEADER = [
  'Claim Number', 'Patient Name', 'Member ID', 'DOB', 'Payer', 'DOS', 'Date Submitted',
  'Paid Date', 'CPT', 'ICD-10', 'Billed Amount', 'Allowed Amount', 'Paid Amount',
  'Patient Responsibility', 'Adjustment', 'Claim Status', 'CARC',
]

function sampleFile(name: string): Buffer {
  return readFileSync(path.join(process.cwd(), 'samples', name))
}

describe('normalizeStatus', () => {
  it('reads the statuses billing systems actually emit', () => {
    expect(normalizeStatus('Paid')).toBe('PAID')
    expect(normalizeStatus('PD')).toBe('PAID')
    expect(normalizeStatus('Denied')).toBe('DENIED')
    expect(normalizeStatus('DN')).toBe('DENIED')
    expect(normalizeStatus('Pending')).toBe('PENDING')
    expect(normalizeStatus('In Process')).toBe('PENDING')
    expect(normalizeStatus('Rejected')).toBe('REJECTED')
    expect(normalizeStatus('Written Off')).toBe('WRITTEN_OFF')
  })

  it('does not let a more specific status be swallowed by a looser one', () => {
    // "Partially Paid" contains "paid"; "Denied - appeal pending" contains "pending".
    expect(normalizeStatus('Partially Paid')).toBe('PARTIAL')
    expect(normalizeStatus('Underpaid')).toBe('PARTIAL')
    expect(normalizeStatus('Denied - appeal pending')).toBe('DENIED')
  })

  it('falls back to UNKNOWN rather than guessing', () => {
    // A guess here either invents a denial or overstates collections.
    expect(normalizeStatus('Zorp')).toBe('UNKNOWN')
    expect(normalizeStatus('')).toBe('UNKNOWN')
    expect(normalizeStatus(undefined)).toBe('UNKNOWN')
  })
})

describe('deriveStatus', () => {
  it('infers from the money when the export has no status column', () => {
    expect(deriveStatus({ billed: 100, paid: 100 })).toBe('PAID')
    expect(deriveStatus({ billed: 100, paid: 40 })).toBe('PARTIAL')
    expect(deriveStatus({ billed: 100, paid: 0, carc: 'CO-97' })).toBe('DENIED')
    expect(deriveStatus({ billed: 100, paid: 0 })).toBe('PENDING')
  })

  it('treats a payment at or over the billed amount as paid in full', () => {
    expect(deriveStatus({ billed: 100, paid: 120 })).toBe('PAID')
    expect(deriveStatus({ billed: 100, paid: 99.999 })).toBe('PAID')
  })
})

describe('claims column mapping', () => {
  it('maps a real A/R export header', () => {
    const m = detectClaimMapping(AR_HEADER)
    expect(m.claimNumber).toBe(0)
    expect(m.payer).toBe(4)
    expect(m.serviceDate).toBe(5)
    expect(m.submittedDate).toBe(6)
    expect(m.remitDate).toBe(7)
    expect(m.cpt).toBe(8)
    expect(m.icd10).toBe(9)
    expect(m.billed).toBe(10)
    expect(m.allowed).toBe(11)
    expect(m.paid).toBe(12)
    expect(m.patientResp).toBe(13)
    expect(m.adjustment).toBe(14)
    expect(m.status).toBe(15)
    expect(m.carc).toBe(16)
    expect(missingRequiredClaims(m)).toEqual([])
  })

  it('never maps an identifier column', () => {
    const m = detectClaimMapping(AR_HEADER)
    const phi = [1, 2, 3] // Patient Name, Member ID, DOB
    for (const index of Object.values(m)) {
      expect(phi).not.toContain(index)
    }
  })

  it('gives a header to at most one field', () => {
    // Without exclusivity "Paid Date" maps to both remitDate and paid, and the
    // money column silently becomes a date.
    const m = detectClaimMapping(AR_HEADER)
    const used = Object.values(m)
    expect(new Set(used).size).toBe(used.length)
    expect(m.remitDate).not.toBe(m.paid)
  })

  it('requires an amount and at least one date', () => {
    expect(missingRequiredClaims({})).toEqual([
      'Billed amount',
      'a date column (service, submitted or remit)',
    ])
    expect(missingRequiredClaims({ billed: 0, serviceDate: 1 })).toEqual([])
    expect(missingRequiredClaims({ billed: 0, remitDate: 2 })).toEqual([])
    expect(missingRequiredClaims({ billed: 0 })).toEqual([
      'a date column (service, submitted or remit)',
    ])
  })

  it('counts a row with neither an amount nor a date as skipped', () => {
    const m = detectClaimMapping(AR_HEADER)
    const blank = new Array(AR_HEADER.length).fill('')
    blank[4] = 'Aetna'
    const { rows, skipped } = buildClaimRows([blank], m)
    expect(rows).toHaveLength(0)
    expect(skipped).toBe(1)
  })

  it('derives status only when there is no status column', () => {
    const headers = AR_HEADER.filter(h => h !== 'Claim Status')
    const m = detectClaimMapping(headers)
    expect(m.status).toBeUndefined()
    const row = new Array(headers.length).fill('')
    row[headers.indexOf('Billed Amount')] = '200.00'
    row[headers.indexOf('Paid Amount')] = '80.00'
    row[headers.indexOf('DOS')] = '05/01/2026'
    const built = buildClaimRows([row], m)
    expect(built.statusDerived).toBe(true)
    expect(built.rows[0].status).toBe('PARTIAL')
  })
})

describe('de-identification on the claims profile', () => {
  it('refuses identifier columns and names them back', () => {
    const m = detectClaimMapping(AR_HEADER)
    const { refused } = reportColumns(AR_HEADER, m)
    expect(refused).toContain('Patient Name')
    expect(refused).toContain('Member ID')
    expect(refused).toContain('DOB')
  })

  it('admits patient-money columns, which are amounts and not identifiers', () => {
    for (const ok of ['Patient Responsibility', 'Patient Balance', 'Pt Portion', 'Patient Resp']) {
      expect(isIgnorableColumn(ok)).toBe(false)
    }
    // The anchor is what keeps the exception safe.
    for (const no of ['Patient Name', 'Patient DOB', 'Patient Member ID', 'Patient Address']) {
      expect(isIgnorableColumn(no)).toBe(true)
    }
  })

  it('carries no identifier into the built rows', async () => {
    const buffer = sampleFile('sample-ar-export.csv')
    const { headers, dataRows } = await readClaimsTable(buffer, 'sample-ar-export.csv')
    const built = buildClaimRows(dataRows, detectClaimMapping(headers))
    const serialized = JSON.stringify(built.rows)

    // Every name, member ID and DOB in the fixture, taken from the raw file.
    const nameCol = headers.indexOf('Patient Name')
    const memberCol = headers.indexOf('Member ID')
    const dobCol = headers.indexOf('DOB')
    for (const row of dataRows) {
      expect(serialized).not.toContain(row[nameCol])
      expect(serialized).not.toContain(row[memberCol])
    }
    expect(serialized).not.toContain(dataRows[0][dobCol])
  })

  it('refuses a mapping override that points a field at an identifier column', () => {
    // The de-identification promise is not the customer's to waive via a dropdown.
    const detected = detectClaimMapping(AR_HEADER)
    const { mapping, refusedOverrides } = applyOverrides(
      detected,
      { payer: 1 }, // Patient Name
      AR_HEADER,
      CLAIM_FIELD_IDS,
    )
    expect(mapping.payer).toBe(4)
    expect(refusedOverrides).toEqual(['Patient Name'])
  })

  it('honours an override onto a legitimate column', () => {
    const detected = detectClaimMapping(AR_HEADER)
    const { mapping, refusedOverrides } = applyOverrides(
      detected,
      { serviceDate: 6 }, // Date Submitted instead of DOS
      AR_HEADER,
      CLAIM_FIELD_IDS,
    )
    expect(mapping.serviceDate).toBe(6)
    expect(refusedOverrides).toEqual([])
  })
})

describe('detectProfile', () => {
  it('reads an A/R export as claims', () => {
    expect(detectProfile(AR_HEADER)).toMatchObject({ profile: 'claims', confident: true })
  })

  it('names the columns that decided it', () => {
    // The banner in the upload UI quotes these back. "This could be read either
    // way" gives a customer nothing to check; "it has Allowed Amount and Paid
    // Amount" tells them exactly where to look.
    expect(detectProfile(AR_HEADER).evidence).toEqual(
      expect.arrayContaining(['Paid Amount', 'Allowed Amount']),
    )
    expect(detectProfile(AR_HEADER).evidence).not.toContain('Paid Date')
  })

  it('reads a denials export as denials', () => {
    const denialHeader = ['Claim Number', 'Payer', 'Remit Date', 'CPT', 'CARC', 'Billed']
    expect(detectProfile(denialHeader)).toMatchObject({
      profile: 'denials',
      confident: true,
      evidence: ['CARC'],
    })
  })

  it('does not read a denials export with a status column as claims', () => {
    // The shipped denials workbook has a Status column reading DENIED on every
    // row. Keying off status alone would import it as a snapshot and report a
    // 100% denial rate against a denominator of only the denied claims.
    const header = ['Claim Number', 'DOS', 'CPT', 'Billed', 'Status', 'CARC', 'Denial Reason']
    expect(detectProfile(header)).toMatchObject({ profile: 'denials', confident: true })
  })

  it('does not read a "Paid Date" column as settlement money', () => {
    const header = ['Claim Number', 'Payer', 'Paid Date', 'Billed', 'CARC']
    expect(detectProfile(header).profile).toBe('denials')
  })

  it('does not let a patient-name column vote', () => {
    // "Patient Status" would otherwise read as a claim status column.
    expect(detectProfile(['Patient Name', 'CARC', 'Billed']).profile).toBe('denials')
  })
})

describe('a confident detection overrules the box the file was dropped on', () => {
  // The failure this exists to prevent: an A/R export dropped on the Connect
  // page's "Denials export" box imported as denial rows, and the Claims page
  // then truthfully but uselessly reported that no claims had been imported.
  it('reads an A/R export as claims even when denials was asked for', async () => {
    const parsed = await parseImport({
      buffer: sampleFile('sample-ar-export.csv'),
      filename: 'sample-ar-export.csv',
      profile: 'denials',
    })

    expect(parsed.kind).toBe('claims')
    expect(parsed.preview.profile).toBe('claims')
    expect(parsed.preview.profileSource).toBe('corrected')
    expect(parsed.preview.requestedProfile).toBe('denials')
    expect(parsed.preview.detectionEvidence.length).toBeGreaterThan(0)
    expect(parsed.rows).toHaveLength(1200)
  })

  it('honours the asked-for profile once the customer has confirmed it', async () => {
    // Otherwise the "Read as" control would be inert on exactly the files it
    // exists for — detection would re-correct the choice on every reparse.
    const parsed = await parseImport({
      buffer: sampleFile('sample-ar-export.csv'),
      filename: 'sample-ar-export.csv',
      profile: 'denials',
      confirmProfile: true,
    })

    expect(parsed.kind).toBe('denials')
    expect(parsed.preview.profileSource).toBe('chosen')
    expect(parsed.preview.detectedProfile).toBe('claims')
  })

  it('leaves a genuinely ambiguous file on the profile that was asked for', async () => {
    // Detection is not confident here, so it has no standing to overrule anyone.
    const csv = Buffer.from('Claim Number,Payer,DOS,Billed,Status\nA1,Aetna,01/05/2026,100.00,Denied\n')
    const parsed = await parseImport({ buffer: csv, filename: 'ambiguous.csv', profile: 'denials' })

    expect(parsed.preview.profileSource).toBe('chosen')
    expect(parsed.preview.detectionConfident).toBe(false)
    expect(parsed.preview.profileConfident).toBe(false)
  })

  it('counts the denied claims an A/R export could put on the worklist', async () => {
    const parsed = await parseImport({
      buffer: sampleFile('sample-ar-export.csv'),
      filename: 'sample-ar-export.csv',
    })

    if (parsed.kind !== 'claims') throw new Error('expected claims')
    const denied = parsed.rows.filter(r => r.status === 'DENIED' && r.carc)
    expect(parsed.preview.deniedWithCarc).toBe(denied.length)
    expect(parsed.preview.deniedWithCarc).toBeGreaterThan(0)
  })
})

describe('end to end on the shipped sample files', () => {
  it('parses the A/R export into a usable snapshot', async () => {
    const parsed = await parseImport({
      buffer: sampleFile('sample-ar-export.csv'),
      filename: 'sample-ar-export.csv',
    })

    expect(parsed.kind).toBe('claims')
    expect(parsed.preview.profile).toBe('claims')
    expect(parsed.preview.missing).toEqual([])
    expect(parsed.rows).toHaveLength(1200)
    expect(parsed.skipped).toBe(0)
    if (parsed.kind !== 'claims') throw new Error('expected claims')
    expect(parsed.statusDerived).toBe(false)

    const billed = parsed.rows.reduce((sum, r) => sum + r.billed, 0)
    const paid = parsed.rows.reduce((sum, r) => sum + (r.paid ?? 0), 0)
    expect(billed).toBeCloseTo(339755.19, 2)
    expect(paid).toBeCloseTo(80178.52, 2)

    const statuses = parsed.rows.reduce<Record<string, number>>((acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1
      return acc
    }, {})
    expect(statuses).toEqual({
      PAID: 635,
      PARTIAL: 177,
      PENDING: 204,
      DENIED: 101,
      WRITTEN_OFF: 48,
      REJECTED: 35,
    })
    expect(statuses.UNKNOWN).toBeUndefined()
  })

  /**
   * The totals above pin one generated file. These pin the shape, and are what
   * actually fail if samples/generate-ar-export.mjs starts emitting nonsense:
   * a row whose money does not add up is invisible in a sum.
   */
  it('holds the money identities on every row', async () => {
    const parsed = await parseImport({
      buffer: sampleFile('sample-ar-export.csv'),
      filename: 'sample-ar-export.csv',
    })
    if (parsed.kind !== 'claims') throw new Error('expected claims')

    for (const row of parsed.rows) {
      const allowed = row.allowed ?? 0
      // What the payer allowed is split between the payer and the patient.
      expect(row.paid ?? 0).toBeCloseTo(allowed - (row.patientResp ?? 0), 2)
      // And the rest of the charge was adjusted away.
      if (allowed > 0) expect(allowed + (row.adjustment ?? 0)).toBeCloseTo(row.billed, 2)
      expect(row.billed).toBeGreaterThan(0)
      // A settled claim carries a settlement date; an open one must not.
      expect(row.remitDate === null).toBe(row.status === 'PENDING' || row.status === 'REJECTED')
    }
  })

  it('shows the parsed date back so a misread column is visible', async () => {
    const parsed = await parseImport({
      buffer: sampleFile('sample-ar-export.csv'),
      filename: 'sample-ar-export.csv',
    })
    const dos = parsed.preview.fields.find(f => f.id === 'serviceDate')
    expect(dos?.headerName).toBe('DOS')
    expect(dos?.sampleParsed).toMatch(/^\d{4}-\d{2}-\d{2}$/)

    const billed = parsed.preview.fields.find(f => f.id === 'billed')
    expect(billed?.headerName).toBe('Billed Amount')
    expect(billed?.sampleParsed).toBe('632.52')
  })

  it('keeps identifier columns out of the remappable list', async () => {
    const parsed = await parseImport({
      buffer: sampleFile('sample-ar-export.csv'),
      filename: 'sample-ar-export.csv',
    })
    const names = parsed.preview.selectableHeaders.map(h => h.name)
    expect(names).not.toContain('Patient Name')
    expect(names).not.toContain('Member ID')
    expect(names).toContain('Payer')
    expect(parsed.preview.refusedColumns).toContain('Patient Name')
  })

  it('still reads the denials workbook as denials', async () => {
    const parsed = await parseImport({
      buffer: sampleFile('sample-denied-claims.xlsx'),
      filename: 'sample-denied-claims.xlsx',
    })
    expect(parsed.kind).toBe('denials')
    expect(parsed.rows).toHaveLength(4)
    expect(parsed.skipped).toBe(0)
  })

  it('reports missing columns rather than throwing, so the preview can offer a fix', async () => {
    const csv = Buffer.from('Widget,Colour\nfoo,red\nbar,blue\n')
    const parsed = await parseImport({ buffer: csv, filename: 'nonsense.csv', profile: 'claims' })
    expect(parsed.preview.missing.length).toBeGreaterThan(0)
    expect(parsed.rows).toHaveLength(0)
  })
})

describe('shared mapping engine', () => {
  it('is the same engine both profiles use', () => {
    const m = detectMapping(AR_HEADER, CLAIM_HEADER_PATTERNS)
    expect(m).toEqual(detectClaimMapping(AR_HEADER))
  })
})

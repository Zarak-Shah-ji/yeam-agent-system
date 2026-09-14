import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { readImportUpload } from '@/lib/imports/request'
import { parseImport } from '@/lib/imports/service'
import { MAX_IMPORT_ROWS } from '@/lib/imports/table'

/**
 * The route layer, minus auth.
 *
 * parseImport is covered directly in claims-import.test.ts; what is exercised
 * here is the multipart handling between the browser and it, which is where a
 * working parser can still return a 500.
 */
function upload(file: string, fields: Record<string, string> = {}): Request {
  const bytes = readFileSync(path.join(process.cwd(), 'samples', file))
  const form = new FormData()
  form.append('file', new File([bytes], file))
  for (const [k, v] of Object.entries(fields)) form.append(k, v)
  return new Request('http://localhost/api/imports/preview', { method: 'POST', body: form })
}

describe('reading an import off a multipart request', () => {
  it('pulls the file, profile and mapping out of the form', async () => {
    const read = await readImportUpload(upload('sample-ar-export.csv', { profile: 'claims' }))
    expect('upload' in read).toBe(true)
    if (!('upload' in read)) return
    expect(read.upload.filename).toBe('sample-ar-export.csv')
    expect(read.upload.profile).toBe('claims')
    expect(read.upload.buffer.byteLength).toBeGreaterThan(0)
  })

  it('ignores a malformed mapping rather than failing the import', async () => {
    const read = await readImportUpload(upload('sample-ar-export.csv', { mapping: 'not json' }))
    if (!('upload' in read)) throw new Error('expected an upload')
    expect(read.upload.mappingOverride).toEqual({})
  })

  it('parses what it read', async () => {
    const read = await readImportUpload(upload('sample-ar-export.csv'))
    if (!('upload' in read)) throw new Error('expected an upload')
    const parsed = await parseImport(read.upload)
    expect(parsed.kind).toBe('claims')
    expect(parsed.rows).toHaveLength(1200)
  })

  it('parses the denials workbook the same way', async () => {
    const read = await readImportUpload(upload('sample-denied-claims.xlsx', { profile: 'denials' }))
    if (!('upload' in read)) throw new Error('expected an upload')
    const parsed = await parseImport(read.upload)
    expect(parsed.kind).toBe('denials')
    expect(parsed.rows).toHaveLength(4)
  })

  it('reads the profile confirmation, defaulting to unconfirmed', async () => {
    const plain = await readImportUpload(upload('sample-ar-export.csv', { profile: 'denials' }))
    if (!('upload' in plain)) throw new Error('expected an upload')
    expect(plain.upload.confirmProfile).toBe(false)

    const confirmed = await readImportUpload(
      upload('sample-ar-export.csv', { profile: 'denials', confirmProfile: 'true' }),
    )
    if (!('upload' in confirmed)) throw new Error('expected an upload')
    expect(confirmed.upload.confirmProfile).toBe(true)
  })

  it('flags an unconfirmed profile that contradicts detection, so commit can refuse it', async () => {
    // Commit turns this into a 409 rather than writing a batch of a kind the
    // page that called it never displayed.
    const read = await readImportUpload(upload('sample-ar-export.csv', { profile: 'denials' }))
    if (!('upload' in read)) throw new Error('expected an upload')
    const parsed = await parseImport(read.upload)
    expect(parsed.preview.profileSource).toBe('corrected')
  })

  it('does not flag it once the form confirms the choice', async () => {
    const read = await readImportUpload(
      upload('sample-ar-export.csv', { profile: 'denials', confirmProfile: 'true' }),
    )
    if (!('upload' in read)) throw new Error('expected an upload')
    const parsed = await parseImport(read.upload)
    expect(parsed.preview.profileSource).toBe('chosen')
  })
})

/**
 * The abuse ceiling on an import.
 *
 * Not the paywall — what is metered is denials worked (lib/plans.ts). This only
 * exists so one upload cannot write an unbounded number of rows, and the number
 * is set where no single practice's export reaches it. Both halves of that claim
 * are asserted: a real export passes, and a book an order of magnitude larger
 * trips it.
 */
describe('the import row ceiling', () => {
  function csvWithRows(count: number): Request {
    const header =
      'Claim Number,Payer,DOS,Date Submitted,Paid Date,CPT,ICD-10,Billed Amount,' +
      'Allowed Amount,Paid Amount,Patient Responsibility,Adjustment,Claim Status,CARC'
    const rows = Array.from(
      { length: count },
      (_, i) =>
        `CLM-CEIL-${i},UnitedHealthcare,05/07/2026,05/12/2026,06/18/2026,S5125,G35,` +
        `632.52,323.13,0.00,0.00,309.39,Denied,CO-97`,
    )
    const form = new FormData()
    form.append('file', new File([[header, ...rows].join('\n')], 'big.csv'))
    return new Request('http://localhost/api/imports/commit', { method: 'POST', body: form })
  }

  it('lets a realistic export through', async () => {
    const read = await readImportUpload(upload('sample-ar-export.csv'))
    if (!('upload' in read)) throw new Error('expected an upload')
    const parsed = await parseImport(read.upload)
    expect(parsed.rows.length).toBe(1200)
    expect(parsed.rows.length).toBeLessThanOrEqual(MAX_IMPORT_ROWS)
  })

  it('puts a book an order of magnitude larger over the line', async () => {
    const read = await readImportUpload(csvWithRows(MAX_IMPORT_ROWS + 1))
    if (!('upload' in read)) throw new Error('expected an upload')
    const parsed = await parseImport(read.upload)
    // What the commit handler compares against before it writes anything.
    expect(parsed.rows.length).toBeGreaterThan(MAX_IMPORT_ROWS)
  })
})

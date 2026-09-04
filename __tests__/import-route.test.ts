import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { readImportUpload } from '@/lib/imports/request'
import { parseImport } from '@/lib/imports/service'

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
})

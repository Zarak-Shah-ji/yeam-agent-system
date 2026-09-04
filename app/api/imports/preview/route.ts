import { NextResponse } from 'next/server'
import { requireOrg } from '@/lib/org'
import { readImportUpload } from '@/lib/imports/request'
import { ClaimsFileError, parseImport } from '@/lib/imports/service'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * Read an export and describe it. Persists nothing.
 *
 * The customer sees which column became which field and what the first value
 * parsed to, before anything is saved. That matters most for dates: US ordering
 * is assumed for slash dates, so a DD/MM export reads 03/04 as March 4th, and
 * every filing deadline and aging bucket downstream is then quietly wrong. The
 * fix is a dropdown, but only if the mistake is visible first.
 *
 * Missing required columns are reported in the body, not as an error status —
 * the preview's job is to show the problem next to the dropdowns that fix it.
 */
export async function POST(request: Request) {
  const org = await requireOrg()
  if (!org) {
    return NextResponse.json({ error: 'Sign in to import a file.' }, { status: 401 })
  }

  const read = await readImportUpload(request)
  if ('error' in read) return read.error

  try {
    const parsed = await parseImport(read.upload)
    return NextResponse.json(parsed.preview)
  } catch (err) {
    if (err instanceof ClaimsFileError) {
      return NextResponse.json({ error: err.message }, { status: 422 })
    }
    console.error('import preview failed', err)
    return NextResponse.json({ error: 'Could not read that file.' }, { status: 500 })
  }
}

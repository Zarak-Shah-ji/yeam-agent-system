/**
 * Reading an import upload off a multipart request.
 *
 * Shared by the preview and commit routes so they agree on what the form looks
 * like. Returns a NextResponse on failure rather than throwing, because every
 * failure here is a 400 the customer can fix.
 */

import { NextResponse } from 'next/server'
import type { ImportProfile } from './claims-profile'

export type ImportUpload = {
  buffer: Buffer
  filename: string
  profile?: ImportProfile
  mappingOverride: Record<string, number>
  /**
   * The customer has seen what detection concluded and still wants the profile
   * they asked for. Commit refuses an unconfirmed profile that contradicts a
   * confident detection, so a stale page cannot save something the preview it
   * came from never showed.
   */
  confirmProfile: boolean
  /**
   * Which clinic this file is for, when the customer chose one.
   *
   * Carried as a plain string and NOT trusted here — the commit route checks it
   * belongs to the caller's workspace before writing it, and falls back to the
   * workspace default when it is absent or wrong. Reading it in this shared
   * parser rather than in the route keeps preview and commit sending the same
   * form.
   */
  practiceId?: string
}

export async function readImportUpload(
  request: Request,
): Promise<{ upload: ImportUpload } | { error: NextResponse }> {
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return { error: NextResponse.json({ error: 'Could not read the upload.' }, { status: 400 }) }
  }

  const file = form.get('file')
  if (!(file instanceof File)) {
    return { error: NextResponse.json({ error: 'Attach a .csv or .xlsx export.' }, { status: 400 }) }
  }

  const rawProfile = form.get('profile')
  const profile =
    rawProfile === 'denials' || rawProfile === 'claims' ? (rawProfile as ImportProfile) : undefined

  // Absent, empty or malformed means "use what detection found" — a broken
  // override should never be the reason an import fails.
  let mappingOverride: Record<string, number> = {}
  const rawMapping = form.get('mapping')
  if (typeof rawMapping === 'string' && rawMapping.trim()) {
    try {
      const parsed = JSON.parse(rawMapping) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
          if (typeof value === 'number' && Number.isInteger(value)) mappingOverride[key] = value
          else if (value === null || value === -1) mappingOverride[key] = -1
        }
      }
    } catch {
      mappingOverride = {}
    }
  }

  const rawPractice = form.get('practiceId')

  return {
    upload: {
      buffer: Buffer.from(await file.arrayBuffer()),
      filename: file.name,
      profile,
      mappingOverride,
      confirmProfile: form.get('confirmProfile') === 'true',
      practiceId: typeof rawPractice === 'string' && rawPractice.trim() ? rawPractice : undefined,
    },
  }
}

import { NextResponse } from 'next/server'
import { hasAppealsAccess } from '@/lib/appeals/access'
import {
  MAX_FILES,
  MAX_TOTAL_BYTES,
  UnsupportedFileError,
  fileToSourcePart,
} from '@/lib/appeals/parse-upload'
import { draftAppealFromDocument, type SourcePart } from '@/lib/billing/draft-appeal-from-document'
import { prisma } from '@/lib/db'

export const runtime = 'nodejs'
/** Drafting a letter takes well over the default budget on a cold start. */
export const maxDuration = 60

const RATE_LIMIT = 10
const RATE_WINDOW_MS = 60 * 60 * 1000
const hits = new Map<string, number[]>()

/**
 * Coarse per-IP throttle. In-memory means it resets on redeploy and is per
 * lambda instance, which is fine — it exists to stop a shared link burning API
 * credits, not to be an exact quota.
 *
 * Checking and recording are separate so that a rejected upload (wrong format,
 * too large) doesn't consume quota — only requests that reach the model count.
 */
function recentHits(ip: string): number[] {
  const now = Date.now()
  return (hits.get(ip) ?? []).filter(t => now - t < RATE_WINDOW_MS)
}

function rateLimited(ip: string): boolean {
  const recent = recentHits(ip)
  hits.set(ip, recent)
  return recent.length >= RATE_LIMIT
}

function recordHit(ip: string): void {
  hits.set(ip, [...recentHits(ip), Date.now()])

  // Drop callers whose window has fully expired so the map can't grow forever.
  if (hits.size > 500) {
    for (const key of [...hits.keys()]) {
      if (recentHits(key).length === 0) hits.delete(key)
    }
  }
}

export async function POST(req: Request) {
  if (!(await hasAppealsAccess())) {
    return NextResponse.json({ error: 'Enter the access code to draft an appeal.' }, { status: 401 })
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (rateLimited(ip)) {
    return NextResponse.json(
      { error: `Rate limit reached (${RATE_LIMIT} letters per hour). Try again shortly.` },
      { status: 429 },
    )
  }

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Could not read the upload.' }, { status: 400 })
  }

  const notes = (form.get('notes') as string | null)?.trim() || ''
  const files = form.getAll('files').filter((f): f is File => f instanceof File && f.size > 0)

  if (files.length === 0 && !notes) {
    return NextResponse.json(
      { error: 'Attach a file or paste the denial details before generating.' },
      { status: 400 },
    )
  }
  if (files.length > MAX_FILES) {
    return NextResponse.json({ error: `Attach at most ${MAX_FILES} files.` }, { status: 400 })
  }

  const totalBytes = files.reduce((sum, f) => sum + f.size, 0)
  if (totalBytes > MAX_TOTAL_BYTES) {
    return NextResponse.json(
      {
        error: `Those files total ${(totalBytes / 1024 / 1024).toFixed(1)} MB. The limit is ${MAX_TOTAL_BYTES / 1024 / 1024} MB — try a single document, or paste the key details as text.`,
      },
      { status: 413 },
    )
  }

  // Uploaded files are parsed in memory and discarded — nothing is written to
  // disk or the database. Only the generated letter is persisted.
  let parts: SourcePart[]
  try {
    parts = await Promise.all(files.map(fileToSourcePart))
  } catch (err) {
    if (err instanceof UnsupportedFileError) {
      return NextResponse.json({ error: err.message }, { status: 415 })
    }
    console.error('appeal upload parse failed', err)
    return NextResponse.json(
      { error: 'That file could not be read. It may be corrupt or password-protected.' },
      { status: 400 },
    )
  }

  let letter: string
  try {
    recordHit(ip)
    letter = await draftAppealFromDocument({ parts, notes })
  } catch (err) {
    console.error('appeal drafting failed', err)
    const message = err instanceof Error ? err.message : 'Drafting failed.'
    return NextResponse.json({ error: message }, { status: 502 })
  }

  const sourceLabel = files.map(f => f.name).join(', ') || 'pasted notes'

  // Record it the same way BaseAgent records a dashboard-drafted letter, so it
  // shows up in the showcase list as a genuine system artifact.
  await prisma.agentLog
    .create({
      data: {
        taskId: crypto.randomUUID(),
        agentName: 'BILLING',
        status: 'COMPLETE',
        intent: 'draft-appeal',
        message: `Appeal letter drafted from ${sourceLabel}.`,
        reasoning: 'Gemini 2.5 Flash billing (appeals review portal)',
        confidence: 0.91,
        data: { appealLetter: letter, sourceLabel },
        sessionId: 'appeals-portal',
      },
    })
    .catch(err => console.error('agent log write failed', err))

  return NextResponse.json({ letter, sourceLabel })
}

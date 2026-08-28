import { NextResponse } from 'next/server'
import { secretMatches } from '@/lib/appeals/demo-auth'
import {
  MAX_FILES,
  MAX_NOTES_CHARS,
  MAX_TOTAL_BYTES,
  UnsupportedFileError,
  fileToSourcePart,
} from '@/lib/appeals/parse-upload'
import { draftAppealFromDocument, type SourcePart } from '@/lib/billing/draft-appeal-from-document'
import { prisma } from '@/lib/db'

/**
 * Drafting endpoint for the public tool on yeam.ai.
 *
 * The marketing site cannot call `/api/appeals/generate`: that one is gated by
 * the reviewer passcode cookie, which is `sameSite: 'lax'` and so never travels
 * on a cross-origin request. Rather than weaken that cookie, yeam.ai posts to
 * its own route, which forwards here server-to-server with a shared secret.
 *
 * So this is deliberately NOT browser-callable and sets no CORS headers — a
 * preflight from any origin simply fails, which is the intended behaviour. The
 * only caller is the website's own server.
 *
 * The passcode portal at /appeals is untouched and stays gated.
 */

export const runtime = 'nodejs'
/** Drafting runs well past the default budget on a cold start. */
export const maxDuration = 60

/** Keeps public-demo letters out of the curated /appeals showcase list. */
const PUBLIC_DEMO_SESSION = 'public-demo'

export async function POST(req: Request) {
  if (!process.env.PUBLIC_DEMO_SECRET) {
    return NextResponse.json(
      { error: 'The public demo is not configured on this deployment.' },
      { status: 503 },
    )
  }
  if (!secretMatches(req.headers.get('x-yeam-demo-secret'))) {
    return NextResponse.json({ error: 'Not authorised.' }, { status: 401 })
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
  if (notes.length > MAX_NOTES_CHARS) {
    return NextResponse.json(
      { error: `Those notes are too long — keep them under ${MAX_NOTES_CHARS.toLocaleString()} characters.` },
      { status: 413 },
    )
  }

  const totalBytes = files.reduce((sum, f) => sum + f.size, 0)
  if (totalBytes > MAX_TOTAL_BYTES) {
    return NextResponse.json(
      {
        error: `Those files total ${(totalBytes / 1024 / 1024).toFixed(1)} MB. The limit is ${MAX_TOTAL_BYTES / 1024 / 1024} MB.`,
      },
      { status: 413 },
    )
  }

  // Parsed in memory and discarded. Nothing about the document is written to
  // disk or the database, and the drafted letter is not retained either — this
  // is a public tool on a deployment with no BAA, so the less it keeps the better.
  let parts: SourcePart[]
  try {
    parts = await Promise.all(files.map(fileToSourcePart))
  } catch (err) {
    if (err instanceof UnsupportedFileError) {
      return NextResponse.json({ error: err.message }, { status: 415 })
    }
    console.error('public demo parse failed', err)
    return NextResponse.json(
      { error: 'That file could not be read. It may be corrupt or password-protected.' },
      { status: 400 },
    )
  }

  let letter: string
  try {
    letter = await draftAppealFromDocument({ parts, notes })
  } catch (err) {
    console.error('public demo drafting failed', err)
    // Don't echo the upstream error to a public caller — it can carry provider
    // detail. The website turns this into its own message.
    return NextResponse.json({ error: 'Could not draft the letter. Please try again.' }, { status: 502 })
  }

  // Audit row only: no letter text, no filenames.
  await prisma.agentLog
    .create({
      data: {
        taskId: crypto.randomUUID(),
        agentName: 'BILLING',
        status: 'COMPLETE',
        intent: 'draft-appeal',
        message: `Letter drafted from the public demo (${files.length} file(s)${
          notes ? ' and pasted notes' : ''
        }).`,
        reasoning: 'Gemini 2.5 Flash billing (yeam.ai public demo)',
        confidence: 0.91,
        sessionId: PUBLIC_DEMO_SESSION,
      },
    })
    .catch(err => console.error('agent log write failed', err))

  return NextResponse.json({ letter })
}

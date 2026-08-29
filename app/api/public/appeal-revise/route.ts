import { NextResponse } from 'next/server'
import { secretMatches } from '@/lib/appeals/demo-auth'
import { reviseAppealLetter, type ReviseTurn } from '@/lib/billing/revise-appeal'
import { prisma } from '@/lib/db'

/**
 * Revision endpoint for the public tool on yeam.ai.
 *
 * Sibling of /api/public/appeal-demo: that one turns a denial document into a
 * first draft, this one takes the draft back with an instruction and returns
 * the next version. A first draft is rarely the one that gets filed, and the
 * website has no model key of its own, so the conversation has to land here.
 *
 * Same posture as its sibling: deliberately NOT browser-callable, no CORS
 * headers, gated on the shared secret, and nothing is retained. The letter
 * arrives, is revised, and is returned — it is never written to disk or the
 * database, and the passcode portal at /appeals is untouched.
 */

export const runtime = 'nodejs'
/** Revisions are shorter than a first draft but still model-bound. */
export const maxDuration = 60

/** Keeps public-demo activity out of the curated /appeals showcase list. */
const PUBLIC_DEMO_SESSION = 'public-demo'

const MAX_LETTER_CHARS = 20_000
const MAX_INSTRUCTION_CHARS = 2_000
const MAX_HISTORY = 12

function cleanHistory(value: unknown): ReviseTurn[] {
  if (!Array.isArray(value)) return []
  return value
    .filter(
      (t): t is ReviseTurn =>
        !!t &&
        typeof t === 'object' &&
        ((t as ReviseTurn).role === 'user' || (t as ReviseTurn).role === 'assistant') &&
        typeof (t as ReviseTurn).text === 'string',
    )
    .slice(-MAX_HISTORY)
    .map(t => ({ role: t.role, text: t.text.slice(0, MAX_INSTRUCTION_CHARS) }))
}

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

  let body: { letter?: unknown; instruction?: unknown; history?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Could not read the request.' }, { status: 400 })
  }

  const letter = typeof body.letter === 'string' ? body.letter.trim() : ''
  const instruction = typeof body.instruction === 'string' ? body.instruction.trim() : ''

  if (!letter || !instruction) {
    return NextResponse.json(
      { error: 'Send the current draft and the change you want.' },
      { status: 400 },
    )
  }
  if (letter.length > MAX_LETTER_CHARS) {
    return NextResponse.json({ error: 'That draft is too long to revise.' }, { status: 413 })
  }
  if (instruction.length > MAX_INSTRUCTION_CHARS) {
    return NextResponse.json(
      { error: `Keep the instruction under ${MAX_INSTRUCTION_CHARS.toLocaleString()} characters.` },
      { status: 413 },
    )
  }

  let revised: { letter: string; reply: string }
  try {
    revised = await reviseAppealLetter({
      letter,
      instruction,
      history: cleanHistory(body.history),
    })
  } catch (err) {
    console.error('public demo revision failed', err)
    // Don't echo the upstream error to a public caller — it can carry provider
    // detail. The website turns this into its own message.
    return NextResponse.json(
      { error: 'Could not revise the letter. Please try again.' },
      { status: 502 },
    )
  }

  // Audit row only: no letter text, no instruction text.
  await prisma.agentLog
    .create({
      data: {
        taskId: crypto.randomUUID(),
        agentName: 'BILLING',
        status: 'COMPLETE',
        intent: 'revise-appeal',
        message: 'Letter revised from the public demo.',
        reasoning: 'Gemini 2.5 Flash billing (yeam.ai public demo)',
        confidence: 0.91,
        sessionId: PUBLIC_DEMO_SESSION,
      },
    })
    .catch(err => console.error('agent log write failed', err))

  return NextResponse.json({ letter: revised.letter, reply: revised.reply })
}

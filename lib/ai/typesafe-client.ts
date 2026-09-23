/**
 * Typed judgments from TypeSafe's System One API.
 *
 * The difference from lib/ai/gemini-client.ts is the whole point of this file.
 * A generative model is asked for prose and told, in the prompt, what it may
 * not say — which is a request. This one is handed a finite map of options and
 * returns a key from it, plus a probability for each. A code that is not in the
 * map cannot come back, because there is nothing for it to come back as.
 *
 * That matters here specifically. The server holds no chart, so a model asked
 * to judge coding from a claim line is guessing, and a confident guess about a
 * CPT is how a practice ends up upcoding. Constraining the answer to diagnoses
 * this practice has actually been paid for turns the guess into a selection.
 *
 * One POST, called over REST rather than through an SDK, for the reason
 * lib/email/client.ts gives: a dependency added for one endpoint is a lockfile
 * entry and a supply-chain surface bought for nothing.
 *
 * Availability is a flag, not a throw, and every failure is a value. A missing
 * key must degrade to "no verdict", never to a claim detail that will not open.
 */

export const TYPESAFE_AVAILABLE = !!process.env.TYPESAFE_API_KEY

/** One place the model id lives, as MODEL does in gemini-client.ts. */
const MODEL = 'jev-latest'

const BASE_URL = process.env.TYPESAFE_API_URL ?? 'https://api.typesafe.ai'

/**
 * Long enough for four judgments in one call, short enough that a hanging
 * provider does not hold a biller's click. The verdict is never the point of
 * the request in the sense that it must succeed — the computed signals render
 * without it.
 */
const TIMEOUT_MS = 20_000

export type TypeSafeQuestion =
  | { type: 'choice'; instructions: string; criteria: Record<string, string> }
  | { type: 'noul'; instructions: string; criteria?: { true: string; false: string } }
  | { type: 'score'; instructions: string; criteria: string[] }

export type ChoiceAnswer = {
  type: 'choice'
  choice: string
  probabilities: Record<string, number>
  confidence: number
}
export type NoulAnswer = { type: 'noul'; noul: number }
export type ScoreAnswer = {
  type: 'score'
  score: number
  legend: Record<string, string>
  probabilities: Record<string, number>
  confidence: number
}
export type TypeSafeAnswer = ChoiceAnswer | NoulAnswer | ScoreAnswer

export type TypeSafeFailure =
  | 'not-configured'
  | 'timeout'
  | 'network'
  /** The response did not satisfy the contract we asked for. See validate(). */
  | 'malformed'
  | `http-${number}`

export type TypeSafeResult<K extends string> =
  | {
      ok: true
      model: string
      answers: Record<K, TypeSafeAnswer>
      usage: { input_tokens: number; output_tokens: number }
    }
  | { ok: false; reason: TypeSafeFailure; detail?: string }

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function inUnitRange(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1
}

/**
 * Check the answer against the question we actually asked.
 *
 * "The model cannot return a value outside the criteria map" is the provider's
 * property, not ours. Trusting it would leave us with a promise where we
 * believe we have an invariant — and the entire reason for routing coding
 * judgments through this API is that the guarantee is structural. So we verify
 * it on every response, and a violation is a failure rather than a value.
 *
 * Cheap insurance: if the contract ever changes, this surfaces as "prediction
 * unavailable" instead of as a hallucinated ICD-10 on a corrected claim.
 */
function validate<K extends string>(
  questions: Record<K, TypeSafeQuestion>,
  answers: unknown,
): answers is Record<K, TypeSafeAnswer> {
  if (!isRecord(answers)) return false

  const asked = Object.keys(questions)
  if (Object.keys(answers).length !== asked.length) return false

  for (const key of asked) {
    const q = questions[key as K]
    const a = answers[key]
    if (!isRecord(a) || a.type !== q.type) return false

    if (q.type === 'choice') {
      if (typeof a.choice !== 'string') return false
      // The line this whole file exists to hold.
      if (!Object.hasOwn(q.criteria, a.choice)) return false
      if (!isRecord(a.probabilities)) return false
      if (!inUnitRange(a.confidence)) return false
    } else if (q.type === 'noul') {
      if (!inUnitRange(a.noul)) return false
    } else {
      if (typeof a.score !== 'number' || !Number.isFinite(a.score)) return false
      if (!isRecord(a.legend)) return false
      if (Object.keys(a.legend).length !== q.criteria.length) return false
      // A score is a probability-weighted POSITION along the levels, not an
      // index into them: a real response carries 1.13 for a claim sitting
      // between "only if quick" and "worth working". So the check is that it
      // lands inside the legend's own numbering, not that it names a key.
      const levels = Object.keys(a.legend).map(Number)
      if (levels.some(Number.isNaN)) return false
      if (a.score < Math.min(...levels) || a.score > Math.max(...levels)) return false
      if (!inUnitRange(a.confidence)) return false
    }
  }
  return true
}

/**
 * Ask several independent questions over one shared state, in one call.
 *
 * The questions map is why this takes a map rather than a question: four
 * judgments about the same claim are one request, one latency and one set of
 * input tokens.
 */
export async function askTypeSafe<K extends string>(
  state: unknown,
  questions: Record<K, TypeSafeQuestion>,
): Promise<TypeSafeResult<K>> {
  if (!TYPESAFE_AVAILABLE) return { ok: false, reason: 'not-configured' }
  if (Object.keys(questions).length === 0) return { ok: false, reason: 'malformed' }

  let res: Response
  try {
    res = await fetch(`${BASE_URL}/v1/systemone`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.TYPESAFE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ state, model: MODEL, questions }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (err) {
    const name = err instanceof Error ? err.name : ''
    if (name === 'TimeoutError' || name === 'AbortError') {
      console.error('[typesafe] timed out after', TIMEOUT_MS, 'ms')
      return { ok: false, reason: 'timeout' }
    }
    console.error('[typesafe] network error:', err)
    return { ok: false, reason: 'network' }
  }

  if (!res.ok) {
    // Logged, never returned to a caller that might show it: a provider body
    // is not something a biller should ever read. Same rule as the email client.
    const body = await res.text().catch(() => '')
    console.error('[typesafe] HTTP', res.status, body.slice(0, 500))
    return { ok: false, reason: `http-${res.status}` }
  }

  let payload: unknown
  try {
    payload = await res.json()
  } catch {
    return { ok: false, reason: 'malformed', detail: 'response was not JSON' }
  }

  if (!isRecord(payload) || !validate(questions, payload.answers)) {
    console.error('[typesafe] response did not match the questions asked')
    return { ok: false, reason: 'malformed' }
  }

  const usage = isRecord(payload.usage) ? payload.usage : {}
  return {
    ok: true,
    model: typeof payload.model === 'string' ? payload.model : MODEL,
    answers: payload.answers as Record<K, TypeSafeAnswer>,
    usage: {
      input_tokens: typeof usage.input_tokens === 'number' ? usage.input_tokens : 0,
      output_tokens: typeof usage.output_tokens === 'number' ? usage.output_tokens : 0,
    },
  }
}

/**
 * Where a score sits among its levels.
 *
 * The raw score is a probability-weighted position, so it is usually between
 * levels — a live response gives 1.13 across four levels. That fractional value
 * is the honest answer and is kept; `band` and `label` are the nearest named
 * level, for the cases that need a word rather than a number.
 *
 * Everything is derived from the legend the response carried, never from
 * arithmetic on the criteria array. The API does not document whether it
 * numbers levels from 0 or from 1 — a live call showed 0 — and hard-coding
 * either would silently invert the recommendation if it ever changed.
 */
export function scoreBand(answer: ScoreAnswer): {
  band: number
  label: string
  levels: number
  /** The raw weighted position, e.g. 1.13. */
  position: number
} {
  const keys = Object.keys(answer.legend).sort((a, b) => Number(a) - Number(b))

  // Nearest level by numeric distance, not by rounding the raw value: the
  // legend may be numbered from 1, in which case rounding gives the wrong key.
  let nearest = keys[0] ?? '0'
  for (const key of keys) {
    if (Math.abs(Number(key) - answer.score) < Math.abs(Number(nearest) - answer.score)) {
      nearest = key
    }
  }

  return {
    band: keys.indexOf(nearest),
    label: answer.legend[nearest] ?? '',
    levels: keys.length,
    position: answer.score,
  }
}

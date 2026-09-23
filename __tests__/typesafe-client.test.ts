import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The client's job is to make the provider's guarantee OUR invariant.
 *
 * "A choice model cannot return a value outside the criteria map" is TypeSafe's
 * property. Trusting it would leave a promise where the whole design assumes an
 * invariant, so every response is checked against the questions actually asked
 * — and a violation is a failure, never a value. These tests are that check.
 */

const QUESTIONS = {
  bestIcd10: {
    type: 'choice' as const,
    instructions: 'which diagnosis',
    criteria: { 'E11.9': 'a', 'E11.65': 'b', LEAVE_AS_BILLED: 'c' },
  },
  denyAgain: {
    type: 'noul' as const,
    instructions: 'denied again?',
    criteria: { true: 'yes', false: 'no' },
  },
}

function respond(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response)
}

const GOOD = {
  model: 'jev-latest',
  answers: {
    bestIcd10: { type: 'choice', choice: 'E11.65', probabilities: { 'E11.65': 0.8 }, confidence: 0.8 },
    denyAgain: { type: 'noul', noul: 0.42 },
  },
  usage: { input_tokens: 10, output_tokens: 3 },
}

async function load() {
  vi.resetModules()
  return import('@/lib/ai/typesafe-client')
}

describe('askTypeSafe', () => {
  const realFetch = globalThis.fetch
  const realKey = process.env.TYPESAFE_API_KEY

  beforeEach(() => {
    process.env.TYPESAFE_API_KEY = 'test-key'
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    globalThis.fetch = realFetch
    if (realKey === undefined) delete process.env.TYPESAFE_API_KEY
    else process.env.TYPESAFE_API_KEY = realKey
    vi.restoreAllMocks()
  })

  it('makes no call at all when no key is configured', async () => {
    delete process.env.TYPESAFE_API_KEY
    const { askTypeSafe } = await load()
    const fetchSpy = respond(GOOD)
    globalThis.fetch = fetchSpy

    const result = await askTypeSafe({}, QUESTIONS)
    expect(result).toEqual({ ok: false, reason: 'not-configured' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('sends every question in one call, against the pinned model', async () => {
    const { askTypeSafe } = await load()
    const fetchSpy = respond(GOOD)
    globalThis.fetch = fetchSpy

    const result = await askTypeSafe({ payer: 'Aetna' }, QUESTIONS)
    expect(result.ok).toBe(true)
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string)
    expect(body.model).toBe('jev-latest')
    expect(Object.keys(body.questions).sort()).toEqual(['bestIcd10', 'denyAgain'])
    expect(body.state).toEqual({ payer: 'Aetna' })
  })

  // The line the whole file exists to hold.
  it('refuses a choice that is not in the map it was sent', async () => {
    const { askTypeSafe } = await load()
    globalThis.fetch = respond({
      ...GOOD,
      answers: {
        ...GOOD.answers,
        bestIcd10: { type: 'choice', choice: 'E99.999', probabilities: {}, confidence: 0.99 },
      },
    })

    const result = await askTypeSafe({}, QUESTIONS)
    expect(result).toEqual({ ok: false, reason: 'malformed' })
  })

  it('refuses a probability that is not a probability', async () => {
    const { askTypeSafe } = await load()
    globalThis.fetch = respond({
      ...GOOD,
      answers: { ...GOOD.answers, denyAgain: { type: 'noul', noul: 1.4 } },
    })
    expect(await askTypeSafe({}, QUESTIONS)).toEqual({ ok: false, reason: 'malformed' })
  })

  it('refuses an answer to a question it did not ask', async () => {
    const { askTypeSafe } = await load()
    globalThis.fetch = respond({
      ...GOOD,
      answers: { ...GOOD.answers, somethingElse: { type: 'noul', noul: 0.5 } },
    })
    expect(await askTypeSafe({}, QUESTIONS)).toEqual({ ok: false, reason: 'malformed' })
  })

  it('refuses a missing answer rather than returning a partial verdict', async () => {
    const { askTypeSafe } = await load()
    globalThis.fetch = respond({ ...GOOD, answers: { denyAgain: { type: 'noul', noul: 0.5 } } })
    expect(await askTypeSafe({}, QUESTIONS)).toEqual({ ok: false, reason: 'malformed' })
  })

  const SCORE_Q = {
    worthIt: { type: 'score' as const, instructions: 'worth it?', criteria: ['low', 'high'] },
  }
  const scoreRes = (score: number) => ({
    model: 'jev-latest',
    answers: {
      worthIt: { type: 'score', score, legend: { '0': 'low', '1': 'high' }, probabilities: {}, confidence: 0.5 },
    },
    usage: { input_tokens: 1, output_tokens: 1 },
  })

  it('refuses a score that falls outside its own legend', async () => {
    const { askTypeSafe } = await load()
    globalThis.fetch = respond(scoreRes(7))
    expect(await askTypeSafe({}, SCORE_Q)).toEqual({ ok: false, reason: 'malformed' })
  })

  /*
    A score is a probability-weighted POSITION along the levels, not an index
    into them — the live API returns 1.13 across four levels. An earlier version
    of this client required the score to name a legend key, which rejected every
    real response. Pinned here because only a live call caught it.
  */
  it('accepts the fractional score the API actually returns', async () => {
    const { askTypeSafe } = await load()
    globalThis.fetch = respond(scoreRes(0.62))
    const result = await askTypeSafe({}, SCORE_Q)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect((result.answers.worthIt as { score: number }).score).toBe(0.62)
  })

  it('reports an HTTP failure without leaking the provider body', async () => {
    const { askTypeSafe } = await load()
    globalThis.fetch = respond({ error: 'internal key rotation detail' }, 500)

    const result = await askTypeSafe({}, QUESTIONS)
    expect(result).toEqual({ ok: false, reason: 'http-500' })
    expect(JSON.stringify(result)).not.toContain('key rotation')
  })

  it('reports a timeout as a timeout', async () => {
    const { askTypeSafe } = await load()
    globalThis.fetch = vi.fn().mockRejectedValue(
      Object.assign(new Error('aborted'), { name: 'TimeoutError' }),
    )
    expect(await askTypeSafe({}, QUESTIONS)).toEqual({ ok: false, reason: 'timeout' })
  })

  it('reports a network failure as a network failure', async () => {
    const { askTypeSafe } = await load()
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed'))
    expect(await askTypeSafe({}, QUESTIONS)).toEqual({ ok: false, reason: 'network' })
  })
})

describe('scoreBand', () => {
  // The API does not document whether score is 0- or 1-based, so the legend is
  // the only safe source. Indexing the criteria array would invert the
  // recommendation silently.
  it('agrees with the legend whichever way the levels are numbered', async () => {
    const { scoreBand } = await load()

    const zero = scoreBand({
      type: 'score',
      score: 0,
      legend: { '0': 'Not worth touching', '1': 'Worth working' },
      probabilities: {},
      confidence: 0.6,
    })
    expect(zero).toEqual({ band: 0, label: 'Not worth touching', levels: 2, position: 0 })

    const one = scoreBand({
      type: 'score',
      score: 1,
      legend: { '1': 'Not worth touching', '2': 'Worth working' },
      probabilities: {},
      confidence: 0.6,
    })
    expect(one).toEqual({ band: 0, label: 'Not worth touching', levels: 2, position: 1 })
  })

  it('sorts levels numerically, not as strings', async () => {
    const { scoreBand } = await load()
    const legend = { '1': 'a', '2': 'b', '10': 'c' }
    expect(scoreBand({ type: 'score', score: 10, legend, probabilities: {}, confidence: 1 }).band).toBe(2)
  })

  it('snaps a weighted position to its nearest level and keeps the raw value', () => {
    return load().then(({ scoreBand }) => {
      const legend = { '0': 'not worth touching', '1': 'only if quick', '2': 'worth working', '3': 'work this first' }
      const at = (score: number) =>
        scoreBand({ type: 'score', score, legend, probabilities: {}, confidence: 0.5 })

      // The exact shape of a real response: 1.13 sits just above "only if quick".
      expect(at(1.13)).toEqual({ band: 1, label: 'only if quick', levels: 4, position: 1.13 })
      expect(at(2.24).label).toBe('worth working')
      expect(at(1.6).label).toBe('worth working')
      expect(at(1.4).label).toBe('only if quick')
    })
  })

  it('snaps correctly when the legend is numbered from one', () => {
    return load().then(({ scoreBand }) => {
      // Rounding the raw value would give key "1" here, which is the WRONG
      // level. Nearest-by-distance over the legend's own keys is why this works.
      const legend = { '1': 'low', '2': 'mid', '3': 'high' }
      const r = scoreBand({ type: 'score', score: 2.4, legend, probabilities: {}, confidence: 0.5 })
      expect(r.label).toBe('mid')
      expect(r.band).toBe(1)
    })
  })
})

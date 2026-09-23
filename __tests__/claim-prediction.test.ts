import { beforeEach, describe, expect, it, vi } from 'vitest'
import { codeSignals, MIN_SAMPLE, type ClaimCodeFact } from '@/lib/claims/code-signals'
import {
  LEAVE_AS_BILLED,
  buildPredictionState,
  buildQuestions,
  predictClaim,
  predictionHash,
  type PredictionState,
} from '@/lib/claims/predict'
import * as client from '@/lib/ai/typesafe-client'

function claim(over: Partial<ClaimCodeFact> = {}): ClaimCodeFact {
  return {
    payer: 'Aetna',
    cpt: '99213',
    icd10: 'E11.9',
    status: 'PAID',
    billed: 200,
    allowed: 120,
    paid: 120,
    carc: null,
    ...over,
  }
}
const many = (n: number, over: Partial<ClaimCodeFact> = {}) =>
  Array.from({ length: n }, () => claim(over))

function state(over: Partial<PredictionState> = {}, all: ClaimCodeFact[] = []): PredictionState {
  const signals = codeSignals({ payer: 'Aetna', cpt: '99213', icd10: 'E11.9' }, all)
  return {
    ...buildPredictionState({
      signals,
      status: 'DENIED',
      billed: 200,
      allowed: null,
      paid: null,
      balance: 200,
      ageDays: 60,
      filing: { daysLeft: 40, windowDays: 90, windowSource: 'default' },
      denial: {
        code: 'CO-11',
        label: 'The diagnosis does not support this procedure',
        note: null,
        playbookRemedy: 'Corrected claim',
        payerPosition: null,
        strategy: null,
        avoid: null,
      },
    }),
    ...over,
  }
}

describe('the diagnosis options are a finite set built from your own claims', () => {
  it('always offers leaving it as billed, so the choice is never foregone', () => {
    const degenerate: PredictionState[] = [
      state({}, many(20, { icd10: 'E11.65' })),
      state({}, [...many(20, { icd10: 'E11.65' }), ...many(20, { icd10: 'I10' })]),
      state({}, many(1, { icd10: 'E11.65' })),
    ]
    for (const s of degenerate) {
      const { questions } = buildQuestions(s)
      const criteria = (questions.bestIcd10 as { criteria: Record<string, string> }).criteria
      expect(Object.hasOwn(criteria, LEAVE_AS_BILLED)).toBe(true)
      expect(Object.keys(criteria).length).toBeGreaterThan(1)
    }
  })

  it('never synthesises an option that is not in your settled history', () => {
    const all = [...many(20, { icd10: 'E11.65' }), ...many(8, { icd10: 'I10' })]
    const s = state({}, all)
    const criteria = (buildQuestions(s).questions.bestIcd10 as {
      criteria: Record<string, string>
    }).criteria

    const fromHistory = new Set(s.candidates.map(c => c.icd10))
    for (const key of Object.keys(criteria)) {
      if (key === LEAVE_AS_BILLED) continue
      expect(fromHistory.has(key)).toBe(true)
    }
  })

  // The "no rate without its denominator" rule, extended from the screen to
  // the prompt. A bare percentage invites ranking a two-claim fluke over a
  // forty-claim pattern.
  it('states the number of claims behind every option', () => {
    const all = [...many(20, { icd10: 'E11.65' }), ...many(2, { icd10: 'I10' })]
    const criteria = (buildQuestions(state({}, all)).questions.bestIcd10 as {
      criteria: Record<string, string>
    }).criteria

    for (const [key, description] of Object.entries(criteria)) {
      if (key === LEAVE_AS_BILLED) continue
      expect(description).toMatch(/\b\d+ of \d+\b/)
    }
  })

  it('says out loud which options are too thin to rely on', () => {
    const all = [...many(20, { icd10: 'E11.65' }), ...many(2, { icd10: 'I10' })]
    const criteria = (buildQuestions(state({}, all)).questions.bestIcd10 as {
      criteria: Record<string, string>
    }).criteria
    expect(criteria['I10']).toContain(`fewer than ${MIN_SAMPLE} claims`)
    expect(criteria['E11.65']).not.toContain('too few to rely on')
  })

  it('is skipped, not faked, when there is no history to choose from', () => {
    const { questions, skipped } = buildQuestions(state({}, []))
    expect(questions.bestIcd10).toBeUndefined()
    expect(skipped.bestIcd10).toBeTruthy()
    expect(skipped.bestIcd10).toContain('nothing to compare against')
  })
})

describe('each question is gated on the evidence it needs', () => {
  it('does not ask whether a paid claim will be denied again', () => {
    const s = state({ claim: { ...state().claim, status: 'PAID' }, denial: null })
    const { questions, skipped } = buildQuestions(s)
    expect(questions.denyAgain).toBeUndefined()
    expect(skipped.denyAgain).toContain('has not been denied')
  })

  it('does not ask whether a settled claim is worth working', () => {
    const s = state({ claim: { ...state().claim, balance: 0 } })
    const { questions, skipped } = buildQuestions(s)
    expect(questions.worthIt).toBeUndefined()
    expect(skipped.worthIt).toContain('no outstanding balance')
  })

  it('does not ask for a remedy when the payer gave no reason', () => {
    const { questions, skipped } = buildQuestions(state({ denial: null }))
    expect(questions.remedy).toBeUndefined()
    expect(skipped.remedy).toContain('no reason code')
  })

  it('offers exactly the three remedies a biller can act on', () => {
    const criteria = (buildQuestions(state()).questions.remedy as {
      criteria: Record<string, string>
    }).criteria
    expect(Object.keys(criteria).sort()).toEqual(['appeal', 'correct_and_resubmit', 'write_off'])
  })

  it('puts the worth-it levels in order, lowest first', () => {
    const criteria = (buildQuestions(state()).questions.worthIt as { criteria: string[] }).criteria
    expect(criteria.length).toBeGreaterThanOrEqual(2)
    expect(criteria[0]).toContain('Not worth touching')
    expect(criteria[criteria.length - 1]).toContain('Work this first')
  })
})

describe('predictClaim', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('spends nothing when there is nothing to ask', async () => {
    const ask = vi.spyOn(client, 'askTypeSafe')
    const settled = state(
      { claim: { ...state().claim, status: 'PAID', balance: 0 }, denial: null },
      [],
    )
    const result = await predictClaim(settled)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toBe('nothing-to-ask')
    expect(ask).not.toHaveBeenCalled()
  })

  it('refuses a remedy outside its own three, rather than surfacing it', async () => {
    vi.spyOn(client, 'askTypeSafe').mockResolvedValue({
      ok: true,
      model: 'jev-latest',
      answers: {
        remedy: { type: 'choice', choice: 'escalate_to_legal', probabilities: {}, confidence: 0.9 },
      } as never,
      usage: { input_tokens: 1, output_tokens: 1 },
    })
    const result = await predictClaim(state({}, many(20, { icd10: 'E11.65' })))
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toBe('malformed')
  })

  it('carries the billed diagnosis in allowedCodes even when it was not chosen', async () => {
    vi.spyOn(client, 'askTypeSafe').mockResolvedValue({
      ok: true,
      model: 'jev-latest',
      answers: {
        bestIcd10: { type: 'choice', choice: 'E11.65', probabilities: {}, confidence: 0.8 },
      } as never,
      usage: { input_tokens: 1, output_tokens: 1 },
    })
    const result = await predictClaim(state({}, many(20, { icd10: 'E11.65' })))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // E11.9 is on the claim; E11.65 is what was chosen. The written review has
    // to be able to name both.
    expect(result.verdict.allowedCodes).toContain('E11.9')
    expect(result.verdict.allowedCodes).toContain('E11.65')
    expect(result.verdict.allowedCodes).not.toContain(LEAVE_AS_BILLED)
  })

  it('reports a skipped judgment with its reason instead of an answer', async () => {
    vi.spyOn(client, 'askTypeSafe').mockResolvedValue({
      ok: true,
      model: 'jev-latest',
      answers: {
        denyAgain: { type: 'noul', noul: 0.78 },
      } as never,
      usage: { input_tokens: 1, output_tokens: 1 },
    })
    const result = await predictClaim(state({}, []))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.verdict.denyAgain).toEqual({ asked: true, probability: 0.78 })
    expect(result.verdict.bestIcd10.asked).toBe(false)
    expect(
      result.verdict.bestIcd10.asked === false && result.verdict.bestIcd10.because,
    ).toContain('nothing to compare against')
  })

  // The one place a silent inversion would recommend the opposite action. The
  // API does not document whether score is 0- or 1-based, so the band must come
  // from the legend either way.
  it('reads the worth-it band from the legend under both 0- and 1-indexing', async () => {
    for (const [zeroBased, score] of [
      [true, 3],
      [false, 4],
    ] as const) {
      const legend = zeroBased
        ? { '0': 'Not worth touching', '1': 'Only if quick', '2': 'Worth working', '3': 'Work this first' }
        : { '1': 'Not worth touching', '2': 'Only if quick', '3': 'Worth working', '4': 'Work this first' }

      vi.spyOn(client, 'askTypeSafe').mockResolvedValue({
        ok: true,
        model: 'jev-latest',
        answers: {
          worthIt: { type: 'score', score, legend, probabilities: {}, confidence: 0.7 },
        } as never,
        usage: { input_tokens: 1, output_tokens: 1 },
      })

      const result = await predictClaim(state({}, []))
      expect(result.ok).toBe(true)
      if (!result.ok) return
      const worth = result.verdict.worthIt
      expect(worth.asked).toBe(true)
      if (worth.asked !== true) return
      expect(worth.label).toBe('Work this first')
      expect(worth.band).toBe(3)
      expect(worth.levels).toBe(4)
    }
  })
})

describe('predictionHash', () => {
  const signals = codeSignals(
    { payer: 'Aetna', cpt: '99213', icd10: 'E11.9' },
    many(20, { icd10: 'E11.65' }),
  )
  const base = { status: 'DENIED', balance: 200, daysLeft: 70, carc: 'CO-11' }

  it('is stable for identical inputs', () => {
    expect(predictionHash(signals, base)).toBe(predictionHash(signals, base))
  })

  it('moves when the balance moves', () => {
    expect(predictionHash(signals, { ...base, balance: 900 })).not.toBe(predictionHash(signals, base))
  })

  // Bucketed on purpose: a raw day count changes every morning and the cache
  // would never hit.
  it('survives the night when the filing window is far off', () => {
    expect(predictionHash(signals, { ...base, daysLeft: 61 })).toBe(
      predictionHash(signals, { ...base, daysLeft: 70 }),
    )
  })

  it('moves across a threshold the UI treats as a different situation', () => {
    expect(predictionHash(signals, { ...base, daysLeft: 14 })).not.toBe(
      predictionHash(signals, { ...base, daysLeft: 15 }),
    )
    expect(predictionHash(signals, { ...base, daysLeft: 0 })).not.toBe(
      predictionHash(signals, { ...base, daysLeft: 5 }),
    )
  })

  it('moves when the biller changes the status', () => {
    expect(predictionHash(signals, { ...base, status: 'PAID' })).not.toBe(
      predictionHash(signals, base),
    )
  })
})

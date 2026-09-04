import { describe, it, expect } from 'vitest'
import {
  callGuidance,
  deadlineFactor,
  followUpFactor,
  moneyFactor,
  remedyFactor,
  scoreRow,
  stalenessFactor,
  WEIGHTS,
  type ScoreInput,
} from '@/lib/denials/score'

/** Fixed "today" so nothing here rots. */
const TODAY = new Date(2026, 7, 31) // 31 Aug 2026

function daysAgo(n: number): Date {
  const d = new Date(TODAY)
  d.setDate(d.getDate() - n)
  return d
}

function daysAhead(n: number): Date {
  const d = new Date(TODAY)
  d.setDate(d.getDate() + n)
  return d
}

function input(over: Partial<ScoreInput> = {}): ScoreInput {
  return {
    billed: 1000,
    daysLeft: 45,
    actionable: true,
    remedy: 'appeal',
    denialDate: daysAgo(30),
    lastTouchedAt: null,
    followUpAt: null,
    ...over,
  }
}

describe('weights', () => {
  it('sum to 100 so a score reads as a percentage', () => {
    expect(Object.values(WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100)
  })

  it('does not spend a weight on the follow-up date', () => {
    // Regression. The follow-up used to be a sixth weighted slice worth 10.
    // Almost no row has one set, so the practical ceiling for a normal row was
    // 90 while the band thresholds were chosen as though it were 100 — every
    // score in a real workspace was deflated for a signal nobody had used yet.
    expect(WEIGHTS).not.toHaveProperty('followUp')
  })
})

describe('the scale is reachable', () => {
  it('lets a row max out without ever having a follow-up date', () => {
    const perfect = scoreRow(
      input({
        billed: 100_000,
        daysLeft: 3,
        remedy: 'corrected_claim',
        denialDate: daysAgo(200),
        lastTouchedAt: null,
        followUpAt: null,
      }),
      TODAY,
    )
    expect(perfect.score).toBe(100)
  })

  it('never exceeds 100 once the follow-up bonus is added', () => {
    const withBonus = scoreRow(
      input({
        billed: 100_000,
        daysLeft: 1,
        remedy: 'corrected_claim',
        denialDate: daysAgo(200),
        lastTouchedAt: null,
        followUpAt: daysAgo(30),
      }),
      TODAY,
    )
    expect(withBonus.score).toBe(100)
    expect(withBonus.band).toBe('now')
  })
})

describe('deadlineFactor', () => {
  it('maxes out inside the last week', () => {
    expect(deadlineFactor(3)).toBe(1)
    expect(deadlineFactor(7)).toBe(1)
  })

  it('stays high through the two-week cliff', () => {
    expect(deadlineFactor(14)).toBe(0.9)
  })

  it('decays towards nothing on a distant deadline', () => {
    expect(deadlineFactor(120)).toBeLessThan(0.1)
    expect(deadlineFactor(400)).toBeLessThan(0.1)
  })

  it('scores a missing date mid rather than burying it', () => {
    // An undated row cannot be proven urgent, but scoring it zero is how
    // undated claims quietly die.
    expect(deadlineFactor(null)).toBe(0.5)
    expect(deadlineFactor(null)).toBeGreaterThan(deadlineFactor(90))
  })

  it('is monotonic — more time left never scores more urgent', () => {
    for (let d = 1; d < 200; d++) {
      expect(deadlineFactor(d)).toBeLessThanOrEqual(deadlineFactor(d - 1))
    }
  })
})

describe('moneyFactor', () => {
  it('scores trivial amounts at zero', () => {
    expect(moneyFactor(10)).toBe(0)
    expect(moneyFactor(50)).toBe(0)
  })

  it('reaches the ceiling at the reference amount', () => {
    expect(moneyFactor(25_000)).toBe(1)
    expect(moneyFactor(90_000)).toBe(1)
  })

  it('keeps a small claim visible against a large one', () => {
    // The point of the log curve: one huge claim must not zero out everything
    // else in the queue.
    expect(moneyFactor(600)).toBeGreaterThan(0.3)
    expect(moneyFactor(4_000)).toBeGreaterThan(moneyFactor(600))
  })

  it('spreads the range denials actually fall in', () => {
    // Regression. The reference used to be $25,000, which squeezed a real
    // practice — denials from $188 to $3,250, median near $740 — into the
    // bottom third of the curve, so money barely separated a $3,000 denial
    // from a $500 one. Typical denial sizes must span most of the range.
    expect(moneyFactor(300)).toBeGreaterThan(0.25)
    expect(moneyFactor(3_000)).toBeGreaterThan(0.7)
    // And a $3,000 denial must be clearly ahead of a $500 one, not a hair.
    expect(moneyFactor(3_000) - moneyFactor(500)).toBeGreaterThan(0.25)
  })

  it('survives junk input', () => {
    expect(moneyFactor(Number.NaN)).toBe(0)
    expect(moneyFactor(-500)).toBe(0)
  })
})

describe('stalenessFactor', () => {
  it('ages from the last human touch when there is one', () => {
    expect(stalenessFactor(daysAgo(30), daysAgo(200), TODAY)).toBe(1)
    expect(stalenessFactor(daysAgo(0), daysAgo(200), TODAY)).toBe(0)
  })

  it('falls back to the denial date so an old import is not treated as fresh', () => {
    expect(stalenessFactor(null, daysAgo(30), TODAY)).toBe(1)
    expect(stalenessFactor(null, daysAgo(3), TODAY)).toBeCloseTo(0.1, 5)
  })
})

describe('followUpFactor', () => {
  it('spikes once the date the biller set has passed', () => {
    expect(followUpFactor(daysAgo(1), TODAY)).toBe(1)
    expect(followUpFactor(TODAY, TODAY)).toBe(0.9)
  })

  it('does not penalise a row with no follow-up', () => {
    expect(followUpFactor(null, TODAY)).toBe(0)
  })

  it('ignores a follow-up that is still comfortably in the future', () => {
    expect(followUpFactor(daysAhead(20), TODAY)).toBe(0)
  })
})

describe('remedyFactor', () => {
  it('prefers the cheap fix over the expensive argument', () => {
    expect(remedyFactor('corrected_claim')).toBeGreaterThan(remedyFactor('appeal'))
  })

  it('scores unrecoverable work at nothing', () => {
    expect(remedyFactor('not_recoverable')).toBe(0)
  })
})

describe('scoreRow', () => {
  it('parks anything that cannot be recovered, however large', () => {
    // The rule that makes write-off-versus-appeal legible in the queue itself.
    const huge = scoreRow(
      input({ billed: 50_000, actionable: false, remedy: 'not_recoverable', daysLeft: 200 }),
      TODAY,
    )
    expect(huge.score).toBe(0)
    expect(huge.band).toBe('parked')
  })

  it('parks an expired row even though the remedy was real', () => {
    const expired = scoreRow(
      input({ billed: 9_000, actionable: false, remedy: 'appeal', daysLeft: -5 }),
      TODAY,
    )
    expect(expired.score).toBe(0)
    expect(expired.factors[0].detail).toMatch(/past the filing window/i)
  })

  it('ranks a large claim with time left above a tiny one expiring Friday', () => {
    // The specific failure of the old deadline-only sort.
    const bigAndPatient = scoreRow(
      input({ billed: 12_000, daysLeft: 21, remedy: 'appeal' }),
      TODAY,
    )
    const smallAndUrgent = scoreRow(
      input({ billed: 40, daysLeft: 3, remedy: 'appeal' }),
      TODAY,
    )
    expect(bigAndPatient.score).toBeGreaterThan(smallAndUrgent.score)
  })

  it('lifts a row nobody has touched in a month', () => {
    const fresh = scoreRow(input({ lastTouchedAt: daysAgo(0) }), TODAY)
    const forgotten = scoreRow(input({ lastTouchedAt: daysAgo(45) }), TODAY)
    expect(forgotten.score).toBeGreaterThan(fresh.score)
  })

  it('lets an overdue follow-up outrank an identical row without one', () => {
    const plain = scoreRow(input(), TODAY)
    const promised = scoreRow(input({ followUpAt: daysAgo(2) }), TODAY)
    expect(promised.score).toBeGreaterThan(plain.score)
  })

  it('stays inside 0 and 100 across extremes', () => {
    const max = scoreRow(
      input({
        billed: 500_000,
        daysLeft: 1,
        remedy: 'corrected_claim',
        lastTouchedAt: daysAgo(500),
        followUpAt: daysAgo(10),
      }),
      TODAY,
    )
    expect(max.score).toBeLessThanOrEqual(100)
    expect(max.score).toBeGreaterThan(80)
    expect(max.band).toBe('now')
  })

  it('always explains itself', () => {
    const scored = scoreRow(input(), TODAY)
    expect(scored.factors.length).toBeGreaterThan(0)
    for (const f of scored.factors) {
      expect(f.detail).toBeTruthy()
      expect(f.label).toBeTruthy()
    }
  })

  it('orders the explanation by what actually drove the score', () => {
    const scored = scoreRow(input({ billed: 40_000, daysLeft: 200 }), TODAY)
    const points = scored.factors.map(f => f.points)
    expect([...points].sort((a, b) => b - a)).toEqual(points)
  })
})

describe('callGuidance', () => {
  it('says there is nothing to chase on a row that was never sent', () => {
    const g = callGuidance(
      { status: 'TO_WORK', lastTouchedAt: daysAgo(40), payerMedianDaysToPay: 30 },
      TODAY,
    )
    expect(g.verdict).toBe('not-sent')
  })

  it('tells the biller not to call while the payer is still inside its median', () => {
    // The whole point: "often the claim was in process and the call was not
    // worth it at the end."
    const g = callGuidance(
      { status: 'SENT', lastTouchedAt: daysAgo(4), payerMedianDaysToPay: 34 },
      TODAY,
    )
    expect(g.verdict).toBe('in-process')
    expect(g.detail).toContain('34')
  })

  it('calls it due once past the median', () => {
    const g = callGuidance(
      { status: 'SENT', lastTouchedAt: daysAgo(40), payerMedianDaysToPay: 34 },
      TODAY,
    )
    expect(g.verdict).toBe('due')
  })

  it('escalates well past the median', () => {
    const g = callGuidance(
      { status: 'SENT', lastTouchedAt: daysAgo(120), payerMedianDaysToPay: 30 },
      TODAY,
    )
    expect(g.verdict).toBe('overdue')
  })

  it('labels the rule of thumb as one when there is no snapshot', () => {
    const early = callGuidance(
      { status: 'SENT', lastTouchedAt: daysAgo(5), payerMedianDaysToPay: null },
      TODAY,
    )
    expect(early.verdict).toBe('in-process')
    expect(early.detail).toMatch(/A\/R export/i)

    const late = callGuidance(
      { status: 'SENT', lastTouchedAt: daysAgo(45), payerMedianDaysToPay: null },
      TODAY,
    )
    expect(late.verdict).toBe('due')
    expect(late.detail).toMatch(/rule of thumb/i)
  })
})

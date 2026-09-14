import { describe, it, expect } from 'vitest'
import { codeSignals, signalsHash, MIN_SAMPLE, type ClaimCodeFact } from '@/lib/claims/code-signals'
import { isKnownProcedure, profileFor } from '@/lib/billing/procedure-codes'

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

describe('the procedure reference is only ever a positive signal', () => {
  it('never claims a mismatch for a code it does not know', () => {
    // profileFor() falls back to GENERIC = ['I10', 'E11.9'] for anything absent
    // from its 59-entry table. Judging a real claim against that would tell a
    // coder their diagnosis is wrong because it is not hypertension.
    expect(isKnownProcedure('J1885')).toBe(false)
    const s = codeSignals({ payer: 'Aetna', cpt: 'J1885', icd10: 'M25.511' }, [])
    expect(s.coherence).toBe('unknown')
    expect(s.limits.join(' ')).toContain('not in the built-in procedure reference')
  })

  it('does not borrow the generic fallback diagnoses for an unknown code', () => {
    // The trap: GENERIC's diagnoses would make I10 look "consistent" with a code
    // nothing is known about.
    expect(profileFor('ZZZZZ').diagnoses).toContain('I10')
    expect(codeSignals({ payer: null, cpt: 'ZZZZZ', icd10: 'I10' }, []).coherence).toBe('unknown')
  })

  it('confirms a pairing it actually knows', () => {
    const known = Object.keys(profileFor('99213') ? { '99213': 1 } : {})
    expect(known.length).toBeGreaterThan(0)
    const icd = profileFor('99213').diagnoses[0]
    expect(codeSignals({ payer: null, cpt: '99213', icd10: icd }, []).coherence).toBe('consistent')
  })
})

describe('history is drawn from the practice own claims', () => {
  it('reports the payer-and-code population when it is big enough', () => {
    const rows = [...many(6), ...many(4, { payer: 'Cigna' })]
    const s = codeSignals({ payer: 'Aetna', cpt: '99213', icd10: 'E11.9' }, rows)
    expect(s.history).toMatchObject({ scope: 'payer+cpt', n: 6, paid: 6, paidRate: 100, thin: false })
  })

  it('widens to the code across all payers when this payer is too thin', () => {
    const rows = [...many(2), ...many(8, { payer: 'Cigna' })]
    const s = codeSignals({ payer: 'Aetna', cpt: '99213', icd10: 'E11.9' }, rows)
    expect(s.history?.scope).toBe('cpt')
    expect(s.history?.n).toBe(10)
  })

  it('flags a thin sample rather than quoting a rate as if it were solid', () => {
    const rows = many(2)
    const s = codeSignals({ payer: 'Aetna', cpt: '99213', icd10: 'E11.9' }, rows)
    expect(s.history?.thin).toBe(true)
    expect(s.history!.n).toBeLessThan(MIN_SAMPLE)
    expect(s.limits.join(' ')).toContain('indicative, not reliable')
  })

  it('names the reason this code is denied for most often', () => {
    const rows = [
      ...many(4, { status: 'DENIED', carc: 'CO-11' }),
      ...many(1, { status: 'DENIED', carc: 'CO-16' }),
      ...many(5),
    ]
    const s = codeSignals({ payer: 'Aetna', cpt: '99213', icd10: 'E11.9' }, rows)
    expect(s.history?.topCarc).toEqual({ code: 'CO-11', count: 4 })
    expect(s.history?.deniedRate).toBe(50)
  })
})

describe('diagnosis candidates', () => {
  it('ranks by what actually got paid, not by how often it was tried', () => {
    const rows = [
      ...many(20, { icd10: 'E11.9', status: 'DENIED', carc: 'CO-11' }),
      ...many(10, { icd10: 'E11.65', status: 'PAID' }),
    ]
    const s = codeSignals({ payer: 'Aetna', cpt: '99213', icd10: 'E11.9' }, rows)
    expect(s.candidates[0]).toMatchObject({ icd10: 'E11.65', paidRate: 100, n: 10 })
    expect(s.candidates.find(c => c.icd10 === 'E11.9')).toMatchObject({ current: true, paidRate: 0 })
  })

  it('prefers a well-evidenced rate over a perfect one-off', () => {
    const rows = [
      ...many(1, { icd10: 'E78.5', status: 'PAID' }),
      ...many(40, { icd10: 'E11.65', status: 'PAID' }),
    ]
    const s = codeSignals({ payer: 'Aetna', cpt: '99213', icd10: null }, rows)
    // Both are 100%; the tie breaks on sample size.
    expect(s.candidates[0].icd10).toBe('E11.65')
  })

  it('ranks a thin perfect score below a solid imperfect one', () => {
    // The top of a list headed "diagnoses your practice has been paid for" is
    // read as the recommendation whatever the small print says, so a 100%-of-one
    // must not sit above a 67%-of-thirty.
    const rows = [
      ...many(1, { icd10: 'G82.20', status: 'PAID' }),
      ...many(20, { icd10: 'I69.354', status: 'PAID' }),
      ...many(10, { icd10: 'I69.354', status: 'DENIED', carc: 'CO-11' }),
    ]
    const s = codeSignals({ payer: 'Aetna', cpt: '99213', icd10: null }, rows)
    expect(s.candidates[0]).toMatchObject({ icd10: 'I69.354', n: 30, thin: false })
    expect(s.candidates[1]).toMatchObject({ icd10: 'G82.20', paidRate: 100, thin: true })
  })

  it('carries a sample size on every candidate', () => {
    const s = codeSignals({ payer: 'Aetna', cpt: '99213', icd10: 'E11.9' }, many(7))
    for (const c of s.candidates) expect(c.n).toBeGreaterThan(0)
  })

  it('says so when there is nothing to compare against', () => {
    const s = codeSignals({ payer: 'Aetna', cpt: '99213', icd10: 'E11.9' }, [])
    expect(s.candidates).toEqual([])
    expect(s.limits.join(' ')).toContain('No settled claims')
  })
})

describe('signalsHash', () => {
  it('changes when the facts a review was based on change', () => {
    const rows = many(8)
    const before = signalsHash(codeSignals({ payer: 'Aetna', cpt: '99213', icd10: 'E11.9' }, rows))
    const after = signalsHash(codeSignals({ payer: 'Aetna', cpt: '99213', icd10: 'E11.65' }, rows))
    expect(before).not.toBe(after)
  })

  it('is stable for the same facts', () => {
    const rows = many(8)
    const a = signalsHash(codeSignals({ payer: 'Aetna', cpt: '99213', icd10: 'E11.9' }, rows))
    const b = signalsHash(codeSignals({ payer: 'Aetna', cpt: '99213', icd10: 'E11.9' }, rows))
    expect(a).toBe(b)
  })
})

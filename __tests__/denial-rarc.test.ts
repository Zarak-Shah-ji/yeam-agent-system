import { describe, it, expect } from 'vitest'
import { extractRarcs, isVague, refineDenial, refinementBrief } from '@/lib/denials/rarc'
import { lookupCarc, triageRow } from '@/lib/denials/triage'

describe('extractRarcs', () => {
  it('finds remark codes inside remittance prose', () => {
    expect(extractRarcs('Claim lacks information. N290 Missing rendering provider NPI')).toEqual([
      'N290',
    ])
  })

  it('finds several, in the order they appear, without duplicates', () => {
    expect(extractRarcs('N290 and M76 and N290 again')).toEqual(['N290', 'M76'])
  })

  it('handles the MA prefix', () => {
    expect(extractRarcs('MA130 - incomplete claim')).toEqual(['MA130'])
  })

  it('is case insensitive but normalises upward', () => {
    expect(extractRarcs('n290 missing npi')).toEqual(['N290'])
  })

  it('returns nothing for empty or absent text', () => {
    expect(extractRarcs(null)).toEqual([])
    expect(extractRarcs('')).toEqual([])
    expect(extractRarcs('no codes in this sentence at all')).toEqual([])
  })

  it('does not mistake an ICD-10 code for a remark code', () => {
    // Denial reason text very often carries the diagnosis. M54.16 is dorsalgia,
    // not a remark code, and the decimal point is a word boundary.
    expect(extractRarcs('Denied for dx M54.16')).toEqual([])
    expect(extractRarcs('N18.3 chronic kidney disease')).toEqual([])
  })

  it('still reads a remark code that ends a sentence', () => {
    expect(extractRarcs('Diagnosis is missing. M76.')).toEqual(['M76'])
  })
})

describe('isVague', () => {
  it('treats the codes that leave the next step undetermined as vague', () => {
    expect(isVague('CO-16')).toBe(true)
    expect(isVague('16')).toBe(true)
    expect(isVague('co 16')).toBe(true)
    expect(isVague('CO-97')).toBe(true)
  })

  it('leaves self-explanatory codes alone', () => {
    // A CO-50 already tells the biller it is a necessity argument. Decorating it
    // adds noise.
    expect(isVague('CO-50')).toBe(false)
    expect(isVague('CO-29')).toBe(false)
  })
})

describe('refineDenial', () => {
  it('turns a vague CO-16 into the specific defect from the remark code', () => {
    // The exact failure a billing manager named: "if the denial is something
    // vague like CO 16 it has no specific way to fix it and fails then and there".
    const r = refineDenial({
      carc: 'CO-16',
      reason: 'Claim/service lacks information. N290',
    })
    expect(r).not.toBeNull()
    expect(r!.rarc).toBe('N290')
    expect(r!.cause).toMatch(/NPI/i)
    expect(r!.action).toMatch(/resubmit/i)
    expect(r!.source).toBe('remark-code')
  })

  it('flags the codes that carry no appeal rights', () => {
    const r = refineDenial({ carc: 'CO-16', reason: 'MA130 incomplete information' })
    expect(r!.noAppealRights).toBe(true)
    expect(r!.action).toMatch(/do not appeal/i)
  })

  it('falls back to the payer wording when there is no remark code', () => {
    const r = refineDenial({
      carc: 'CO-16',
      reason: 'Missing rendering provider NPI on the claim',
    })
    expect(r).not.toBeNull()
    expect(r!.rarc).toBeNull()
    expect(r!.source).toBe('reason-text')
    expect(r!.cause).toMatch(/NPI/i)
  })

  it('prefers a real remark code over an inference from prose', () => {
    const r = refineDenial({
      carc: 'CO-16',
      reason: 'Something about a modifier, but the code says M76',
    })
    expect(r!.rarc).toBe('M76')
    expect(r!.source).toBe('remark-code')
  })

  it('returns null rather than inventing a cause', () => {
    // Saying nothing is a real answer. Guessing is what the competitor does.
    expect(refineDenial({ carc: 'CO-16', reason: 'Denied' })).toBeNull()
    expect(refineDenial({ carc: 'CO-16', reason: null })).toBeNull()
    expect(refineDenial({ carc: 'CO-16' })).toBeNull()
  })

  it('leaves non-vague codes alone even when a remark code is present', () => {
    expect(refineDenial({ carc: 'CO-50', reason: 'N290 whatever' })).toBeNull()
  })

  it('recognises the common missing-information causes from wording alone', () => {
    const cases: [string, RegExp][] = [
      ['Prior authorization not on file', /authorization/i],
      ['Missing modifier for this procedure', /modifier/i],
      ['Primary insurance EOB not received', /EOB/i],
      ['Medical records were not received', /documentation/i],
      ['Invalid place of service code', /place of service/i],
      ['NDC number missing for drug billed', /NDC/i],
    ]
    for (const [reason, expected] of cases) {
      const r = refineDenial({ carc: 'CO-16', reason })
      expect(r, `expected a refinement for: ${reason}`).not.toBeNull()
      expect(r!.cause).toMatch(expected)
    }
  })
})

describe('refinement does not contradict triage', () => {
  it('leaves the remedy to the CARC table', () => {
    // The refinement layer sharpens the note; it must never restate the remedy,
    // because the CARC table is the copy shared with the free browser tool.
    const today = new Date(2026, 7, 31)
    const triaged = triageRow(
      {
        carc: 'CO-16',
        billed: 500,
        denialDate: new Date(2026, 7, 1),
        payer: 'Aetna',
        reason: 'N290 missing NPI',
      },
      today,
    )
    expect(triaged.remedy).toBe('corrected_claim')
    expect(lookupCarc('CO-16')?.remedy).toBe('corrected_claim')
  })
})

describe('refinementBrief', () => {
  it('composes a single line for the drafting prompt', () => {
    const r = refineDenial({ carc: 'CO-16', reason: 'N290' })
    const brief = refinementBrief(r)
    expect(brief).toContain('N290')
    expect(brief).toMatch(/NPI/i)
  })

  it('warns the drafter when the payer allows no appeal', () => {
    const brief = refinementBrief(refineDenial({ carc: 'CO-16', reason: 'MA130' }))
    expect(brief).toMatch(/NO APPEAL RIGHTS/i)
  })

  it('is null when there is nothing to say', () => {
    expect(refinementBrief(null)).toBeNull()
  })
})

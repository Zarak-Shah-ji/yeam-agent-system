import { describe, it, expect } from 'vitest'
import {
  findPlaceholders,
  mergeLetter,
  ownerOf,
  unresolvedPlaceholders,
} from '@/lib/appeals/merge'

/**
 * The merge is what makes a de-identified draft into a sendable letter, and it
 * runs in the browser precisely so the patient's details never reach a server.
 * These tests pin the two things that would quietly break that: which tokens
 * count as fields, and what happens to the ones nobody filled in.
 */

describe('findPlaceholders', () => {
  it('finds the identifier block the drafting prompt is told to leave', () => {
    const body = 'Re: [PATIENT NAME], member [MEMBER ID], DOB [DATE OF BIRTH]'
    expect(findPlaceholders(body).map(p => p.key)).toEqual([
      'PATIENT NAME',
      'MEMBER ID',
      'DATE OF BIRTH',
    ])
  })

  it('returns each slot once, in document order', () => {
    const body = '[PRACTICE NAME] writes about [PATIENT NAME]. Signed, [PRACTICE NAME]'
    expect(findPlaceholders(body).map(p => p.key)).toEqual(['PRACTICE NAME', 'PATIENT NAME'])
  })

  it('ignores ordinary bracketed prose and citations', () => {
    // A letter citing statute must not sprout an input box for it.
    const body = 'Under [1 TAC §354.1003] the claim is timely [sic] per the manual.'
    expect(findPlaceholders(body)).toEqual([])
  })

  it('finds nothing in a letter that needs nothing', () => {
    expect(findPlaceholders('A complete letter with no slots at all.')).toEqual([])
  })

  it('offers an unrecognised slot as a field rather than leaving it unfillable', () => {
    const [found] = findPlaceholders('Referred by [REFERRING PROVIDER].')
    expect(found.key).toBe('REFERRING PROVIDER')
    expect(found.owner).toBe('other')
    expect(found.label).toBe('Referring provider')
  })
})

describe('ownerOf', () => {
  it('classifies patient identifiers as patient-owned, so they stay in the browser', () => {
    expect(ownerOf('PATIENT NAME')).toBe('patient')
    expect(ownerOf('MEMBER ID')).toBe('patient')
    expect(ownerOf('DATE OF BIRTH')).toBe('patient')
  })

  it('classifies the billing provider as practice-owned, which is safe to store', () => {
    expect(ownerOf('PRACTICE NAME')).toBe('practice')
    expect(ownerOf('NPI')).toBe('practice')
    expect(ownerOf('TIN')).toBe('practice')
  })
})

describe('mergeLetter', () => {
  it('substitutes what it is given', () => {
    expect(mergeLetter('Re: [PATIENT NAME]', { 'PATIENT NAME': 'Jane Doe' })).toBe('Re: Jane Doe')
  })

  it('leaves an unfilled slot bracketed rather than blanking it', () => {
    // "Re: , member ID" reads as a rendering bug and a payer rejects it.
    // "[MEMBER ID]" reads as unfinished, which is the correct signal.
    expect(mergeLetter('Re: [PATIENT NAME], [MEMBER ID]', { 'PATIENT NAME': 'Jane Doe' })).toBe(
      'Re: Jane Doe, [MEMBER ID]',
    )
  })

  it('treats whitespace as unfilled', () => {
    expect(mergeLetter('Re: [PATIENT NAME]', { 'PATIENT NAME': '   ' })).toBe('Re: [PATIENT NAME]')
  })

  it('trims what it does substitute', () => {
    expect(mergeLetter('Re: [PATIENT NAME]', { 'PATIENT NAME': '  Jane Doe ' })).toBe('Re: Jane Doe')
  })

  it('replaces every occurrence of a repeated slot', () => {
    expect(mergeLetter('[PRACTICE NAME] … [PRACTICE NAME]', { 'PRACTICE NAME': 'Bay Clinic' })).toBe(
      'Bay Clinic … Bay Clinic',
    )
  })
})

describe('unresolvedPlaceholders', () => {
  it('reports only what is still missing after a merge', () => {
    const body = 'Re: [PATIENT NAME], member [MEMBER ID]. Signed, [PRACTICE NAME]'
    const left = unresolvedPlaceholders(body, {
      'PATIENT NAME': 'Jane Doe',
      'PRACTICE NAME': 'Bay Clinic',
    })
    expect(left.map(p => p.key)).toEqual(['MEMBER ID'])
  })

  it('is empty once the letter is complete', () => {
    expect(unresolvedPlaceholders('Re: [PATIENT NAME]', { 'PATIENT NAME': 'Jane Doe' })).toEqual([])
  })
})

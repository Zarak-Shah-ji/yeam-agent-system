import { describe, expect, it } from 'vitest'
import { PERMITTED_DETAIL, isRecordable } from '@/lib/usage/events'

/**
 * The rule this file exists for: `detail` is a String column on a table that
 * must never hold anything identifying, and a whitelist is the only thing
 * standing between it and a claim number. A schema cannot express that, so it
 * is expressed here and asserted rather than reviewed.
 */
describe('isRecordable', () => {
  it('accepts the pairs the product actually fires', () => {
    expect(isRecordable('CLAIM_OPENED', null)).toBe(true)
    expect(isRecordable('CLAIM_OPENED', undefined)).toBe(true)
    expect(isRecordable('CLAIM_SECTION_OPENED', 'denial')).toBe(true)
    expect(isRecordable('CLAIM_SECTION_OPENED', 'figures')).toBe(true)
    expect(isRecordable('CLAIM_TO_DRAFTER', 'list')).toBe(true)
    expect(isRecordable('CLAIM_TO_DRAFTER', 'detail')).toBe(true)
  })

  it('rejects an event nobody planned for', () => {
    expect(isRecordable('CLAIM_DELETED', null)).toBe(false)
    expect(isRecordable('', null)).toBe(false)
    // Prototype keys are not event names. `'toString' in PERMITTED_DETAIL` is
    // true for a plain object literal, which would let this through if the
    // membership test were the only check.
    expect(isRecordable('toString', null)).toBe(false)
    expect(isRecordable('constructor', 'list')).toBe(false)
  })

  it('refuses a claim number wherever one could be smuggled in', () => {
    // The failure this whole module prevents: a caller reaching for "which
    // claim was it" and putting it in the one free column.
    expect(isRecordable('CLAIM_OPENED', 'CLM-88213')).toBe(false)
    expect(isRecordable('CLAIM_SECTION_OPENED', 'CLM-88213')).toBe(false)
    expect(isRecordable('CLAIM_TO_DRAFTER', 'CLM-88213')).toBe(false)
  })

  it('matches exactly, so a near-miss is dropped rather than stored', () => {
    // Anything approximate here — a prefix test, a trim, a lowercase — is a way
    // for an identifier to arrive slightly wrong and be kept anyway.
    expect(isRecordable('CLAIM_SECTION_OPENED', 'Denial')).toBe(false)
    expect(isRecordable('CLAIM_SECTION_OPENED', ' denial')).toBe(false)
    expect(isRecordable('CLAIM_SECTION_OPENED', 'denial:CLM-1')).toBe(false)
    expect(isRecordable('claim_opened', null)).toBe(false)
  })

  it('requires a detail where the event is meaningless without one', () => {
    // A jump to the drafter with no origin cannot answer the one question the
    // event was added for — which of the two routes people actually take.
    expect(isRecordable('CLAIM_TO_DRAFTER', null)).toBe(false)
    expect(isRecordable('CLAIM_SECTION_OPENED', null)).toBe(false)
  })

  it('takes no detail where the only available qualifier would be a claim', () => {
    expect(PERMITTED_DETAIL.CLAIM_OPENED).toEqual([])
    expect(isRecordable('CLAIM_OPENED', 'anything')).toBe(false)
  })

  it('keeps the section list aligned with the sections that exist', () => {
    // SectionId in components/claims/detail/types.ts, plus the two disclosures
    // that are not in the URL. A section renamed without touching this would
    // silently stop being counted.
    expect([...PERMITTED_DETAIL.CLAIM_SECTION_OPENED].sort()).toEqual([
      'codes',
      'denial',
      'figures',
      'history',
      'work',
    ])
  })
})

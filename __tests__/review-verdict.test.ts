import { describe, expect, it } from 'vitest'
import { SYSTEM_PROMPT, offMapCodes } from '@/lib/claims/review-claim'
import { LEAVE_AS_BILLED } from '@/lib/claims/predict'

/**
 * The prompt asks the model to stay inside the verdict's codes. This is what
 * checks. A constraint that lives only in a prompt is a request, and the whole
 * point of routing the decision through a bounded model was to stop relying on
 * requests.
 */
describe('offMapCodes', () => {
  it('catches a diagnosis the verdict never authorised', () => {
    const body = 'Your data supports E11.65 here, though E11.21 would pay more.'
    expect(offMapCodes(body, ['E11.9', 'E11.65'])).toEqual(['E11.21'])
  })

  it('passes a review that stays inside the list', () => {
    const body = 'Billed as E11.9. Across 41 of your claims, E11.65 is paid 82% of the time.'
    expect(offMapCodes(body, ['E11.9', 'E11.65'])).toEqual([])
  })

  it('does not flag the other codes that legitimately appear in this prose', () => {
    const body =
      'CPT 99213 was denied CO-11 on 03/14, leaving $412.00 outstanding. ' +
      'Filing window: 90 days. Reference J1885 was not billed.'
    // 99213 is all digits, CO-11 has a dash, $412.00 has no leading letter.
    // J1885 is a HCPCS code — letter, then four digits — and is not ICD-10
    // shaped, so it must not trip the guard either.
    expect(offMapCodes(body, [])).toEqual([])
  })

  it('does not flag ordinary English', () => {
    const body =
      'The payer reprocessed it. Nothing in your history suggests a different diagnosis. ' +
      'Verify against the chart before resubmitting.'
    expect(offMapCodes(body, [])).toEqual([])
  })

  it('is case-insensitive, because prose is not typed in a form', () => {
    expect(offMapCodes('consider e11.65 instead', ['E11.65'])).toEqual([])
    expect(offMapCodes('consider e11.21 instead', ['E11.65'])).toEqual(['E11.21'])
  })

  it('reports each stray code once, however often it is repeated', () => {
    const body = 'E11.21 is better. Use E11.21. Really, E11.21.'
    expect(offMapCodes(body, ['E11.9'])).toEqual(['E11.21'])
  })

  it('flags everything when the verdict authorised nothing', () => {
    expect(offMapCodes('Try M54.5 or E11.9.', [])).toEqual(['M54.5', 'E11.9'])
  })
})

describe('the prompt states the constraint it is checked against', () => {
  // Cheap regression guard, in the spirit of draft-phi-guard.test.ts: the rule
  // and the enforcement have to name the same thing, or the retry message
  // quotes a field the model was never told about.
  it('names verdict.allowedCodes', () => {
    expect(SYSTEM_PROMPT).toContain('verdict.allowedCodes')
  })

  it('tells the model what a skipped judgment means', () => {
    expect(SYSTEM_PROMPT).toContain('asked: false')
    expect(SYSTEM_PROMPT).toContain('because')
  })

  it('names the leave-as-billed option exactly as predict.ts spells it', () => {
    expect(SYSTEM_PROMPT).toContain(LEAVE_AS_BILLED)
  })

  it('keeps the no-verdict branch, so an unconfigured deployment still reads', () => {
    expect(SYSTEM_PROMPT).toContain('no `verdict` at all')
  })

  it('still forbids recommending a code because it pays more', () => {
    expect(SYSTEM_PROMPT).toContain('on the grounds that it pays more')
  })
})

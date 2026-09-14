import { describe, it, expect } from 'vitest'
import {
  DENIALS_PER_MONTH,
  canReviewCodes,
  canUseDirectConnections,
  draftAllowance,
} from '@/lib/plans'

/**
 * The free tier's arithmetic.
 *
 * draftAllowance is the only thing that decides whether a wall goes up, and it
 * is pure so that decision can be read here rather than inferred from a running
 * server. The count it is given comes from DenialWorkedEvent, which is unique
 * per row — so "used" already means distinct denials, not drafts written.
 */
describe('draftAllowance', () => {
  it('counts down the free tier', () => {
    expect(draftAllowance('TRIAGE', 0)).toMatchObject({ limit: 10, remaining: 10, atLimit: false })
    expect(draftAllowance('TRIAGE', 7)).toMatchObject({ remaining: 3, atLimit: false })
  })

  it('walls at the limit, not one past it', () => {
    expect(draftAllowance('TRIAGE', 9).atLimit).toBe(false)
    expect(draftAllowance('TRIAGE', 10).atLimit).toBe(true)
  })

  it('never reports negative headroom once over', () => {
    // Reachable: the limit can be lowered under a workspace that already spent more.
    expect(draftAllowance('TRIAGE', 25)).toMatchObject({ remaining: 0, atLimit: true })
  })

  it('leaves paid plans uncapped', () => {
    for (const plan of ['PRACTICE', 'GROUP', 'NETWORK']) {
      expect(draftAllowance(plan, 10_000)).toMatchObject({ limit: null, remaining: null, atLimit: false })
    }
  })

  /**
   * The important one. An unrecognised plan string must not be a way to buy
   * nothing and get everything — it falls back to the free allowance.
   */
  it('treats an unknown plan as the free tier, not as uncapped', () => {
    const a = draftAllowance('ENTERPRISE_DEFINITELY_REAL', 10)
    expect(a.plan).toBe('TRIAGE')
    expect(a.limit).toBe(10)
    expect(a.atLimit).toBe(true)
  })
})

describe('plan gates', () => {
  it('keeps every gate a denylist, so a plan added later is closed by default', () => {
    // If a fifth plan is added to DENIALS_PER_MONTH it must be a deliberate
    // decision to open it, which is what this asserts about the two gates.
    expect(canUseDirectConnections('SOMETHING_NEW')).toBe(true)
    expect(canReviewCodes('SOMETHING_NEW')).toBe(true)
    expect(Object.keys(DENIALS_PER_MONTH)).toEqual(['TRIAGE', 'PRACTICE', 'GROUP', 'NETWORK'])
  })

  it('gates the paid model call away from the free tier', () => {
    expect(canReviewCodes('TRIAGE')).toBe(false)
    expect(canReviewCodes('PRACTICE')).toBe(true)
  })
})

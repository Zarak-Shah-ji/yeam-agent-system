import { describe, it, expect, afterEach } from 'vitest'
import { isEntitling, planForPrice, planFromSubscription } from '@/lib/subscription'

/**
 * What Stripe says, turned into what the customer may do.
 *
 * The webhook is the hardest path in this feature to exercise by hand, so the
 * part of it that decides entitlement is pure and is asserted here instead.
 */

const PRICE = 'price_practice_test'
const original = process.env.STRIPE_PRICE_PRACTICE

afterEach(() => {
  process.env.STRIPE_PRICE_PRACTICE = original
})

describe('planForPrice', () => {
  it('sells Practice and nothing else', () => {
    process.env.STRIPE_PRICE_PRACTICE = PRICE
    expect(planForPrice(PRICE)).toBe('PRACTICE')
    // GROUP and NETWORK are contracts, not a checkout button.
    expect(planForPrice('price_some_other_thing')).toBeNull()
    expect(planForPrice(null)).toBeNull()
  })

  it('does not match when the price is unconfigured', () => {
    // Guards the footgun where an unset env var makes undefined === undefined
    // and every unknown price silently grants Practice.
    delete process.env.STRIPE_PRICE_PRACTICE
    expect(planForPrice(undefined)).toBeNull()
    expect(planForPrice('anything')).toBeNull()
  })
})

describe('isEntitling', () => {
  it('keeps access while a failed card is still being retried', () => {
    expect(isEntitling('active')).toBe(true)
    expect(isEntitling('trialing')).toBe(true)
    expect(isEntitling('past_due')).toBe(true)
  })

  it('drops access once Stripe has given up', () => {
    for (const status of ['canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused']) {
      expect(isEntitling(status)).toBe(false)
    }
    expect(isEntitling(null)).toBe(false)
  })
})

describe('planFromSubscription', () => {
  it('grants Practice on an entitling status and the right price', () => {
    process.env.STRIPE_PRICE_PRACTICE = PRICE
    expect(planFromSubscription('active', PRICE)).toBe('PRACTICE')
    expect(planFromSubscription('past_due', PRICE)).toBe('PRACTICE')
  })

  it('falls back to TRIAGE rather than leaving a cancelled plan in place', () => {
    process.env.STRIPE_PRICE_PRACTICE = PRICE
    expect(planFromSubscription('canceled', PRICE)).toBe('TRIAGE')
    expect(planFromSubscription('unpaid', PRICE)).toBe('TRIAGE')
  })

  it('does not grant anything for a price it does not recognise', () => {
    process.env.STRIPE_PRICE_PRACTICE = PRICE
    expect(planFromSubscription('active', 'price_unknown')).toBe('TRIAGE')
  })
})

import { describe, it, expect, afterEach } from 'vitest'
import { isEntitling, planForPrice, planFromSubscription, scheduledCancellation, shouldApplySubscription } from '@/lib/subscription'

/**
 * What Stripe says, turned into what the customer may do.
 *
 * The webhook is the hardest path in this feature to exercise by hand, so the
 * part of it that decides entitlement is pure and is asserted here instead.
 */

const PRICE = 'price_practice_test'
const GROUP_PRICE = 'price_group_test'
const original = process.env.STRIPE_PRICE_PRACTICE
const originalGroup = process.env.STRIPE_PRICE_GROUP

afterEach(() => {
  process.env.STRIPE_PRICE_PRACTICE = original
  process.env.STRIPE_PRICE_GROUP = originalGroup
})

describe('planForPrice', () => {
  it('sells Practice and nothing else', () => {
    process.env.STRIPE_PRICE_PRACTICE = PRICE
    expect(planForPrice(PRICE)).toBe('PRACTICE')
    // GROUP and NETWORK are contracts, not a checkout button.
    expect(planForPrice('price_some_other_thing')).toBeNull()
    expect(planForPrice(null)).toBeNull()
  })

  it('maps a Group subscription created from the dashboard', () => {
    // Group is not sold through checkout, but its events still reach the webhook.
    process.env.STRIPE_PRICE_PRACTICE = PRICE
    process.env.STRIPE_PRICE_GROUP = GROUP_PRICE
    expect(planForPrice(GROUP_PRICE)).toBe('GROUP')
    expect(planFromSubscription('active', GROUP_PRICE)).toBe('GROUP')
  })

  it('does not match Group while its price is unconfigured', () => {
    process.env.STRIPE_PRICE_PRACTICE = PRICE
    delete process.env.STRIPE_PRICE_GROUP
    expect(planForPrice(GROUP_PRICE)).toBeNull()
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

describe('shouldApplySubscription', () => {
  const CURRENT = { subscriptionId: 'sub_new' }

  it('applies the first subscription a workspace ever has', () => {
    expect(shouldApplySubscription({ subscriptionId: null }, { subscriptionId: 'sub_new', status: 'active' })).toBe(true)
  })

  it('applies every change to the subscription on file, including its cancellation', () => {
    expect(shouldApplySubscription(CURRENT, { subscriptionId: 'sub_new', status: 'past_due' })).toBe(true)
    expect(shouldApplySubscription(CURRENT, { subscriptionId: 'sub_new', status: 'canceled' })).toBe(true)
  })

  /** The bug this exists for, as reproduced against Stripe test mode. */
  it('ignores a late cancellation of an older subscription', () => {
    expect(shouldApplySubscription(CURRENT, { subscriptionId: 'sub_old', status: 'canceled' })).toBe(false)
    expect(shouldApplySubscription(CURRENT, { subscriptionId: 'sub_old', status: 'unpaid' })).toBe(false)
  })

  it('lets a new paying subscription supersede the one on file', () => {
    expect(shouldApplySubscription({ subscriptionId: 'sub_old' }, { subscriptionId: 'sub_new', status: 'active' })).toBe(true)
  })
})

describe('scheduledCancellation', () => {
  const END = new Date('2026-10-23T18:10:15Z')
  const AT = Math.floor(END.getTime() / 1000)

  it('reads the date the billing portal sets', () => {
    // The shape Stripe's portal produced in test mode: a date, and the boolean false.
    expect(
      scheduledCancellation({ status: 'active', cancelAt: AT, cancelAtPeriodEnd: false, periodEnd: END }),
    ).toEqual(END)
  })

  it('reads the older period-end flag when no date is set', () => {
    expect(
      scheduledCancellation({ status: 'active', cancelAt: null, cancelAtPeriodEnd: true, periodEnd: END }),
    ).toEqual(END)
  })

  it('reports nothing pending on a subscription that is simply renewing', () => {
    expect(
      scheduledCancellation({ status: 'active', cancelAt: null, cancelAtPeriodEnd: false, periodEnd: END }),
    ).toBeNull()
  })

  it('reports nothing pending once the cancellation has happened', () => {
    expect(
      scheduledCancellation({ status: 'canceled', cancelAt: AT, cancelAtPeriodEnd: false, periodEnd: END }),
    ).toBeNull()
  })
})

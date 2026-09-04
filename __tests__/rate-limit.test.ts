import { describe, it, expect } from 'vitest'
import { createRateLimiter, callerKey } from '@/lib/appeals/rate-limit'

/**
 * The limiter is the only quota on three model-backed endpoints, two of them
 * reachable by anyone holding a secret held by a public marketing site. It had
 * no coverage while it sat unimported; it has callers now.
 */
describe('createRateLimiter', () => {
  it('allows up to max, then refuses', () => {
    const limiter = createRateLimiter('t-basic', 3)
    for (let i = 0; i < 3; i++) {
      expect(limiter.limited('a')).toBe(false)
      limiter.record('a')
    }
    expect(limiter.limited('a')).toBe(true)
  })

  it('does not consume quota until record() is called', () => {
    // The point of splitting check from record: a rejected upload (wrong
    // format, too large) never reaches the model and must not cost the caller.
    const limiter = createRateLimiter('t-norecord', 2)
    for (let i = 0; i < 10; i++) expect(limiter.limited('a')).toBe(false)
  })

  it('meters each caller separately', () => {
    const limiter = createRateLimiter('t-callers', 1)
    limiter.record('a')
    expect(limiter.limited('a')).toBe(true)
    expect(limiter.limited('b')).toBe(false)
  })

  it('gives each limiter its own bucket', () => {
    // Otherwise drafting a letter would eat the revision quota.
    const one = createRateLimiter('t-iso-1', 1)
    const two = createRateLimiter('t-iso-2', 1)
    one.record('a')
    expect(one.limited('a')).toBe(true)
    expect(two.limited('a')).toBe(false)
  })
})

describe('callerKey', () => {
  const req = (headers: Record<string, string>) => new Request('https://x/y', { headers })

  it('prefers the forwarded client ip', () => {
    // The public endpoints are called server-to-server, so x-forwarded-for is
    // the marketing site's lambda — every visitor would share one bucket.
    expect(
      callerKey(req({ 'x-yeam-client-ip': '9.9.9.9', 'x-forwarded-for': '1.1.1.1' })),
    ).toBe('9.9.9.9')
  })

  it('falls back to the connecting address, first hop only', () => {
    expect(callerKey(req({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2' }))).toBe('1.1.1.1')
  })

  it('degrades to a shared bucket rather than to no limit', () => {
    expect(callerKey(req({}))).toBe('unknown')
  })
})

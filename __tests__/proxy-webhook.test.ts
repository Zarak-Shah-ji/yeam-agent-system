import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

/**
 * Stripe's webhook must reach its handler without a session.
 *
 * proxy.ts answers every signed-out /api/* request with 401 unless the path is
 * on its allowlist, and Stripe never has a session. Until the webhook was
 * listed there, every real event was refused: a customer paid, Stripe retried
 * for three days, and the workspace stayed on TRIAGE. Found only by sending a
 * real test-mode event — nothing else in the suite exercises the proxy.
 *
 * Read as text, like auth-config.test.ts, because proxy.ts is wrapped in
 * NextAuth and cannot be imported into a node test.
 */
const PROXY = readFileSync(join(__dirname, '..', 'proxy.ts'), 'utf8')
const WEBHOOK = '/api/stripe/webhook'

describe('the Stripe webhook gets past the proxy', () => {
  it('is on the allowlist, by exact path', () => {
    expect(PROXY).toContain(`pathname === '${WEBHOOK}'`)
  })

  it('is allowlisted before the unauthenticated-API 401', () => {
    const allowed = PROXY.indexOf(`pathname === '${WEBHOOK}'`)
    const refused = PROXY.indexOf('status: 401')
    expect(allowed).toBeGreaterThan(-1)
    expect(refused).toBeGreaterThan(-1)
    expect(allowed).toBeLessThan(refused)
  })

  it('names a route that exists', () => {
    // A renamed handler would leave this allowlist entry pointing at nothing
    // and the real webhook 401ing again.
    expect(existsSync(join(__dirname, '..', 'app', 'api', 'stripe', 'webhook', 'route.ts'))).toBe(true)
  })
})

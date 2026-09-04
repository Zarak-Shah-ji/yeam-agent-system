import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const PROJECT_ROOT = join(__dirname, '..')
const authConfig = readFileSync(join(PROJECT_ROOT, 'lib/auth.ts'), 'utf8')
const envExample = readFileSync(join(PROJECT_ROOT, '.env.example'), 'utf8')

describe('Auth configuration — error=Configuration regression guard', () => {
  it('does not register a GitHub provider', () => {
    // Sign-in is Google-only as of 30d518d. This used to assert the opposite
    // and had been failing ever since. Registering a provider whose credentials
    // are not configured is what produced error=Configuration on click, so the
    // guard now runs the other way.
    expect(authConfig).not.toMatch(/GitHub\(/)
  })

  it('always registers Google provider (not conditionally excluded)', () => {
    expect(authConfig).not.toMatch(/if.*GOOGLE_CLIENT_ID.*\?.*\[Google/)
    expect(authConfig).not.toMatch(/process\.env\.GOOGLE_CLIENT_ID &&/)
    expect(authConfig).toMatch(/Google\(/)
  })

  it('supports NextAuth v5 standard env var names for Google (AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET)', () => {
    expect(authConfig).toMatch(/AUTH_GOOGLE_ID/)
    expect(authConfig).toMatch(/AUTH_GOOGLE_SECRET/)
  })

  it('falls back to legacy GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET via ?? operator', () => {
    expect(authConfig).toMatch(/AUTH_GOOGLE_ID.*\?\?.*GOOGLE_CLIENT_ID/)
    expect(authConfig).toMatch(/AUTH_GOOGLE_SECRET.*\?\?.*GOOGLE_CLIENT_SECRET/)
  })

  it('reads AUTH_SECRET for NextAuth v5 (not NEXTAUTH_SECRET)', () => {
    expect(authConfig).toMatch(/process\.env\.AUTH_SECRET/)
    expect(authConfig).not.toMatch(/NEXTAUTH_SECRET/)
  })

  it('wires up the PrismaAdapter so OAuth users/accounts persist to the database', () => {
    expect(authConfig).toMatch(/@auth\/prisma-adapter/)
    expect(authConfig).toMatch(/adapter:\s*PrismaAdapter\(prisma\)/)
  })

  it('keeps JWT session strategy (required for the Credentials provider alongside the adapter)', () => {
    expect(authConfig).toMatch(/strategy:\s*'jwt'/)
  })

  it('enables email account linking so OAuth works for existing credential users', () => {
    const linkingCount = (authConfig.match(/allowDangerousEmailAccountLinking:\s*true/g) ?? []).length
    expect(linkingCount).toBeGreaterThanOrEqual(1)
  })

  it('records that a sign-in happened', () => {
    // JWT sessions mean the sessions table is never written, so this stamp is
    // the only record of who has used the app. Losing it is silent.
    expect(authConfig).toMatch(/lastLoginAt/)
  })

  it('provisions a workspace for OAuth signups', () => {
    // The Prisma adapter creates the user row and knows nothing about orgs. A
    // user without one cannot reach any org-scoped query, so an OAuth signup
    // that skips this is an account that silently cannot use the product.
    expect(authConfig).toMatch(/createUser/)
    expect(authConfig).toMatch(/ensureOrgForUser/)
  })
})

describe('.env.example — Vercel deployment requirements', () => {
  it('documents AUTH_SECRET as required', () => {
    expect(envExample).toMatch(/AUTH_SECRET/)
  })

  it('documents AUTH_URL for production deployment', () => {
    expect(envExample).toMatch(/AUTH_URL/)
  })

  it('documents NextAuth v5 standard OAuth names (AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET)', () => {
    expect(envExample).toMatch(/AUTH_GOOGLE_ID/)
    expect(envExample).toMatch(/AUTH_GOOGLE_SECRET/)
  })

  it('documents the Google OAuth callback URL for provider console setup', () => {
    expect(envExample).toMatch(/api\/auth\/callback\/google/)
  })
})

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

  it('records that a sign-in happened, including the first one', () => {
    // JWT sessions mean the sessions table is never written, so this stamp is
    // the only record of who has used the app. Losing it is silent.
    //
    // It has to be stamped from the signIn EVENT rather than the callback. The
    // callback is the gate deciding whether a new account may be created, so on
    // a first OAuth sign-in it runs before the adapter writes the row and its
    // existing-user branch never fires. Stamping from there left every Google
    // signup's first session unrecorded — lastLoginAt stayed null until the
    // person came back a second time. The event fires after the row exists, for
    // every provider.
    expect(authConfig).toMatch(/lastLoginAt/)

    const events = authConfig.slice(authConfig.indexOf('events: {'))
    expect(events).toMatch(/lastLoginAt/)
  })

  it('trusts Google that the address is verified', () => {
    // Google will not release an address it has not verified and reports that
    // as email_verified. Auth.js discards it — the OAuth branch of handle-login
    // calls createUser({ ...profile, emailVerified: null }) with the null last,
    // so a custom profile() mapping cannot survive it. The stamp therefore has
    // to happen after the row exists, in the events block, or every OAuth
    // account stays unverified forever despite arriving pre-verified.
    const events = authConfig.slice(authConfig.indexOf('events: {'))
    expect(events).toMatch(/email_verified/)
    expect(events).toMatch(/emailVerified/)
  })

  it('provisions a workspace for OAuth signups', () => {
    // The Prisma adapter creates the user row and knows nothing about orgs. A
    // user without one cannot reach any org-scoped query, so an OAuth signup
    // that skips this is an account that silently cannot use the product.
    expect(authConfig).toMatch(/createUser/)
    expect(authConfig).toMatch(/ensureOrgForUser/)
  })

  it('backfills a workspace on sign-in for an account that has none', () => {
    // The createUser event fires only on the sign-in that first creates or
    // links the account; every later sign-in returns before it. Provisioning
    // from there alone meant an account whose createUser was skipped or threw
    // stayed orgless forever, and orgProcedure refused every query with
    // FORBIDDEN — signed in, and able to reach nothing. The repair has to live
    // on a path that runs on EVERY sign-in, which is the signIn callback.
    const signInCallback = authConfig.slice(
      authConfig.indexOf('async signIn('),
      authConfig.indexOf('jwt({ token, user })'),
    )
    expect(signInCallback).toMatch(/orgId/)
    expect(signInCallback).toMatch(/ensureOrgForUser/)
  })

  it('never refuses a valid login because provisioning failed', () => {
    // Best-effort, like the lastLoginAt stamp above it: a workspace we could
    // not create is a bad first screen, not a reason to reject the sign-in.
    const signInCallback = authConfig.slice(
      authConfig.indexOf('async signIn('),
      authConfig.indexOf('jwt({ token, user })'),
    )
    expect(signInCallback).toMatch(/catch/)
  })
})

describe('Empty states — no dead ends for a signed-in account', () => {
  const noWorkspaceSource = readFileSync(
    join(PROJECT_ROOT, 'components/insights/NoWorkspace.tsx'),
    'utf8',
  )
  // Assert against what renders, not against the comments. The file explains at
  // length what this card used to say, and a guard that matched the
  // explanation would fail the moment someone documented the fix.
  const noWorkspace = noWorkspaceSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '')

  it('does not link anywhere that no longer routes', () => {
    // /demo stopped existing when the sample practice became data inside a
    // workspace rather than a section of its own. The card kept linking to it,
    // so the single button an orgless account was given returned a 404 — on
    // every section, because every section renders this card on FORBIDDEN.
    const links = noWorkspace.match(/href="[^"]*"/g) ?? []
    expect(links.length).toBeGreaterThan(0)
    expect(links).not.toContain('href="/demo"')
  })

  it('does not tell a signed-in reader to register', () => {
    // This card only ever renders behind an authenticated session, so "sign up
    // for a new account" is advice the reader cannot act on — it reads as a
    // broken login rather than as a workspace that is not ready.
    expect(noWorkspace).not.toMatch(/[Ss]ign up/)
  })

  it('points at the import screen', () => {
    expect(noWorkspace).toMatch(/href="\/connect"/)
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

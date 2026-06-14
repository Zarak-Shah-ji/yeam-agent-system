import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const PROJECT_ROOT = join(__dirname, '..')
const authConfig = readFileSync(join(PROJECT_ROOT, 'lib/auth.ts'), 'utf8')
const envExample = readFileSync(join(PROJECT_ROOT, '.env.example'), 'utf8')

describe('Auth configuration — error=Configuration regression guard', () => {
  it('always registers GitHub provider (not conditionally excluded)', () => {
    // Previously, GitHub was wrapped in a conditional and silently dropped
    // when GITHUB_CLIENT_ID wasn't set → error=Configuration on click
    expect(authConfig).not.toMatch(/if.*GITHUB_CLIENT_ID.*\?.*\[GitHub/)
    expect(authConfig).not.toMatch(/process\.env\.GITHUB_CLIENT_ID &&/)
    expect(authConfig).toMatch(/GitHub\(/)
  })

  it('always registers Google provider (not conditionally excluded)', () => {
    expect(authConfig).not.toMatch(/if.*GOOGLE_CLIENT_ID.*\?.*\[Google/)
    expect(authConfig).not.toMatch(/process\.env\.GOOGLE_CLIENT_ID &&/)
    expect(authConfig).toMatch(/Google\(/)
  })

  it('supports NextAuth v5 standard env var names for GitHub (AUTH_GITHUB_ID / AUTH_GITHUB_SECRET)', () => {
    expect(authConfig).toMatch(/AUTH_GITHUB_ID/)
    expect(authConfig).toMatch(/AUTH_GITHUB_SECRET/)
  })

  it('supports NextAuth v5 standard env var names for Google (AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET)', () => {
    expect(authConfig).toMatch(/AUTH_GOOGLE_ID/)
    expect(authConfig).toMatch(/AUTH_GOOGLE_SECRET/)
  })

  it('falls back to legacy GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET via ?? operator', () => {
    expect(authConfig).toMatch(/AUTH_GITHUB_ID.*\?\?.*GITHUB_CLIENT_ID/)
    expect(authConfig).toMatch(/AUTH_GITHUB_SECRET.*\?\?.*GITHUB_CLIENT_SECRET/)
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
    expect(linkingCount).toBeGreaterThanOrEqual(2)
  })
})

describe('.env.example — Vercel deployment requirements', () => {
  it('documents AUTH_SECRET as required', () => {
    expect(envExample).toMatch(/AUTH_SECRET/)
  })

  it('documents AUTH_URL for production deployment', () => {
    expect(envExample).toMatch(/AUTH_URL/)
  })

  it('documents NextAuth v5 standard OAuth names (AUTH_GITHUB_ID, AUTH_GITHUB_SECRET)', () => {
    expect(envExample).toMatch(/AUTH_GITHUB_ID/)
    expect(envExample).toMatch(/AUTH_GITHUB_SECRET/)
  })

  it('documents NextAuth v5 standard OAuth names (AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET)', () => {
    expect(envExample).toMatch(/AUTH_GOOGLE_ID/)
    expect(envExample).toMatch(/AUTH_GOOGLE_SECRET/)
  })

  it('documents the GitHub OAuth callback URL for provider console setup', () => {
    expect(envExample).toMatch(/api\/auth\/callback\/github/)
  })

  it('documents the Google OAuth callback URL for provider console setup', () => {
    expect(envExample).toMatch(/api\/auth\/callback\/google/)
  })
})

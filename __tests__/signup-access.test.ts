import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The signup gate.
 *
 * SIGNUP_ALLOWED_EMAILS decides who may create a NEW account, on both doors:
 * the tRPC signup mutation and Google auto-provisioning in the signIn callback.
 * The fail-closed default is the important property — an unset or malformed
 * value must never fall open — and "*" is the deliberate way to open it without
 * a code change.
 */

// Re-import per case: allowlist() reads process.env at call time, but the module
// is cached, so a stale import would carry the previous test's environment.
async function signupAllowed(value: string | undefined, email: string | null | undefined) {
  vi.resetModules()
  if (value === undefined) delete process.env.SIGNUP_ALLOWED_EMAILS
  else process.env.SIGNUP_ALLOWED_EMAILS = value
  const mod = await import('@/lib/signup-access')
  return mod.signupAllowed(email)
}

const ORIGINAL = process.env.SIGNUP_ALLOWED_EMAILS

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.SIGNUP_ALLOWED_EMAILS
  else process.env.SIGNUP_ALLOWED_EMAILS = ORIGINAL
})

describe('signupAllowed — fail-closed', () => {
  it('refuses everyone when the var is unset', async () => {
    expect(await signupAllowed(undefined, 'someone@example.com')).toBe(false)
  })

  it('refuses everyone when the var is empty or only separators', async () => {
    expect(await signupAllowed('', 'someone@example.com')).toBe(false)
    expect(await signupAllowed('   ', 'someone@example.com')).toBe(false)
    expect(await signupAllowed(',,,', 'someone@example.com')).toBe(false)
  })

  it('refuses a missing address even when the door is wide open', async () => {
    expect(await signupAllowed('*', null)).toBe(false)
    expect(await signupAllowed('*', undefined)).toBe(false)
    expect(await signupAllowed('*', '  ')).toBe(false)
  })
})

describe('signupAllowed — "*" opens registration', () => {
  it('admits any address', async () => {
    expect(await signupAllowed('*', 'anyone@anywhere.dev')).toBe(true)
    expect(await signupAllowed('*', 'someone.else@gmail.com')).toBe(true)
  })

  it('admits when "*" sits alongside narrower entries', async () => {
    expect(await signupAllowed('@yeam.ai, *', 'stranger@example.org')).toBe(true)
  })

  it('does not treat a bare "*" as part of an address', async () => {
    // The wildcard is matched by equality, so "*@yeam.ai" is not a wildcard —
    // it is a literal address nobody has, and must not open the door.
    expect(await signupAllowed('*@yeam.ai', 'stranger@example.org')).toBe(false)
  })
})

describe('signupAllowed — addresses and domains still work', () => {
  it('matches a full address exactly', async () => {
    expect(await signupAllowed('me@yeam.ai', 'me@yeam.ai')).toBe(true)
    expect(await signupAllowed('me@yeam.ai', 'you@yeam.ai')).toBe(false)
  })

  it('matches a whole domain with the @ prefix', async () => {
    expect(await signupAllowed('@yeam.ai', 'anyone@yeam.ai')).toBe(true)
    expect(await signupAllowed('@yeam.ai', 'anyone@notyeam.ai')).toBe(false)
  })

  it('is case- and whitespace-insensitive on both sides', async () => {
    expect(await signupAllowed(' @YEAM.AI ', 'Someone@Yeam.AI')).toBe(true)
    expect(await signupAllowed('ME@YEAM.AI', '  me@yeam.ai  ')).toBe(true)
  })
})

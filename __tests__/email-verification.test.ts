import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import {
  consumeVerificationToken,
  issueVerificationToken,
  verificationUrl,
} from '@/lib/email/verification'

/**
 * Email-verification tokens.
 *
 * These are bearer credentials: whoever holds one can mark an address
 * confirmed, from any device, with no session. So the properties that matter
 * are the negative ones — a token must not work twice, must not work after it
 * expires, and must not survive being replaced.
 */

interface Row {
  identifier: string
  token: string
  expires: Date
}

/** Just enough Prisma to run the module under test. */
function fakePrisma(rows: Row[] = []) {
  return {
    rows,
    verificationToken: {
      async create({ data }: { data: Row }) {
        rows.push({ ...data })
        return data
      },
      async findFirst({ where }: { where: { token: string } }) {
        return rows.find(r => r.token === where.token) ?? null
      },
      async deleteMany({ where }: { where: { identifier?: string; token?: string } }) {
        const before = rows.length
        for (let i = rows.length - 1; i >= 0; i--) {
          const r = rows[i]
          const matches =
            (where.identifier === undefined || r.identifier === where.identifier) &&
            (where.token === undefined || r.token === where.token)
          if (matches) rows.splice(i, 1)
        }
        return { count: before - rows.length }
      },
    },
  }
}

const asPrisma = (f: ReturnType<typeof fakePrisma>) => f as unknown as PrismaClient

describe('verification tokens', () => {
  it('round-trips an address', async () => {
    const db = fakePrisma()
    const token = await issueVerificationToken(asPrisma(db), 'Someone@Yeam.AI')
    expect(await consumeVerificationToken(asPrisma(db), token)).toBe('someone@yeam.ai')
  })

  it('is single use', async () => {
    const db = fakePrisma()
    const token = await issueVerificationToken(asPrisma(db), 'a@b.com')

    expect(await consumeVerificationToken(asPrisma(db), token)).toBe('a@b.com')
    // A link forwarded, archived, or fetched by a mail scanner must not still
    // be a working credential after the real click.
    expect(await consumeVerificationToken(asPrisma(db), token)).toBeNull()
  })

  it('refuses an expired token, and still clears the row', async () => {
    const db = fakePrisma([
      { identifier: 'old@b.com', token: 'stale', expires: new Date(Date.now() - 1000) },
    ])
    expect(await consumeVerificationToken(asPrisma(db), 'stale')).toBeNull()
    expect(db.rows).toHaveLength(0)
  })

  it('refuses an unknown or empty token', async () => {
    const db = fakePrisma()
    expect(await consumeVerificationToken(asPrisma(db), 'never-issued')).toBeNull()
    expect(await consumeVerificationToken(asPrisma(db), '')).toBeNull()
  })

  it('replaces a prior token rather than accumulating', async () => {
    const db = fakePrisma()
    const first = await issueVerificationToken(asPrisma(db), 'a@b.com')
    const second = await issueVerificationToken(asPrisma(db), 'a@b.com')

    expect(second).not.toBe(first)
    expect(db.rows).toHaveLength(1)
    // Pressing resend has to invalidate what was mailed before it, or the
    // button quietly mints a pile of simultaneously-valid keys.
    expect(await consumeVerificationToken(asPrisma(db), first)).toBeNull()
    expect(await consumeVerificationToken(asPrisma(db), second)).toBe('a@b.com')
  })

  it('issues unguessable, distinct tokens', async () => {
    const db = fakePrisma()
    const tokens = new Set<string>()
    for (let i = 0; i < 20; i++) tokens.add(await issueVerificationToken(asPrisma(db), `u${i}@b.com`))

    expect(tokens.size).toBe(20)
    for (const t of tokens) expect(t).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('verificationUrl', () => {
  const ORIGINAL = { auth: process.env.AUTH_URL, next: process.env.NEXTAUTH_URL }

  afterEach(() => {
    process.env.AUTH_URL = ORIGINAL.auth
    process.env.NEXTAUTH_URL = ORIGINAL.next
    if (ORIGINAL.auth === undefined) delete process.env.AUTH_URL
    if (ORIGINAL.next === undefined) delete process.env.NEXTAUTH_URL
  })

  it('builds against AUTH_URL, which Auth.js also prefers', () => {
    process.env.AUTH_URL = 'https://app.yeam.ai'
    process.env.NEXTAUTH_URL = 'https://wrong.example'
    expect(verificationUrl('abc')).toBe('https://app.yeam.ai/api/auth/verify-email?token=abc')
  })

  it('falls back to NEXTAUTH_URL, which is all that is set locally', () => {
    delete process.env.AUTH_URL
    process.env.NEXTAUTH_URL = 'http://localhost:3005'
    expect(verificationUrl('abc')).toBe('http://localhost:3005/api/auth/verify-email?token=abc')
  })

  it('does not emit a double slash when the origin has a trailing one', () => {
    process.env.AUTH_URL = 'https://app.yeam.ai/'
    expect(verificationUrl('abc')).toBe('https://app.yeam.ai/api/auth/verify-email?token=abc')
  })
})

describe('the mailer degrades instead of throwing', () => {
  const ORIGINAL = process.env.RESEND_API_KEY

  beforeEach(() => vi.resetModules())
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.RESEND_API_KEY
    else process.env.RESEND_API_KEY = ORIGINAL
    vi.restoreAllMocks()
  })

  it('reports unavailable and sends nothing without a key', async () => {
    delete process.env.RESEND_API_KEY
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    const { EMAIL_AVAILABLE, sendEmail } = await import('@/lib/email/client')
    expect(EMAIL_AVAILABLE).toBe(false)

    // Mail is always a side effect of a request that has already succeeded, so
    // "no provider" has to be a returned result, never a thrown one.
    await expect(
      sendEmail({ to: 'a@b.com', subject: 's', html: '<p>h</p>', text: 't' }),
    ).resolves.toEqual({ ok: false, error: 'not-configured' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('turns a provider error into a result, not an exception', async () => {
    process.env.RESEND_API_KEY = 'test-key'
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('domain not verified', { status: 403 }),
    )

    const { sendEmail } = await import('@/lib/email/client')
    await expect(
      sendEmail({ to: 'a@b.com', subject: 's', html: '<p>h</p>', text: 't' }),
    ).resolves.toEqual({ ok: false, error: 'http-403' })
  })

  it('survives the network being down', async () => {
    process.env.RESEND_API_KEY = 'test-key'
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'))

    const { sendEmail } = await import('@/lib/email/client')
    await expect(
      sendEmail({ to: 'a@b.com', subject: 's', html: '<p>h</p>', text: 't' }),
    ).resolves.toEqual({ ok: false, error: 'network' })
  })
})

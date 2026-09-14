import { randomBytes } from 'crypto'
import type { PrismaClient } from '@prisma/client'
import { EMAIL_AVAILABLE, sendEmail, type SendResult } from './client'
import { verificationEmail } from './templates'

/**
 * Email-verification tokens.
 *
 * Stored in `verification_tokens`, the table the Auth.js Prisma adapter has
 * always created and nothing has ever written to. Reusing it rather than adding
 * a table keeps the migration count down and matches what the adapter would do
 * if the email provider were wired through Auth.js itself, which it is not:
 * verification here is triggered by the credentials signup, not by a magic-link
 * provider.
 *
 * Google accounts never reach any of this. They arrive already verified and are
 * stamped in the signIn event — see lib/auth.ts.
 */

/**
 * A day. Long enough to survive a signup done at the end of a shift and picked
 * up the next morning, short enough that a forwarded or archived mail is not a
 * standing key to the account.
 */
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000

/** 256 bits from the CSPRNG. Guessing is not a threat model this has to hold. */
function newToken(): string {
  return randomBytes(32).toString('hex')
}

/**
 * Where a verification link points.
 *
 * AUTH_URL first, matching Auth.js's own precedence (see lib/auth.ts) — on
 * production both it and NEXTAUTH_URL are https://app.yeam.ai, and locally
 * NEXTAUTH_URL is the only one set. A link built against the wrong origin is
 * worse than no link: it lands on a host that has no session and no route.
 */
export function verificationUrl(token: string): string {
  const base = (process.env.AUTH_URL || process.env.NEXTAUTH_URL || '').replace(/\/$/, '')
  return `${base}/api/auth/verify-email?token=${token}`
}

/**
 * Issue a token for an address, replacing any it already has.
 *
 * Replacing rather than accumulating means "resend" cannot be used to build up
 * a pile of simultaneously-valid links, and the newest mail is always the one
 * that works — which is what someone who just pressed the button expects.
 */
export async function issueVerificationToken(
  prisma: PrismaClient,
  email: string,
): Promise<string> {
  const identifier = email.toLowerCase()
  const token = newToken()

  await prisma.verificationToken.deleteMany({ where: { identifier } })
  await prisma.verificationToken.create({
    data: { identifier, token, expires: new Date(Date.now() + TOKEN_TTL_MS) },
  })

  return token
}

/**
 * Redeem a token, returning the address it belongs to.
 *
 * Single use: the row is deleted whether or not it had expired, so a leaked
 * link cannot be replayed and an expired one cannot sit in the table forever.
 * Null means "no". The caller must not distinguish unknown from expired to the
 * visitor — both are "this link is no longer valid", and saying which turns the
 * endpoint into an oracle for whether an address ever registered.
 */
export async function consumeVerificationToken(
  prisma: PrismaClient,
  token: string,
): Promise<string | null> {
  if (!token) return null

  const row = await prisma.verificationToken.findFirst({ where: { token } })
  if (!row) return null

  await prisma.verificationToken
    .deleteMany({ where: { identifier: row.identifier, token: row.token } })
    .catch(() => {})

  if (row.expires.getTime() < Date.now()) return null

  return row.identifier
}

/**
 * Issue a token and mail the link.
 *
 * The one entry point for both callers — the credentials signup and the resend
 * button — so the two cannot drift into issuing different links or different
 * copy. Returns the send result for logging; no caller may fail its own request
 * on it. A signup whose mail bounced is a verified-later account, not a failed
 * registration, and the banner it lands on offers the resend.
 */
export async function sendVerificationEmail(
  prisma: PrismaClient,
  email: string,
): Promise<SendResult> {
  if (!EMAIL_AVAILABLE) return { ok: false, error: 'not-configured' }

  const token = await issueVerificationToken(prisma, email)
  const { subject, html, text } = verificationEmail(verificationUrl(token))

  return sendEmail({ to: email, subject, html, text })
}

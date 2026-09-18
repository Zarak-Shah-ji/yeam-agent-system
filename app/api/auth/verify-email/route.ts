import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { auth } from '@/lib/auth'
import { consumeVerificationToken } from '@/lib/email/verification'

export const runtime = 'nodejs'

/**
 * Redeem an email-verification link.
 *
 * Deliberately outside Auth.js. Its own verification flow belongs to the Email
 * provider, which this app does not register — sign-in is Google plus a
 * password, and adding a magic-link provider to reuse its callback would also
 * add a third way to sign in. This route does the one thing that is wanted:
 * mark the address confirmed.
 *
 * No session required, and that is not an oversight. The link is opened from a
 * mail client, frequently on a different device from the one that signed up,
 * and requiring a session would send people to a login screen that discards the
 * token. Possession of a 256-bit single-use token IS the proof; it is the same
 * bearer model every verification link on the internet uses.
 *
 * Always redirects, never renders. A bare JSON body in a browser tab is a dead
 * end for someone who just clicked a button in their inbox.
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token') ?? ''

  // Where to land depends on whether this browser is signed in, because the
  // link is very often opened somewhere that is not.
  //
  // Not "/": that redirects to /worklist and the query string does not survive
  // it, so the outcome would be silently dropped. And not /worklist when there
  // is no session: the dashboard layout would bounce to /login and lose it the
  // same way. Both destinations read ?verified= and say what happened.
  const session = await auth()
  const home = session?.user ? '/worklist' : '/login'
  const done = (status: string) =>
    NextResponse.redirect(new URL(`${home}?verified=${status}`, req.url))

  const email = await consumeVerificationToken(prisma, token)

  // Unknown and expired are one answer on purpose. Distinguishing them turns
  // this into an oracle for whether an address ever registered, and the reader
  // does the same thing either way: ask for a new link.
  if (!email) return done('invalid')

  // updateMany, not update: the address may have been verified already by an
  // earlier click or by a Google sign-in, and a second redemption should be a
  // no-op rather than a crash on a row that no longer matches.
  await prisma.user
    .updateMany({ where: { email, emailVerified: null }, data: { emailVerified: new Date() } })
    .catch(() => {})

  return done('ok')
}

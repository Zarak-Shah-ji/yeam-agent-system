import { NextResponse } from 'next/server'
import {
  APPEALS_COOKIE,
  APPEALS_COOKIE_MAX_AGE,
  accessToken,
  isValidPasscode,
} from '@/lib/appeals/access'

export const runtime = 'nodejs'

/** Exchange the shared passcode for a signed access cookie. */
export async function POST(req: Request) {
  let passcode = ''
  try {
    const body = await req.json()
    passcode = typeof body?.passcode === 'string' ? body.passcode : ''
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const token = accessToken()
  if (!token) {
    return NextResponse.json(
      { error: 'The review portal is not configured on this deployment.' },
      { status: 503 },
    )
  }

  // Blunt throttle against passcode guessing — a wrong code always costs ~400ms.
  if (!isValidPasscode(passcode)) {
    await new Promise(r => setTimeout(r, 400))
    return NextResponse.json({ error: 'That access code is not correct.' }, { status: 401 })
  }

  const res = NextResponse.json({ ok: true })
  res.cookies.set(APPEALS_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: APPEALS_COOKIE_MAX_AGE,
  })
  return res
}

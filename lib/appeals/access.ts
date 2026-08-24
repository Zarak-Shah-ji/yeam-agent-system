import { createHmac, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'

export const APPEALS_COOKIE = 'yeam_appeals_access'
/** 30 days — long enough that the reviewer enters the code once. */
export const APPEALS_COOKIE_MAX_AGE = 60 * 60 * 24 * 30

/**
 * The cookie value is an HMAC of the passcode keyed by AUTH_SECRET, so a viewer
 * cannot forge it by guessing the cookie name, and rotating APPEALS_ACCESS_CODE
 * invalidates every previously issued cookie.
 */
export function accessToken(): string | null {
  const code = process.env.APPEALS_ACCESS_CODE
  const secret = process.env.AUTH_SECRET
  if (!code || !secret) return null
  return createHmac('sha256', secret).update(`appeals:${code}`).digest('hex')
}

/** Constant-time string compare that tolerates length mismatches. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) {
    // Still burn a comparison so the failure isn't distinguishable by timing.
    timingSafeEqual(bufA, bufA)
    return false
  }
  return timingSafeEqual(bufA, bufB)
}

export function isValidPasscode(submitted: string): boolean {
  const code = process.env.APPEALS_ACCESS_CODE
  if (!code) return false
  return safeEqual(submitted, code)
}

/** True when the request carries a valid, unexpired access cookie. */
export async function hasAppealsAccess(): Promise<boolean> {
  const expected = accessToken()
  if (!expected) return false
  const cookieStore = await cookies()
  const presented = cookieStore.get(APPEALS_COOKIE)?.value
  if (!presented) return false
  return safeEqual(presented, expected)
}

/** Whether the portal is configured at all — surfaced so the page can explain itself. */
export function isAppealsPortalConfigured(): boolean {
  return !!process.env.APPEALS_ACCESS_CODE && !!process.env.AUTH_SECRET
}

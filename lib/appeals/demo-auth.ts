import { timingSafeEqual } from 'crypto'

/**
 * Shared authentication for the public demo endpoints on yeam.ai.
 *
 * Both /api/public/appeal-demo and /api/public/appeal-revise are called
 * server-to-server by the marketing site and by nothing else, so they gate on
 * one shared secret rather than the reviewer passcode cookie (which is
 * sameSite: 'lax' and never survives a cross-origin request).
 */

/** Constant-time compare that tolerates length mismatch without leaking it. */
export function secretMatches(presented: string | null): boolean {
  const expected = process.env.PUBLIC_DEMO_SECRET
  if (!expected || !presented) return false

  const a = Buffer.from(presented)
  const b = Buffer.from(expected)
  if (a.length !== b.length) {
    // Burn a comparison so a wrong length isn't faster than a wrong value.
    timingSafeEqual(b, b)
    return false
  }
  return timingSafeEqual(a, b)
}

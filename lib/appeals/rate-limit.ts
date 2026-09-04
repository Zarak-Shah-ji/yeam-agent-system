/**
 * Coarse per-caller throttle for the model-backed appeal endpoints.
 *
 * Extracted from app/api/appeals/generate/route.ts, which was the only route
 * that had one. The two public endpoints it now also protects had no limit at
 * all: /api/public/appeal-demo and /api/public/appeal-revise gate on a shared
 * secret and nothing else, so anyone holding PUBLIC_DEMO_SECRET — or any bug
 * that leaks it — had an unmetered Gemini endpoint. The marketing site throttles
 * its own proxy, but that is a control on the caller's side of the boundary,
 * which is the wrong side to rely on.
 *
 * In-memory means it resets on redeploy and is per lambda instance. That is
 * fine: it exists to stop a shared link burning API credits, not to be an exact
 * quota. Checking and recording are separate so a rejected upload (wrong format,
 * too large) doesn't consume quota — only requests that reach the model count.
 */

const WINDOW_MS = 60 * 60 * 1000
const MAX_TRACKED_KEYS = 500

/** Buckets are per limiter name, so the two endpoints don't share a quota. */
const buckets = new Map<string, Map<string, number[]>>()

function bucket(name: string): Map<string, number[]> {
  let existing = buckets.get(name)
  if (!existing) {
    existing = new Map()
    buckets.set(name, existing)
  }
  return existing
}

function recentHits(name: string, key: string): number[] {
  const now = Date.now()
  return (bucket(name).get(key) ?? []).filter(t => now - t < WINDOW_MS)
}

export interface Limiter {
  limited(key: string): boolean
  record(key: string): void
}

export function createRateLimiter(name: string, max: number): Limiter {
  return {
    limited(key: string): boolean {
      const recent = recentHits(name, key)
      bucket(name).set(key, recent)
      return recent.length >= max
    },
    record(key: string): void {
      const b = bucket(name)
      b.set(key, [...recentHits(name, key), Date.now()])

      // Drop callers whose window has fully expired so the map can't grow forever.
      if (b.size > MAX_TRACKED_KEYS) {
        for (const k of [...b.keys()]) {
          if (recentHits(name, k).length === 0) b.delete(k)
        }
      }
    },
  }
}

/**
 * Who to throttle.
 *
 * The public endpoints are called server-to-server by the marketing site, so
 * x-forwarded-for is the site's lambda, not the visitor — every visitor would
 * share one bucket. The site forwards the original client IP as
 * x-yeam-client-ip; prefer it, and fall back to the connecting address so a
 * missing header degrades to a shared bucket rather than to no limit.
 */
export function callerKey(req: Request): string {
  const forwarded = req.headers.get('x-yeam-client-ip')?.trim()
  if (forwarded) return forwarded
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
}

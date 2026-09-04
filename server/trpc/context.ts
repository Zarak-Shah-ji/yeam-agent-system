import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'

/**
 * Per-request memo.
 *
 * lib/trpc/provider.tsx uses httpBatchLink, so the Analytics page's seven
 * queries arrive as ONE http request and share one context object, and six of
 * them need the same two collections. Measured on that exact request: 20 SQL
 * queries before this, 4 after, and 13 of the 20 were unbounded reads of the
 * customer's whole A/R. That is the shape that stops working as customers grow,
 * and it is invisible in a demo workspace with forty rows in it.
 *
 * The org lookup in orgProcedure goes through this too, but for tidiness rather
 * than round-trips: Prisma already collapses findUnique calls made in the same
 * tick into one query, so those seven were always costing one.
 *
 * The cache lives on the context and dies with the request, so there is no
 * staleness to reason about and nothing to invalidate. It stores the *promise*,
 * not the resolved value, so concurrent callers in the same batch share one
 * query rather than racing to start their own.
 *
 * Keys are per-request namespaces, not global: anything varying by input must
 * put that input in the key, or not use this at all.
 */
export type Memo = <T>(key: string, load: () => Promise<T>) => Promise<T>

function createMemo(): Memo {
  const cache = new Map<string, Promise<unknown>>()
  return <T>(key: string, load: () => Promise<T>): Promise<T> => {
    const hit = cache.get(key)
    if (hit) return hit as Promise<T>
    const started = load()
    cache.set(key, started)
    // A failed load must not be cached, or every later caller in the same batch
    // inherits the rejection with no way to retry.
    started.catch(() => cache.delete(key))
    return started
  }
}

export async function createContext() {
  return {
    session: await auth(),
    prisma,
    once: createMemo(),
  }
}

export type Context = Awaited<ReturnType<typeof createContext>>

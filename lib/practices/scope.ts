/**
 * Isolated to one practice, or looking at all of them.
 *
 * `User.activePracticeId` is a user-writable column, and this is the function
 * that decides whether to believe it. Pulled out of the middleware and kept
 * pure so the three cases below can be asserted without a database — see
 * __tests__/practice-scoping.test.ts.
 *
 * The shape it returns, `practiceWhere`, mirrors searchWhere() in
 * lib/denials/search.ts: a Prisma `where` fragment meant to be SPREAD into an
 * existing clause, never to be the whole of one. It never carries an orgId, and
 * a query built from it alone would read every workspace. Adoption at a call
 * site is one spread:
 *
 *   where: { orgId: ctx.orgId, ...ctx.practiceWhere, ...searchWhere(input?.q) }
 *
 * Combined mode is `{}` — literally no predicate — rather than
 * `{ practiceId: { in: [...] } }`. That matters: the org filter beside it is
 * already the security boundary, so combined mode has nothing left to enforce,
 * and an empty object cannot narrow a query by accident.
 */

/** What a practice lookup returns, as much of it as the decision needs. */
export interface PracticeLookup {
  id: string
  orgId: string
  archivedAt: Date | null
}

export type PracticeWhere = Record<string, never> | { practiceId: string }

export interface PracticeScope {
  /** The isolated practice, or null for combined. */
  practiceId: string | null
  /** Spread into a `where` on DenialRow, OrgClaim or ImportBatch. */
  practiceWhere: PracticeWhere
  /**
   * Why, for the one caller that has to explain itself: the UI needs to know
   * the difference between "you chose all practices" and "the practice you had
   * chosen is gone", because only the second is worth telling someone about.
   */
  reason: 'combined' | 'isolated' | 'stale'
}

const COMBINED: PracticeScope = { practiceId: null, practiceWhere: {}, reason: 'combined' }

/**
 * Decide the scope for one request.
 *
 * `lookup` is the practice row as loaded, or null if the id matched nothing.
 * It is re-verified against `orgId` HERE rather than trusted from the query
 * that loaded it, so that a caller who forgets the org filter on that lookup
 * still cannot cross a tenant boundary.
 *
 * Every failure widens to combined; none of them throws. A biller whose
 * practice was archived by an admin an hour ago must land on a worklist
 * showing everything, not on an error page for a setting they cannot see. The
 * cost of widening is that they see their own company's other clinic, which is
 * the whole reason practices are a child of the organization rather than a
 * tenant of their own.
 */
export function practiceScope(
  activePracticeId: string | null | undefined,
  lookup: PracticeLookup | null | undefined,
  orgId: string,
): PracticeScope {
  if (!activePracticeId) return COMBINED

  // The id names nothing, names something in another workspace, or names a
  // practice that has been archived. Indistinguishable to the person holding
  // it, and all three mean the same thing: stop isolating.
  if (!lookup) return { ...COMBINED, reason: 'stale' }
  if (lookup.id !== activePracticeId) return { ...COMBINED, reason: 'stale' }
  if (lookup.orgId !== orgId) return { ...COMBINED, reason: 'stale' }
  if (lookup.archivedAt) return { ...COMBINED, reason: 'stale' }

  return {
    practiceId: lookup.id,
    practiceWhere: { practiceId: lookup.id },
    reason: 'isolated',
  }
}

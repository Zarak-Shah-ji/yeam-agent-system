import { initTRPC, TRPCError } from '@trpc/server'
import type { Context } from './context'
import { practiceScope } from '@/lib/practices/scope'

const t = initTRPC.context<Context>().create()

export const router = t.router
export const publicProcedure = t.procedure

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session?.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED' })
  }
  return next({
    ctx: {
      ...ctx,
      session: ctx.session,
    },
  })
})

/**
 * A procedure that can read customer data.
 *
 * protectedProcedure only asks "is there a session?" — it passes ctx.session
 * through and nothing downstream ever filters on it, which is why every query
 * against the demo tables returns every row. That was survivable while the data
 * was synthetic and registration was closed. It is not survivable once two
 * paying billing companies share a deployment.
 *
 * This resolves the caller's organization once, up front, and refuses the
 * request when there isn't one. The refusal matters more than the lookup: a
 * missing org must be a 403, never a silent fallback to "read everything".
 *
 * Rule for anything built on this: every query it makes carries
 * `where: { orgId: ctx.orgId }`. A query without it is a bug, not a shortcut.
 */
export const orgProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  const userId = ctx.session.user?.id
  if (!userId) {
    throw new TRPCError({ code: 'UNAUTHORIZED' })
  }

  // Memoized so a batched request resolves the org once rather than per
  // procedure. Prisma already collapses same-tick findUnique calls into one
  // query, so this saves the call, not the round-trip. See ../context.ts.
  const user = await ctx.once(`org:${userId}`, () =>
    ctx.prisma.user.findUnique({
      where: { id: userId },
      // activePracticeId rides along here rather than costing a second lookup
      // in practiceProcedure. It is not in the session token deliberately:
      // lib/auth.ts uses JWT sessions with no database session table, so a
      // practice carried in the token could not change without re-issuing it.
      select: { orgId: true, activePracticeId: true },
    }),
  )

  if (!user?.orgId) {
    // Accounts created before organizations existed land here. There is nothing
    // for them to read: the sample practice lives inside a workspace too, so a
    // user without one has no data of any kind. Backfill an org rather than
    // relaxing this. See lib/org.ts.
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'This account is not part of a workspace yet.',
    })
  }

  return next({
    ctx: {
      ...ctx,
      orgId: user.orgId,
      activePracticeId: user.activePracticeId,
    },
  })
})

/**
 * A procedure that reads data belonging to one clinic.
 *
 * Layered ON TOP of orgProcedure, never folded into it. That is the whole
 * design: `orgId` stays the security boundary and every query keeps carrying
 * it, so the worst a forgotten practice filter can do is show a billing company
 * its own other clinic. Rewriting orgProcedure to resolve both would make the
 * two failures indistinguishable in review, which is exactly the property worth
 * keeping.
 *
 * Use this for the three tables that carry a practiceId — DenialRow, OrgClaim,
 * ImportBatch. Everything else is correctly org-level and must stay on
 * orgProcedure: one Aetna appeals address serves every clinic, and so does one
 * subscription, one allowance, one user roster, one agent conversation history.
 *
 * What it adds:
 *   ctx.practiceWhere     spread into a where clause; {} in combined mode
 *   ctx.practiceId        the isolated practice, or null
 *   ctx.practiceStale     the chosen practice is gone and the view widened
 *
 * Note what it does NOT do: it never throws. See practiceScope().
 */
export const practiceProcedure = orgProcedure.use(async ({ ctx, next }) => {
  // No practice chosen is the common case — every workspace that has never
  // created one — and it costs no query at all.
  const lookup = ctx.activePracticeId
    ? await ctx.once(`practice:${ctx.activePracticeId}`, () =>
        ctx.prisma.practice.findUnique({
          where: { id: ctx.activePracticeId! },
          select: { id: true, orgId: true, archivedAt: true },
        }),
      )
    : null

  // Verified against ctx.orgId on every read, not once at the point it was
  // set. The column is user-writable, and a check at write time is a check an
  // attacker gets to skip.
  const scope = practiceScope(ctx.activePracticeId, lookup, ctx.orgId)

  return next({
    ctx: {
      ...ctx,
      practiceId: scope.practiceId,
      practiceWhere: scope.practiceWhere,
      practiceStale: scope.reason === 'stale',
    },
  })
})

import { initTRPC, TRPCError } from '@trpc/server'
import type { Context } from './context'

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

  // Memoized: every procedure in a batched request would otherwise repeat this
  // same lookup. See server/trpc/context.ts.
  const user = await ctx.once(`org:${userId}`, () =>
    ctx.prisma.user.findUnique({
      where: { id: userId },
      select: { orgId: true },
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
    },
  })
})

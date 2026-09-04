import { router, orgProcedure } from '../trpc'

/**
 * What the agents have been doing, for the panel on the right of the workspace.
 *
 * This is the surviving procedure from the old `dashboard` router. That router,
 * along with `patients` / `appointments` / `encounters` / `claims` / `analytics`,
 * ran on protectedProcedure — which asks only "is there a session?" and lets any
 * signed-in user read every tenant's rows. They are gone; this one moved here.
 *
 * orgProcedure is doing two jobs. The `userId` filter is what actually isolates
 * the rows — AgentLog has no orgId column to scope by — and orgProcedure is the
 * assertion that the caller has a workspace at all, so this cannot become the
 * one authenticated read that works without one.
 */
export const activityRouter = router({
  recent: orgProcedure.query(async ({ ctx }) => {
    return ctx.prisma.agentLog.findMany({
      where: { userId: ctx.session.user?.id },
      orderBy: { createdAt: 'desc' },
      take: 10,
      // Named explicitly rather than taking the whole row: AgentLog.data holds
      // generated appeal letters, and the feed renders none of it.
      select: {
        id: true,
        agentName: true,
        status: true,
        message: true,
        confidence: true,
        createdAt: true,
      },
    })
  }),
})

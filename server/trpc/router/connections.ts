import { z } from 'zod'
import { router, orgProcedure } from '../trpc'
import { CONNECTORS, canUseDirectConnections } from '@/lib/plans'

/**
 * Requests for a direct data connection.
 *
 * Database and EHR connectors are a custom-plan feature. Rather than an upgrade
 * wall that goes nowhere, the ask is recorded against the organization so it is
 * a lead someone can follow up on.
 */
export const connectionsRouter = router({
  list: orgProcedure.query(async ({ ctx }) => {
    const [org, requests] = await Promise.all([
      ctx.prisma.organization.findUnique({ where: { id: ctx.orgId }, select: { plan: true } }),
      ctx.prisma.connectionRequest.findMany({
        where: { orgId: ctx.orgId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    ])

    const plan = org?.plan ?? 'TRIAGE'
    return {
      plan,
      unlocked: canUseDirectConnections(plan),
      connectors: CONNECTORS,
      requested: requests.map(r => ({ system: r.system, createdAt: r.createdAt })),
    }
  }),

  request: orgProcedure
    .input(
      z.object({
        system: z.string().min(1).max(80),
        notes: z.string().max(2_000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.connectionRequest.create({
        data: {
          orgId: ctx.orgId,
          requestedById: ctx.session.user?.id ?? null,
          system: input.system,
          notes: input.notes?.trim() || null,
        },
      })
      return { success: true }
    }),
})

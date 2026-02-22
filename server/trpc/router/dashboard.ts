import { protectedProcedure, router } from '../trpc'
import { startOfDay, endOfDay } from 'date-fns'

export const dashboardRouter = router({
  getTodayAppointments: protectedProcedure.query(async ({ ctx }) => {
    const now = new Date()
    const appointments = await ctx.prisma.appointment.findMany({
      where: {
        scheduledAt: {
          gte: startOfDay(now),
          lte: endOfDay(now),
        },
      },
      include: {
        patient: {
          select: { id: true, firstName: true, lastName: true, mrn: true, dateOfBirth: true },
        },
        provider: {
          select: { id: true, firstName: true, lastName: true, credential: true },
        },
      },
      orderBy: { scheduledAt: 'asc' },
    })
    return appointments
  }),

  getMetrics: protectedProcedure.query(async ({ ctx }) => {
    const now = new Date()
    const todayStart = startOfDay(now)
    const todayEnd = endOfDay(now)

    const [patientsToday, claimsPending, claimsDenied, claimsTotal, arBalance] = await Promise.all([
      ctx.prisma.appointment.count({
        where: {
          scheduledAt: { gte: todayStart, lte: todayEnd },
          status: { not: 'CANCELLED' },
        },
      }),
      ctx.prisma.claim.count({
        where: { status: { in: ['PENDING', 'SCRUBBING', 'SUBMITTED', 'ACCEPTED'] } },
      }),
      ctx.prisma.claim.count({
        where: { status: 'DENIED' },
      }),
      ctx.prisma.claim.count({
        where: { status: { not: 'VOIDED' } },
      }),
      ctx.prisma.claim.aggregate({
        _sum: { patientBalance: true },
        where: { status: { in: ['SUBMITTED', 'ACCEPTED', 'PAID'] } },
      }),
    ])

    const denialRate = claimsTotal > 0 ? claimsDenied / claimsTotal : 0

    return {
      patientsToday,
      claimsPending,
      denialRate: Math.round(denialRate * 100),
      arBalance: arBalance._sum.patientBalance?.toNumber() ?? 0,
    }
  }),

  getRecentAgentLogs: protectedProcedure.query(async ({ ctx }) => {
    return ctx.prisma.agentLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: {
        user: { select: { name: true, email: true } },
      },
    })
  }),
})

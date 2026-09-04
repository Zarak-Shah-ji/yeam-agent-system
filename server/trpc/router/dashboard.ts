import { protectedProcedure, router } from '../trpc'

const mapProvider = (p: { npi: string; firstName: string | null; lastName: string | null; credentials: string | null }) => ({
  id: p.npi, firstName: p.firstName ?? '', lastName: p.lastName ?? '', credential: p.credentials ?? '',
})

export const dashboardRouter = router({
  getTodayAppointments: protectedProcedure.query(async ({ ctx }) => {
    const encounters = await ctx.prisma.medicaidEncounter.findMany({
      orderBy: { encounterDate: 'desc' },
      take: 10,
      include: {
        patient: {
          select: { id: true, firstName: true, lastName: true, mrn: true, dateOfBirth: true },
        },
        provider: {
          select: { npi: true, firstName: true, lastName: true, credentials: true },
        },
      },
    })

    return encounters.map(e => ({
      id: e.id,
      scheduledAt: e.encounterDate,
      appointmentType: e.procCode,
      duration: 30,
      status: 'COMPLETED',
      chiefComplaint: e.diagnosisCodes[0] ?? null,
      patient: e.patient,
      provider: mapProvider(e.provider),
    }))
  }),

  getMetrics: protectedProcedure.query(async ({ ctx }) => {
    const [patientsToday, claimsPending, claimsDenied, claimsTotal, arAgg] = await Promise.all([
      ctx.prisma.medicaidPatient.count(),
      ctx.prisma.medicaidEncounter.count({
        where: { claimStatus: { in: ['clean', 'flagged'] } },
      }),
      ctx.prisma.medicaidEncounter.count({
        where: { claimStatus: 'denied' },
      }),
      ctx.prisma.medicaidEncounter.count(),
      ctx.prisma.medicaidEncounter.aggregate({
        _sum: { paidAmount: true },
        where: { claimStatus: { in: ['clean', 'paid'] } },
      }),
    ])

    const denialRate = claimsTotal > 0 ? claimsDenied / claimsTotal : 0

    return {
      patientsToday,
      claimsPending,
      denialRate: Math.round(denialRate * 100),
      arBalance: arAgg._sum.paidAmount?.toNumber() ?? 0,
    }
  }),

  /**
   * The caller's own recent agent activity.
   *
   * This used to be an unfiltered findMany joining every user's name and email,
   * so any signed-in account saw the last ten agent actions of everyone on the
   * deployment. Harmless while the data was synthetic and registration closed;
   * a cross-tenant leak the moment two billing companies share a box.
   */
  getRecentAgentLogs: protectedProcedure.query(async ({ ctx }) => {
    return ctx.prisma.agentLog.findMany({
      where: { userId: ctx.session.user?.id },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: {
        user: { select: { name: true, email: true } },
      },
    })
  }),
})

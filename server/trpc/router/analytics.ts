import { protectedProcedure, router } from '../trpc'
import { z } from 'zod'
import { subDays, format } from 'date-fns'

export const analyticsRouter = router({
  getSummaryMetrics: protectedProcedure
    .input(z.object({ days: z.number().default(30) }).optional())
    .query(async ({ ctx, input }) => {
      const days = input?.days ?? 30
      const since = subDays(new Date(), days)

      const [encounters, claims, deniedClaims, revenue] = await Promise.all([
        ctx.prisma.encounter.count({ where: { encounterDate: { gte: since } } }),
        ctx.prisma.claim.count({ where: { serviceDate: { gte: since } } }),
        ctx.prisma.claim.count({ where: { serviceDate: { gte: since }, status: 'DENIED' } }),
        ctx.prisma.claim.aggregate({
          _sum: { totalCharge: true, paidAmount: true },
          where: { serviceDate: { gte: since } },
        }),
      ])

      return {
        encounters,
        claims,
        denialRate: claims > 0 ? Math.round((deniedClaims / claims) * 100) : 0,
        totalBilled: revenue._sum.totalCharge?.toNumber() ?? 0,
        totalCollected: revenue._sum.paidAmount?.toNumber() ?? 0,
      }
    }),

  getRevenueByDay: protectedProcedure
    .input(z.object({ days: z.number().default(30) }).optional())
    .query(async ({ ctx, input }) => {
      const days = input?.days ?? 30
      const since = subDays(new Date(), days)

      const claims = await ctx.prisma.claim.findMany({
        where: { serviceDate: { gte: since }, status: { not: 'VOIDED' } },
        select: { serviceDate: true, totalCharge: true, paidAmount: true },
        orderBy: { serviceDate: 'asc' },
      })

      const byDay: Record<string, { billed: number; collected: number }> = {}
      for (const c of claims) {
        const day = format(new Date(c.serviceDate), 'yyyy-MM-dd')
        if (!byDay[day]) byDay[day] = { billed: 0, collected: 0 }
        byDay[day].billed += c.totalCharge.toNumber()
        byDay[day].collected += c.paidAmount?.toNumber() ?? 0
      }

      return Object.entries(byDay).map(([date, vals]) => ({ date, ...vals }))
    }),

  getDenialTrend: protectedProcedure
    .input(z.object({ days: z.number().default(30) }).optional())
    .query(async ({ ctx, input }) => {
      const days = input?.days ?? 30
      const since = subDays(new Date(), days)

      const claims = await ctx.prisma.claim.findMany({
        where: { serviceDate: { gte: since }, status: { not: 'VOIDED' } },
        select: { serviceDate: true, status: true },
        orderBy: { serviceDate: 'asc' },
      })

      const byDay: Record<string, { total: number; denied: number }> = {}
      for (const c of claims) {
        const day = format(new Date(c.serviceDate), 'yyyy-MM-dd')
        if (!byDay[day]) byDay[day] = { total: 0, denied: 0 }
        byDay[day].total++
        if (c.status === 'DENIED') byDay[day].denied++
      }

      return Object.entries(byDay).map(([date, { total, denied }]) => ({
        date,
        denialRate: total > 0 ? Math.round((denied / total) * 100) : 0,
      }))
    }),

  getTopDiagnoses: protectedProcedure
    .input(z.object({ limit: z.number().default(10) }).optional())
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? 10
      const grouped = await ctx.prisma.diagnosis.groupBy({
        by: ['icdCode', 'description'],
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: limit,
      })
      return grouped.map(g => ({
        icdCode: g.icdCode,
        description: g.description,
        count: g._count.id,
      }))
    }),
})

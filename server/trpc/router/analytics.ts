import { protectedProcedure, router } from '../trpc'
import { z } from 'zod'
import { subDays, format } from 'date-fns'
import { Prisma } from '@prisma/client'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getLatestSince(prisma: any, days: number) {
  const latest = await prisma.medicaidEncounter.findFirst({
    orderBy: { encounterDate: 'desc' },
    select: { encounterDate: true },
  })
  return subDays(latest?.encounterDate ?? new Date(), days)
}

export const analyticsRouter = router({
  getSummaryMetrics: protectedProcedure
    .input(z.object({ days: z.number().default(30) }).optional())
    .query(async ({ ctx, input }) => {
      const days = input?.days ?? 30
      const since = await getLatestSince(ctx.prisma, days)

      const [total, denied, revenue] = await Promise.all([
        ctx.prisma.medicaidEncounter.count({ where: { encounterDate: { gte: since } } }),
        ctx.prisma.medicaidEncounter.count({ where: { encounterDate: { gte: since }, claimStatus: 'denied' } }),
        ctx.prisma.medicaidEncounter.aggregate({
          _sum: { paidAmount: true },
          where: { encounterDate: { gte: since } },
        }),
      ])

      const totalCollected = revenue._sum.paidAmount?.toNumber() ?? 0

      return {
        encounters: total,
        claims: total,
        denialRate: total > 0 ? Math.round((denied / total) * 100) : 0,
        totalBilled: Math.round(totalCollected * 1.15),
        totalCollected,
      }
    }),

  getRevenueByDay: protectedProcedure
    .input(z.object({ days: z.number().default(30) }).optional())
    .query(async ({ ctx, input }) => {
      const days = input?.days ?? 30
      const since = await getLatestSince(ctx.prisma, days)

      const encounters = await ctx.prisma.medicaidEncounter.findMany({
        where: { encounterDate: { gte: since } },
        select: { encounterDate: true, paidAmount: true },
        orderBy: { encounterDate: 'asc' },
      })

      const byDay: Record<string, { billed: number; collected: number }> = {}
      for (const e of encounters) {
        const day = format(new Date(e.encounterDate), 'yyyy-MM-dd')
        if (!byDay[day]) byDay[day] = { billed: 0, collected: 0 }
        const collected = e.paidAmount?.toNumber() ?? 0
        byDay[day].collected += collected
        byDay[day].billed += collected * 1.15
      }

      return Object.entries(byDay).map(([date, vals]) => ({
        date,
        billed: Math.round(vals.billed),
        collected: Math.round(vals.collected),
      }))
    }),

  getDenialTrend: protectedProcedure
    .input(z.object({ days: z.number().default(30) }).optional())
    .query(async ({ ctx, input }) => {
      const days = input?.days ?? 30
      const since = await getLatestSince(ctx.prisma, days)

      const encounters = await ctx.prisma.medicaidEncounter.findMany({
        where: { encounterDate: { gte: since } },
        select: { encounterDate: true, claimStatus: true },
        orderBy: { encounterDate: 'asc' },
      })

      const byDay: Record<string, { total: number; denied: number }> = {}
      for (const e of encounters) {
        const day = format(new Date(e.encounterDate), 'yyyy-MM-dd')
        if (!byDay[day]) byDay[day] = { total: 0, denied: 0 }
        byDay[day].total++
        if (e.claimStatus === 'denied') byDay[day].denied++
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
      const results = await ctx.prisma.$queryRaw<Array<{ icd_code: string; count: number }>>(
        Prisma.sql`
          SELECT unnest(diagnosis_codes) AS icd_code, COUNT(*)::int AS count
          FROM medicaid_encounters
          GROUP BY icd_code
          ORDER BY count DESC
          LIMIT ${limit}
        `
      )
      return results.map(r => ({
        icdCode: r.icd_code,
        description: r.icd_code,
        count: r.count,
      }))
    }),
})

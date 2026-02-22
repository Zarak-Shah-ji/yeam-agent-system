import { z } from 'zod'
import { protectedProcedure, router } from '../trpc'

export const patientsRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        search: z.string().optional(),
        limit: z.number().min(1).max(100).default(20),
        cursor: z.string().optional(),
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      const { search, limit = 20, cursor } = input ?? {}

      const patients = await ctx.prisma.patient.findMany({
        where: search
          ? {
              OR: [
                { firstName: { contains: search, mode: 'insensitive' } },
                { lastName: { contains: search, mode: 'insensitive' } },
                { mrn: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } },
              ],
            }
          : undefined,
        include: {
          coverages: {
            include: { payer: { select: { name: true, planType: true } } },
            where: { active: true, isPrimary: true },
            take: 1,
          },
        },
        orderBy: { lastName: 'asc' },
        take: limit + 1,
        cursor: cursor ? { id: cursor } : undefined,
      })

      let nextCursor: string | undefined
      if (patients.length > limit) {
        const next = patients.pop()
        nextCursor = next?.id
      }

      return { patients, nextCursor }
    }),

  get: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const patient = await ctx.prisma.patient.findUnique({
        where: { id: input.id },
        include: {
          coverages: { include: { payer: true } },
          appointments: {
            include: { provider: true },
            orderBy: { scheduledAt: 'desc' },
            take: 10,
          },
          encounters: {
            include: {
              diagnoses: true,
              procedures: true,
              provider: true,
            },
            orderBy: { encounterDate: 'desc' },
            take: 5,
          },
          claims: {
            include: { payer: true },
            orderBy: { serviceDate: 'desc' },
            take: 10,
          },
        },
      })

      return patient
    }),
})

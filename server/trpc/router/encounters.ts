import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { protectedProcedure, router } from '../trpc'

export const encountersRouter = router({
  list: protectedProcedure
    .input(z.object({
      patientId: z.string().optional(),
      status: z.string().optional(),
      limit: z.number().min(1).max(100).default(30),
      cursor: z.string().optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const { patientId, status, limit = 30, cursor } = input ?? {}

      const encounters = await ctx.prisma.encounter.findMany({
        where: {
          ...(patientId ? { patientId } : {}),
          ...(status ? { status: status as 'DRAFT' | 'SIGNED' | 'AMENDED' | 'VOIDED' } : {}),
        },
        include: {
          patient: { select: { id: true, firstName: true, lastName: true, mrn: true } },
          provider: { select: { id: true, firstName: true, lastName: true, credential: true } },
          diagnoses: { where: { isPrimary: true }, take: 1 },
          procedures: { take: 1 },
        },
        orderBy: { encounterDate: 'desc' },
        take: limit + 1,
        cursor: cursor ? { id: cursor } : undefined,
      })

      let nextCursor: string | undefined
      if (encounters.length > limit) {
        const next = encounters.pop()
        nextCursor = next?.id
      }

      return { encounters, nextCursor }
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const enc = await ctx.prisma.encounter.findUnique({
        where: { id: input.id },
        include: {
          patient: {
            include: {
              coverages: {
                include: { payer: true },
                where: { active: true },
                take: 1,
              },
            },
          },
          provider: true,
          diagnoses: { orderBy: { sequence: 'asc' } },
          procedures: true,
          appointment: true,
          claims: { include: { payer: true } },
        },
      })
      if (!enc) throw new TRPCError({ code: 'NOT_FOUND' })
      return {
        ...enc,
        claims: enc.claims.map(c => ({
          ...c,
          totalCharge: c.totalCharge.toNumber(),
          allowedAmount: c.allowedAmount?.toNumber() ?? null,
          paidAmount: c.paidAmount?.toNumber() ?? null,
          patientBalance: c.patientBalance?.toNumber() ?? null,
        })),
      }
    }),

  updateSOAP: protectedProcedure
    .input(z.object({
      id: z.string(),
      subjective: z.string().optional(),
      objective: z.string().optional(),
      assessment: z.string().optional(),
      plan: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const enc = await ctx.prisma.encounter.findUnique({ where: { id: input.id } })
      if (!enc) throw new TRPCError({ code: 'NOT_FOUND' })
      if (enc.status !== 'DRAFT') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only DRAFT encounters can be edited' })
      }
      const { id, ...data } = input
      return ctx.prisma.encounter.update({ where: { id }, data })
    }),

  sign: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const enc = await ctx.prisma.encounter.findUnique({ where: { id: input.id } })
      if (!enc) throw new TRPCError({ code: 'NOT_FOUND' })
      if (enc.status !== 'DRAFT') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only DRAFT encounters can be signed' })
      }
      return ctx.prisma.encounter.update({
        where: { id: input.id },
        data: {
          status: 'SIGNED',
          signedAt: new Date(),
          signedBy: ctx.session?.user?.id,
        },
      })
    }),

  addDiagnosis: protectedProcedure
    .input(z.object({
      encounterId: z.string(),
      icdCode: z.string(),
      description: z.string(),
      isPrimary: z.boolean().default(false),
      sequence: z.number().default(1),
    }))
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.diagnosis.create({ data: input })
    }),

  removeDiagnosis: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.diagnosis.delete({ where: { id: input.id } })
    }),
})

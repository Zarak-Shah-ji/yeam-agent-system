import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { protectedProcedure, router } from '../trpc'

export const claimsRouter = router({
  list: protectedProcedure
    .input(z.object({
      status: z.union([z.string(), z.array(z.string())]).optional(),
      patientId: z.string().optional(),
      limit: z.number().min(1).max(100).default(30),
      cursor: z.string().optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const { status, patientId, limit = 30, cursor } = input ?? {}

      type ClaimStatusType = 'PENDING' | 'SCRUBBING' | 'SUBMITTED' | 'ACCEPTED' | 'PAID' | 'DENIED' | 'APPEALED' | 'VOIDED'
      let statusFilter: { status?: ClaimStatusType | { in: ClaimStatusType[] } } = {}
      if (status) {
        statusFilter = Array.isArray(status)
          ? { status: { in: status as ClaimStatusType[] } }
          : { status: status as ClaimStatusType }
      }

      const claims = await ctx.prisma.claim.findMany({
        where: {
          ...statusFilter,
          ...(patientId ? { patientId } : {}),
        },
        include: {
          patient: { select: { id: true, firstName: true, lastName: true, mrn: true } },
          payer: { select: { id: true, name: true, planType: true } },
          encounter: { select: { id: true, encounterDate: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: limit + 1,
        cursor: cursor ? { id: cursor } : undefined,
      })

      let nextCursor: string | undefined
      if (claims.length > limit) {
        const next = claims.pop()
        nextCursor = next?.id
      }

      return {
        claims: claims.map(c => ({
          ...c,
          totalCharge: c.totalCharge.toNumber(),
          allowedAmount: c.allowedAmount?.toNumber() ?? null,
          paidAmount: c.paidAmount?.toNumber() ?? null,
          patientBalance: c.patientBalance?.toNumber() ?? null,
        })),
        nextCursor,
      }
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const claim = await ctx.prisma.claim.findUnique({
        where: { id: input.id },
        include: {
          patient: true,
          payer: true,
          encounter: { include: { diagnoses: true, procedures: true } },
          events: { orderBy: { createdAt: 'desc' } },
        },
      })
      if (!claim) throw new TRPCError({ code: 'NOT_FOUND' })
      return {
        ...claim,
        totalCharge: claim.totalCharge.toNumber(),
        allowedAmount: claim.allowedAmount?.toNumber() ?? null,
        paidAmount: claim.paidAmount?.toNumber() ?? null,
        patientBalance: claim.patientBalance?.toNumber() ?? null,
      }
    }),

  updateStatus: protectedProcedure
    .input(z.object({
      id: z.string(),
      status: z.string(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      type ClaimStatusType = 'PENDING' | 'SCRUBBING' | 'SUBMITTED' | 'ACCEPTED' | 'PAID' | 'DENIED' | 'APPEALED' | 'VOIDED'
      const newStatus = input.status as ClaimStatusType
      const [updatedClaim] = await ctx.prisma.$transaction([
        ctx.prisma.claim.update({
          where: { id: input.id },
          data: {
            status: newStatus,
            ...(newStatus === 'SUBMITTED' ? { submittedAt: new Date() } : {}),
            ...(['PAID', 'DENIED'].includes(newStatus) ? { adjudicatedAt: new Date() } : {}),
          },
        }),
        ctx.prisma.claimEvent.create({
          data: {
            claimId: input.id,
            status: newStatus,
            notes: input.notes,
            automated: false,
          },
        }),
      ])
      return {
        ...updatedClaim,
        totalCharge: updatedClaim.totalCharge.toNumber(),
        allowedAmount: updatedClaim.allowedAmount?.toNumber() ?? null,
        paidAmount: updatedClaim.paidAmount?.toNumber() ?? null,
        patientBalance: updatedClaim.patientBalance?.toNumber() ?? null,
      }
    }),
})

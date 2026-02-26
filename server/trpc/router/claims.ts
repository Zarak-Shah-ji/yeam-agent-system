import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { protectedProcedure, router } from '../trpc'

const STATUS_MAP: Record<string, string> = {
  clean: 'SUBMITTED', paid: 'PAID', denied: 'DENIED',
  flagged: 'SCRUBBING', resubmitted: 'APPEALED',
}
const mapClaimStatus = (s: string | null) => STATUS_MAP[s ?? ''] ?? 'SUBMITTED'

// Reverse map: UI status → claimStatus string
const UI_TO_CLAIM: Record<string, string> = {
  SUBMITTED: 'clean', PAID: 'paid', DENIED: 'denied',
  SCRUBBING: 'flagged', APPEALED: 'resubmitted',
}

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

      let claimStatusFilter: { claimStatus?: string | { in: string[] } } = {}
      if (status) {
        if (Array.isArray(status)) {
          const mapped = status.map(s => UI_TO_CLAIM[s] ?? s).filter(Boolean)
          claimStatusFilter = { claimStatus: { in: mapped } }
        } else {
          claimStatusFilter = { claimStatus: UI_TO_CLAIM[status] ?? status }
        }
      }

      const encounters = await ctx.prisma.medicaidEncounter.findMany({
        where: {
          ...claimStatusFilter,
          ...(patientId ? { patientId } : {}),
        },
        include: {
          patient: { select: { id: true, firstName: true, lastName: true, mrn: true } },
          provider: { select: { npi: true, firstName: true, lastName: true, credentials: true } },
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

      const claims = encounters.map(e => ({
        id: e.id,
        claimNumber: 'ENC-' + e.id.slice(0, 8).toUpperCase(),
        serviceDate: e.encounterDate,
        totalCharge: e.paidAmount?.toNumber() ?? 0,
        allowedAmount: null,
        paidAmount: e.claimStatus === 'paid' ? (e.paidAmount?.toNumber() ?? null) : null,
        patientBalance: null,
        status: mapClaimStatus(e.claimStatus ?? null),
        denialReason: null,
        createdAt: e.createdAt,
        patient: e.patient,
        payer: { id: 'TX-MEDICAID', name: 'Texas Medicaid', planType: 'MEDICAID' },
        encounter: { id: e.id, encounterDate: e.encounterDate },
      }))

      return { claims, nextCursor }
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const enc = await ctx.prisma.medicaidEncounter.findUnique({
        where: { id: input.id },
        include: {
          patient: true,
          provider: true,
        },
      })
      if (!enc) throw new TRPCError({ code: 'NOT_FOUND' })

      return {
        id: enc.id,
        claimNumber: 'ENC-' + enc.id.slice(0, 8).toUpperCase(),
        serviceDate: enc.encounterDate,
        totalCharge: enc.paidAmount?.toNumber() ?? 0,
        allowedAmount: null,
        paidAmount: enc.claimStatus === 'paid' ? (enc.paidAmount?.toNumber() ?? null) : null,
        patientBalance: null,
        status: mapClaimStatus(enc.claimStatus ?? null),
        denialReason: null,
        createdAt: enc.createdAt,
        patient: enc.patient,
        payer: { id: 'TX-MEDICAID', name: 'Texas Medicaid', planType: 'MEDICAID' },
        encounter: {
          id: enc.id,
          encounterDate: enc.encounterDate,
          diagnoses: enc.diagnosisCodes.map((c, i) => ({
            id: enc.id + '||' + c, icdCode: c, description: '', isPrimary: i === 0,
          })),
          procedures: [{ id: enc.procCode, cptCode: enc.procCode, description: '' }],
        },
        events: [],
      }
    }),

  updateStatus: protectedProcedure
    .input(z.object({
      id: z.string(),
      status: z.string(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const newClaimStatus = UI_TO_CLAIM[input.status] ?? input.status
      const enc = await ctx.prisma.medicaidEncounter.update({
        where: { id: input.id },
        data: { claimStatus: newClaimStatus },
      })
      return {
        id: enc.id,
        claimNumber: 'ENC-' + enc.id.slice(0, 8).toUpperCase(),
        serviceDate: enc.encounterDate,
        totalCharge: enc.paidAmount?.toNumber() ?? 0,
        allowedAmount: null,
        paidAmount: enc.claimStatus === 'paid' ? (enc.paidAmount?.toNumber() ?? null) : null,
        patientBalance: null,
        status: mapClaimStatus(enc.claimStatus ?? null),
      }
    }),
})

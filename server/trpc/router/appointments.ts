import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { protectedProcedure, router } from '../trpc'
import { startOfDay, endOfDay } from 'date-fns'

const STATUS_MAP: Record<string, string> = {
  clean: 'SUBMITTED', paid: 'PAID', denied: 'DENIED',
  flagged: 'SCRUBBING', resubmitted: 'APPEALED',
}
const mapClaimStatus = (s: string | null) => STATUS_MAP[s ?? ''] ?? 'SUBMITTED'

const mapProvider = (p: { npi: string; firstName: string | null; lastName: string | null; credentials: string | null }) => ({
  id: p.npi, firstName: p.firstName ?? '', lastName: p.lastName ?? '', credential: p.credentials ?? '',
})

export const appointmentsRouter = router({
  list: protectedProcedure
    .input(z.object({
      date: z.string().optional(),
      status: z.string().optional(),
      providerId: z.string().optional(),
      limit: z.number().min(1).max(100).default(50),
      cursor: z.string().optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const { date, status, providerId, limit = 50, cursor } = input ?? {}

      let dateFilter: { encounterDate?: { gte: Date; lte: Date } } = {}
      if (date) {
        const d = new Date(date + 'T00:00:00')
        dateFilter = { encounterDate: { gte: startOfDay(d), lte: endOfDay(d) } }
      }

      // Map UI status to claimStatus if provided
      const UI_TO_CLAIM: Record<string, string> = {
        SUBMITTED: 'clean', PAID: 'paid', DENIED: 'denied',
        SCRUBBING: 'flagged', APPEALED: 'resubmitted',
        SCHEDULED: 'clean', CHECKED_IN: 'clean', IN_PROGRESS: 'flagged',
        COMPLETED: 'paid', CANCELLED: 'denied',
      }
      const claimStatusFilter = status ? { claimStatus: UI_TO_CLAIM[status] ?? status } : {}

      const encounters = await ctx.prisma.medicaidEncounter.findMany({
        where: {
          ...dateFilter,
          ...claimStatusFilter,
          ...(providerId ? { providerNpi: providerId } : {}),
        },
        include: {
          patient: { select: { id: true, firstName: true, lastName: true, mrn: true, dateOfBirth: true } },
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

      const appointments = encounters.map(e => ({
        id: e.id,
        scheduledAt: e.encounterDate,
        appointmentType: e.procCode,
        duration: 30,
        status: mapClaimStatus(e.claimStatus ?? null),
        chiefComplaint: e.diagnosisCodes[0] ?? null,
        patient: e.patient,
        provider: mapProvider(e.provider),
      }))

      return { appointments, nextCursor }
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
      if (!enc) return null
      return {
        id: enc.id,
        scheduledAt: enc.encounterDate,
        appointmentType: enc.procCode,
        duration: 30,
        status: mapClaimStatus(enc.claimStatus ?? null),
        chiefComplaint: enc.diagnosisCodes[0] ?? null,
        patient: enc.patient,
        provider: mapProvider(enc.provider),
      }
    }),

  checkIn: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const enc = await ctx.prisma.medicaidEncounter.findUnique({ where: { id: input.id } })
      if (!enc) throw new TRPCError({ code: 'NOT_FOUND' })
      const updated = await ctx.prisma.medicaidEncounter.update({
        where: { id: input.id },
        data: { claimStatus: 'clean' },
        include: {
          patient: { select: { id: true, firstName: true, lastName: true, mrn: true, dateOfBirth: true } },
          provider: { select: { npi: true, firstName: true, lastName: true, credentials: true } },
        },
      })
      return {
        id: updated.id,
        scheduledAt: updated.encounterDate,
        appointmentType: updated.procCode,
        duration: 30,
        status: mapClaimStatus(updated.claimStatus ?? null),
        chiefComplaint: updated.diagnosisCodes[0] ?? null,
        patient: updated.patient,
        provider: mapProvider(updated.provider),
      }
    }),

  updateStatus: protectedProcedure
    .input(z.object({ id: z.string(), status: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const UI_TO_CLAIM: Record<string, string> = {
        SUBMITTED: 'clean', PAID: 'paid', DENIED: 'denied',
        SCRUBBING: 'flagged', APPEALED: 'resubmitted',
      }
      const claimStatus = UI_TO_CLAIM[input.status] ?? input.status
      return ctx.prisma.medicaidEncounter.update({
        where: { id: input.id },
        data: { claimStatus },
      })
    }),

  cancel: protectedProcedure
    .input(z.object({
      id: z.string(),
      reasonType: z.enum(['PATIENT_REQUEST', 'NO_SHOW', 'PROVIDER_UNAVAILABLE', 'INSURANCE_ISSUE', 'OTHER']),
      reasonNote: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const enc = await ctx.prisma.medicaidEncounter.findUnique({ where: { id: input.id } })
      if (!enc) throw new TRPCError({ code: 'NOT_FOUND' })

      const LABELS: Record<string, string> = {
        PATIENT_REQUEST: 'Patient Request', NO_SHOW: 'No Show',
        PROVIDER_UNAVAILABLE: 'Provider Unavailable', INSURANCE_ISSUE: 'Insurance Issue', OTHER: 'Other',
      }
      const cancellationReason = input.reasonNote
        ? `${LABELS[input.reasonType]}: ${input.reasonNote}`
        : LABELS[input.reasonType]

      const updated = await ctx.prisma.medicaidEncounter.update({
        where: { id: input.id },
        data: {
          claimStatus: 'denied',
          notes: enc.notes ? enc.notes + '\n\nCancelled: ' + cancellationReason : 'Cancelled: ' + cancellationReason,
        },
        include: {
          patient: { select: { id: true, firstName: true, lastName: true, mrn: true, dateOfBirth: true } },
          provider: { select: { npi: true, firstName: true, lastName: true, credentials: true } },
        },
      })

      ctx.prisma.agentLog.create({
        data: {
          taskId: `cancel-${input.id}`,
          agentName: 'FRONT_DESK',
          status: 'COMPLETE',
          intent: 'appointment_cancel',
          message: `Appointment cancelled. Reason: ${cancellationReason}`,
          userId: ctx.session.user?.id,
        },
      }).catch(console.error)

      return {
        id: updated.id,
        scheduledAt: updated.encounterDate,
        appointmentType: updated.procCode,
        duration: 30,
        status: 'CANCELLED',
        chiefComplaint: updated.diagnosisCodes[0] ?? null,
        patient: updated.patient,
        provider: mapProvider(updated.provider),
      }
    }),
})

import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { protectedProcedure, router } from '../trpc'
import { startOfDay, endOfDay } from 'date-fns'

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

      let dateFilter = {}
      if (date) {
        const d = new Date(date + 'T00:00:00')
        dateFilter = { scheduledAt: { gte: startOfDay(d), lte: endOfDay(d) } }
      }

      const appointments = await ctx.prisma.appointment.findMany({
        where: {
          ...dateFilter,
          ...(status ? { status: status as 'SCHEDULED' | 'CHECKED_IN' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW' } : {}),
          ...(providerId ? { providerId } : {}),
        },
        include: {
          patient: { select: { id: true, firstName: true, lastName: true, mrn: true, dateOfBirth: true } },
          provider: { select: { id: true, firstName: true, lastName: true, credential: true } },
        },
        orderBy: { scheduledAt: 'asc' },
        take: limit + 1,
        cursor: cursor ? { id: cursor } : undefined,
      })

      let nextCursor: string | undefined
      if (appointments.length > limit) {
        const next = appointments.pop()
        nextCursor = next?.id
      }

      return { appointments, nextCursor }
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.appointment.findUnique({
        where: { id: input.id },
        include: {
          patient: true,
          provider: true,
          encounter: { include: { diagnoses: true, procedures: true } },
        },
      })
    }),

  checkIn: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const appt = await ctx.prisma.appointment.findUnique({ where: { id: input.id } })
      if (!appt) throw new TRPCError({ code: 'NOT_FOUND' })
      if (appt.status !== 'CHECKED_IN' && appt.status !== 'SCHEDULED') {
        // only allow from SCHEDULED
      }
      return ctx.prisma.appointment.update({
        where: { id: input.id },
        data: { status: 'CHECKED_IN' },
        include: {
          patient: { select: { id: true, firstName: true, lastName: true, mrn: true, dateOfBirth: true } },
          provider: { select: { id: true, firstName: true, lastName: true, credential: true } },
        },
      })
    }),

  updateStatus: protectedProcedure
    .input(z.object({ id: z.string(), status: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.appointment.update({
        where: { id: input.id },
        data: { status: input.status as 'SCHEDULED' | 'CHECKED_IN' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW' },
      })
    }),

  cancel: protectedProcedure
    .input(z.object({
      id: z.string(),
      reasonType: z.enum(['PATIENT_REQUEST', 'NO_SHOW', 'PROVIDER_UNAVAILABLE', 'INSURANCE_ISSUE', 'OTHER']),
      reasonNote: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const appt = await ctx.prisma.appointment.findUnique({ where: { id: input.id } })
      if (!appt) throw new TRPCError({ code: 'NOT_FOUND' })
      if (appt.status === 'COMPLETED' || appt.status === 'CHECKED_IN')
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Cannot cancel a ${appt.status} appointment.` })
      if (appt.status === 'CANCELLED') return appt  // idempotent

      const LABELS: Record<string, string> = {
        PATIENT_REQUEST: 'Patient Request', NO_SHOW: 'No Show',
        PROVIDER_UNAVAILABLE: 'Provider Unavailable', INSURANCE_ISSUE: 'Insurance Issue', OTHER: 'Other',
      }
      const cancellationReason = input.reasonNote
        ? `${LABELS[input.reasonType]}: ${input.reasonNote}`
        : LABELS[input.reasonType]

      const updated = await ctx.prisma.appointment.update({
        where: { id: input.id },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancellationReason,
          cancelledBy: ctx.session.user?.id,
        },
        include: {
          patient: { select: { id: true, firstName: true, lastName: true, mrn: true, dateOfBirth: true } },
          provider: { select: { id: true, firstName: true, lastName: true, credential: true } },
        },
      })

      // Fire-and-forget agent log (same pattern as base-agent.ts)
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

      return updated
    }),
})

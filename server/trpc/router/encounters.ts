import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { protectedProcedure, router } from '../trpc'

const mapProvider = (p: { npi: string; firstName: string | null; lastName: string | null; credentials: string | null }) => ({
  id: p.npi, firstName: p.firstName ?? '', lastName: p.lastName ?? '', credential: p.credentials ?? '',
})

export const encountersRouter = router({
  list: protectedProcedure
    .input(z.object({
      patientId: z.string().optional(),
      status: z.string().optional(),
      limit: z.number().min(1).max(100).default(30),
      cursor: z.string().optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const { patientId, limit = 30, cursor } = input ?? {}

      const encounters = await ctx.prisma.medicaidEncounter.findMany({
        where: {
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

      const mapped = encounters.map(e => ({
        id: e.id,
        patientId: e.patientId,
        encounterDate: e.encounterDate,
        status: 'SIGNED' as const,
        createdAt: e.createdAt,
        updatedAt: e.updatedAt,
        patient: e.patient,
        provider: mapProvider(e.provider),
        diagnoses: [{ id: e.diagnosisCodes[0] ?? 'Z00.00', icdCode: e.diagnosisCodes[0] ?? 'Z00.00', description: '', isPrimary: true }],
        procedures: [{ id: e.procCode, cptCode: e.procCode }],
      }))

      return { encounters: mapped, nextCursor }
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

      const coverages = [{
        id: enc.patient.id + '-cov',
        memberId: enc.patient.insuranceId ?? '',
        groupNumber: null as string | null,
        copay: null as number | null,
        deductible: null as number | null,
        deductibleMet: null as number | null,
        active: true,
        isPrimary: true,
        payer: { name: enc.patient.insuranceType ?? 'Medicaid', planType: 'MEDICAID' },
      }]

      return {
        id: enc.id,
        patientId: enc.patientId,
        encounterDate: enc.encounterDate,
        status: 'SIGNED' as 'DRAFT' | 'SIGNED' | 'AMENDED' | 'VOIDED',
        subjective: null as string | null,
        objective: null as string | null,
        assessment: null as string | null,
        plan: enc.notes,
        notes: enc.notes,
        createdAt: enc.createdAt,
        updatedAt: enc.updatedAt,
        signedAt: enc.encounterDate as Date | null,
        signedBy: enc.providerNpi as string | null,
        patient: {
          ...enc.patient,
          address: enc.patient.addrLine1,
          ssnLast4: null as string | null,
          preferredLanguage: null as string | null,
          coverages,
        },
        provider: mapProvider(enc.provider),
        diagnoses: enc.diagnosisCodes.map((c, i) => ({
          id: enc.id + '||' + c,
          icdCode: c,
          description: '',
          isPrimary: i === 0,
          sequence: i + 1,
          encounterId: enc.id,
        })),
        procedures: [{
          id: enc.procCode,
          cptCode: enc.procCode,
          description: '',
          units: 1,
          fee: enc.paidAmount?.toNumber() ?? null,
          encounterId: enc.id,
        }],
        claims: [],
        appointment: null as null | { chiefComplaint: string | null },
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
      const enc = await ctx.prisma.medicaidEncounter.findUnique({ where: { id: input.id } })
      if (!enc) throw new TRPCError({ code: 'NOT_FOUND' })
      return ctx.prisma.medicaidEncounter.update({
        where: { id: input.id },
        data: { notes: input.plan ?? enc.notes },
      })
    }),

  sign: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const enc = await ctx.prisma.medicaidEncounter.findUnique({ where: { id: input.id } })
      if (!enc) throw new TRPCError({ code: 'NOT_FOUND' })
      return enc
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
      return ctx.prisma.medicaidEncounter.update({
        where: { id: input.encounterId },
        data: { diagnosisCodes: { push: input.icdCode } },
      })
    }),

  removeDiagnosis: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [encounterId, icdCode] = input.id.split('||')
      const enc = await ctx.prisma.medicaidEncounter.findUnique({ where: { id: encounterId } })
      if (!enc) throw new TRPCError({ code: 'NOT_FOUND' })
      const newCodes = enc.diagnosisCodes.filter(c => c !== icdCode)
      return ctx.prisma.medicaidEncounter.update({
        where: { id: encounterId },
        data: { diagnosisCodes: newCodes },
      })
    }),
})

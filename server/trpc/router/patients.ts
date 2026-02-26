import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { protectedProcedure, router } from '../trpc'

const STATUS_MAP: Record<string, string> = {
  clean: 'SUBMITTED', paid: 'PAID', denied: 'DENIED',
  flagged: 'SCRUBBING', resubmitted: 'APPEALED',
}
const mapClaimStatus = (s: string | null) => STATUS_MAP[s ?? ''] ?? 'SUBMITTED'

const mapProvider = (p: { npi: string; firstName: string | null; lastName: string | null; credentials: string | null }) => ({
  id: p.npi, firstName: p.firstName ?? '', lastName: p.lastName ?? '', credential: p.credentials ?? '',
})

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

      const patients = await ctx.prisma.medicaidPatient.findMany({
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
        orderBy: { lastName: 'asc' },
        take: limit + 1,
        cursor: cursor ? { id: cursor } : undefined,
      })

      let nextCursor: string | undefined
      if (patients.length > limit) {
        const next = patients.pop()
        nextCursor = next?.id
      }

      const mapped = patients.map(p => ({
        ...p,
        address: p.addrLine1,
        coverages: [{
          id: p.id + '-cov',
          memberId: p.insuranceId ?? '',
          groupNumber: null as string | null,
          copay: null as number | null,
          deductible: null as number | null,
          deductibleMet: null as number | null,
          active: true,
          isPrimary: true,
          payer: { name: p.insuranceType ?? 'Medicaid', planType: 'MEDICAID' },
        }],
      }))

      return { patients: mapped, nextCursor }
    }),

  get: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const patient = await ctx.prisma.medicaidPatient.findUnique({
        where: { id: input.id },
        include: {
          encounters: {
            include: { provider: true },
            orderBy: { encounterDate: 'desc' },
            take: 10,
          },
        },
      })

      if (!patient) throw new TRPCError({ code: 'NOT_FOUND' })

      const coverages = [{
        id: patient.id + '-cov',
        memberId: patient.insuranceId ?? '',
        groupNumber: null as string | null,
        copay: null as number | null,
        deductible: null as number | null,
        deductibleMet: null as number | null,
        active: true,
        isPrimary: true,
        payer: { name: patient.insuranceType ?? 'Medicaid', planType: 'MEDICAID' },
      }]

      const appointments = patient.encounters.map(e => ({
        id: e.id,
        scheduledAt: e.encounterDate,
        appointmentType: e.procCode,
        status: mapClaimStatus(e.claimStatus ?? null),
        chiefComplaint: e.diagnosisCodes[0] ?? null,
        duration: 30,
        provider: mapProvider(e.provider),
      }))

      const encounters = patient.encounters.map(e => ({
        id: e.id,
        encounterDate: e.encounterDate,
        status: 'SIGNED' as const,
        provider: mapProvider(e.provider),
        diagnoses: [{ id: e.diagnosisCodes[0] ?? 'Z00.00', icdCode: e.diagnosisCodes[0] ?? 'Z00.00', description: '' }],
        procedures: [{ id: e.procCode, cptCode: e.procCode }],
      }))

      const claims = patient.encounters.map(e => ({
        id: e.id,
        claimNumber: 'ENC-' + e.id.slice(0, 8).toUpperCase(),
        serviceDate: e.encounterDate,
        totalCharge: e.paidAmount?.toNumber() ?? 0,
        paidAmount: e.claimStatus === 'paid' ? (e.paidAmount?.toNumber() ?? null) : null,
        status: mapClaimStatus(e.claimStatus ?? null),
        denialReason: null,
        payer: { id: 'TX-MEDICAID', name: 'Texas Medicaid', planType: 'MEDICAID' },
      }))

      return {
        ...patient,
        address: patient.addrLine1,
        ssnLast4: null,
        preferredLanguage: null,
        coverages,
        appointments,
        encounters,
        claims,
      }
    }),
})

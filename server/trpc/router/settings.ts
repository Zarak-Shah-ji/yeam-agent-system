import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { router, orgProcedure } from '../trpc'
import { SUBMISSION_CHANNELS, payerKey } from '@/lib/billing/submission'

/**
 * Workspace settings: the practice, and where its payers take appeals.
 *
 * Both exist to fill in a letter that the workspace previously could not
 * complete. Every drafted document ends in a signature block the model can only
 * render as [PRACTICE NAME], and most rows resolve to no appeals address at all
 * because lib/billing/payers.ts is a Texas panel.
 *
 * Neither of these is PHI. An NPI and a TIN identify the billing provider, not
 * a patient, and a payer's appeals address is public. The de-identification
 * promise is about the people on the claims, and nothing here touches it.
 */

/** Trim, and treat an emptied field as cleared rather than as the empty string. */
const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .transform(v => v.trim() || null)
    .nullish()

export const settingsRouter = router({
  practice: orgProcedure.query(async ({ ctx }) => {
    const org = await ctx.prisma.organization.findUnique({
      where: { id: ctx.orgId },
      select: {
        name: true,
        practiceName: true,
        npi: true,
        tin: true,
        addressLine1: true,
        addressLine2: true,
        city: true,
        state: true,
        postalCode: true,
        contactName: true,
        contactPhone: true,
        contactFax: true,
        contactEmail: true,
      },
    })
    if (!org) throw new TRPCError({ code: 'NOT_FOUND' })
    return org
  }),

  savePractice: orgProcedure
    .input(
      z
        .object({
          practiceName: optionalText(200),
          npi: optionalText(20),
          tin: optionalText(20),
          addressLine1: optionalText(200),
          addressLine2: optionalText(200),
          city: optionalText(100),
          state: optionalText(40),
          postalCode: optionalText(20),
          contactName: optionalText(120),
          contactPhone: optionalText(40),
          contactFax: optionalText(40),
          contactEmail: optionalText(200),
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      // updateMany rather than update so the id is matched, not trusted — same
      // rule as everywhere else, even though ctx.orgId is already the caller's.
      const result = await ctx.prisma.organization.updateMany({
        where: { id: ctx.orgId },
        data: input,
      })
      if (result.count === 0) throw new TRPCError({ code: 'NOT_FOUND' })
      return { success: true }
    }),

  /** The workspace's own payer address book. */
  payerDestinations: orgProcedure.query(async ({ ctx }) => {
    return ctx.prisma.payerDestination.findMany({
      where: { orgId: ctx.orgId },
      orderBy: { payerLabel: 'asc' },
      take: 200,
    })
  }),

  /**
   * Save where this workspace sends appeals for one payer.
   *
   * Keyed on the normalized payer name so a row that arrives as "United
   * Healthcare" finds the entry saved against "UnitedHealthcare" — otherwise a
   * biller is asked for the same address on every import.
   */
  upsertPayerDestination: orgProcedure
    .input(
      z
        .object({
          payerLabel: z.string().min(1).max(200),
          channel: z.enum(SUBMISSION_CHANNELS),
          portalUrl: optionalText(500),
          faxNumber: optionalText(40),
          mailingAddress: optionalText(500),
          notes: optionalText(2_000),
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      const key = payerKey(input.payerLabel)
      if (!key) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Name the payer.' })

      const data = {
        payerLabel: input.payerLabel.trim(),
        channel: input.channel,
        portalUrl: input.portalUrl ?? null,
        faxNumber: input.faxNumber ?? null,
        mailingAddress: input.mailingAddress ?? null,
        notes: input.notes ?? null,
      }

      await ctx.prisma.payerDestination.upsert({
        where: { orgId_payerKey: { orgId: ctx.orgId, payerKey: key } },
        create: { orgId: ctx.orgId, payerKey: key, ...data },
        update: data,
      })
      return { success: true }
    }),

  deletePayerDestination: orgProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.prisma.payerDestination.deleteMany({
        where: { id: input.id, orgId: ctx.orgId },
      })
      if (result.count === 0) throw new TRPCError({ code: 'NOT_FOUND' })
      return { success: true }
    }),
})

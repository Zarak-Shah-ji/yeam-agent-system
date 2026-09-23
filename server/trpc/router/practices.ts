import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { router, orgProcedure } from '../trpc'
import { practiceIdentity, PRACTICE_IDENTITY_SELECT } from '@/lib/practices/identity'

/**
 * The clinics a billing company runs.
 *
 * A practice is a grouping INSIDE an organization, never a tenant of its own —
 * `orgId` remains the security boundary and every query here carries it. See
 * lib/practices/scope.ts for why that asymmetry is the whole design.
 *
 * All of this is orgProcedure rather than practiceProcedure, which looks
 * backwards for the practices router and is not: managing the list of clinics
 * is a workspace-level act, and a switcher that could only see the clinic it
 * was already on would have nothing to switch to.
 *
 * No role gate, matching settings.savePractice and every other mutation in this
 * app — `UserRole` exists in the schema and nothing in any router reads it yet.
 * Adding the first one here would be a new rule enforced in exactly one place,
 * which is worse than none. When roles are enforced, they get enforced across
 * the routers together.
 */

/** Trim, and treat an emptied field as cleared rather than as the empty string. */
const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .transform(v => v.trim() || null)
    .nullish()

/** The twelve, as zod. Same twelve as settings.savePractice, same limits. */
const IDENTITY_INPUT = {
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
}

export const practicesRouter = router({
  /**
   * Every practice in the workspace, archived ones last.
   *
   * Carries the open-row count per practice, which is what makes the switcher
   * worth opening: "Riverside 41 · Oakwood 6" tells a biller where the work is
   * before they commit to looking. One grouped query for all of them rather
   * than a count per practice.
   */
  list: orgProcedure.query(async ({ ctx }) => {
    const [practices, counts] = await Promise.all([
      ctx.prisma.practice.findMany({
        where: { orgId: ctx.orgId },
        select: {
          id: true,
          name: true,
          isDefault: true,
          archivedAt: true,
          ...PRACTICE_IDENTITY_SELECT,
        },
        orderBy: [{ archivedAt: 'asc' }, { isDefault: 'desc' }, { name: 'asc' }],
        take: 500,
      }),
      ctx.prisma.denialRow.groupBy({
        by: ['practiceId'],
        where: { orgId: ctx.orgId, status: { notIn: ['PAID', 'DEAD'] } },
        _count: { _all: true },
      }),
    ])

    const openRows = new Map(counts.map(c => [c.practiceId, c._count._all]))

    return {
      practices: practices.map(p => ({
        ...p,
        openRows: openRows.get(p.id) ?? 0,
        archived: p.archivedAt !== null,
      })),
      /**
       * Open rows filed under no practice at all.
       *
       * Every workspace has these until the backfill has run, and any workspace
       * whose import predates practices keeps them. Surfaced rather than hidden
       * because in combined mode they are in the table, and a switcher whose
       * per-clinic counts do not add up to the table's total is a switcher
       * nobody trusts.
       */
      unfiled: openRows.get(null) ?? 0,
      activePracticeId: ctx.activePracticeId ?? null,
    }
  }),

  /**
   * Which clinic this person is looking at, resolved rather than read raw.
   *
   * The stored column can name a practice that was archived or deleted; this
   * returns what the SERVER will actually scope by, which is what the top-bar
   * strip has to show. Reading User.activePracticeId directly in the client
   * would put a clinic's name on screen while every query beside it returned
   * every clinic's rows.
   */
  active: orgProcedure.query(async ({ ctx }) => {
    if (!ctx.activePracticeId) {
      return { practiceId: null, name: null, stale: false }
    }
    const practice = await ctx.prisma.practice.findFirst({
      where: { id: ctx.activePracticeId, orgId: ctx.orgId, archivedAt: null },
      select: { id: true, name: true },
    })
    // Same widening the middleware does, reported rather than silent: `stale`
    // is how the UI knows to say the practice is gone instead of just showing
    // "All practices" and leaving someone to wonder who changed their setting.
    if (!practice) return { practiceId: null, name: null, stale: true }
    return { practiceId: practice.id, name: practice.name, stale: false }
  }),

  /**
   * Switch the view.
   *
   * One piece of state behind two controls — the sidebar switcher and the
   * filter above the worklist table both land here. Deliberately not two
   * independent filters: a switcher saying Riverside next to a filter saying
   * Oakwood is an empty table and a tinted strip that lies about why.
   *
   * Persisted on User rather than held in the client, because it has to survive
   * a reload and because the server is where it is enforced. Not in the session
   * token: lib/auth.ts uses JWT sessions with no database session table, so a
   * practice in the token could not change without re-issuing it.
   */
  setActive: orgProcedure
    .input(z.object({ practiceId: z.string().nullable() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user?.id
      if (!userId) throw new TRPCError({ code: 'UNAUTHORIZED' })

      if (input.practiceId) {
        // Checked here as well as on every read. The read-side check in
        // practiceScope() is the one that actually protects anything — this one
        // exists so that choosing a clinic you cannot have fails visibly at the
        // click, instead of silently resolving to "all practices" forever after.
        const practice = await ctx.prisma.practice.findFirst({
          where: { id: input.practiceId, orgId: ctx.orgId, archivedAt: null },
          select: { id: true },
        })
        if (!practice) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'No such practice.' })
        }
      }

      await ctx.prisma.user.updateMany({
        // Matched on the org too, not just the id: the same rule as everywhere
        // else, even though this id came from the session.
        where: { id: userId, orgId: ctx.orgId },
        data: { activePracticeId: input.practiceId },
      })
      return { practiceId: input.practiceId }
    }),

  /**
   * The signature block one row should be completed with.
   *
   * The browser needs this because the letter's [PRACTICE NAME] placeholders
   * are filled client-side, beside the patient fields that must never reach the
   * server (components/worklist/SendPanel.tsx). It resolves through the SAME
   * practiceIdentity() the draft mutation uses — which is the point of the
   * query existing at all. A letter whose body was signed by one clinic while
   * its filled placeholders name another is a document that goes to a payer
   * with two different providers on it, and that is exactly what two
   * independent lookups would eventually produce.
   *
   * Takes the ROW's practiceId, not the switcher's: combined mode is the
   * default, and a letter drafted there still has to carry the right clinic.
   */
  identity: orgProcedure
    .input(z.object({ practiceId: z.string().nullable() }))
    .query(async ({ ctx, input }) => {
      const [practice, org] = await Promise.all([
        input.practiceId
          ? ctx.prisma.practice.findFirst({
              where: { id: input.practiceId, orgId: ctx.orgId },
              select: { name: true, ...PRACTICE_IDENTITY_SELECT },
            })
          : Promise.resolve(null),
        ctx.prisma.organization.findUnique({
          where: { id: ctx.orgId },
          select: PRACTICE_IDENTITY_SELECT,
        }),
      ])
      return practiceIdentity(practice, org)
    }),

  create: orgProcedure
    .input(
      z
        .object({
          name: z.string().min(1).max(120).transform(v => v.trim()),
          ...IDENTITY_INPUT,
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      const { name, ...identity } = input
      if (!name) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Name the practice.' })

      // The first practice in a workspace is the default, so that an import
      // arriving before anyone has thought about practices still lands
      // somewhere rather than nowhere.
      const existing = await ctx.prisma.practice.count({ where: { orgId: ctx.orgId } })

      const practice = await ctx.prisma.practice.create({
        data: { orgId: ctx.orgId, name, isDefault: existing === 0, ...identity },
        select: { id: true, name: true },
      })
      return practice
    }),

  update: orgProcedure
    .input(
      z
        .object({
          id: z.string(),
          name: z.string().min(1).max(120).transform(v => v.trim()),
          ...IDENTITY_INPUT,
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, name, ...identity } = input
      if (!name) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Name the practice.' })

      // updateMany rather than update so the org is matched, not trusted.
      const result = await ctx.prisma.practice.updateMany({
        where: { id, orgId: ctx.orgId },
        data: { name, ...identity },
      })
      if (result.count === 0) throw new TRPCError({ code: 'NOT_FOUND' })
      return { success: true }
    }),

  /**
   * Retire a clinic without deleting a year of its work.
   *
   * Never a delete. The practice has batches, denial rows, claims, letters and
   * outcomes hanging off it, and `onDelete: SetNull` would orphan every one of
   * them into the unfiled pile — silently, and with no way back. Archiving
   * takes it out of the switcher and the import picker and leaves everything
   * else readable.
   */
  archive: orgProcedure
    .input(z.object({ id: z.string(), archived: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.prisma.practice.updateMany({
        where: { id: input.id, orgId: ctx.orgId },
        data: { archivedAt: input.archived ? new Date() : null },
      })
      if (result.count === 0) throw new TRPCError({ code: 'NOT_FOUND' })

      // Anyone sitting on this practice is moved back to the combined view.
      // practiceScope() already widens for them on the next read, so this is
      // tidying rather than enforcement — but leaving the dead id in the column
      // means their UI reports "stale" on every page load until they notice.
      if (input.archived) {
        await ctx.prisma.user.updateMany({
          where: { orgId: ctx.orgId, activePracticeId: input.id },
          data: { activePracticeId: null },
        })
      }
      return { success: true }
    }),

  /**
   * Where it is set.
   *
   * An import with no practice chosen lands on the default, which is what keeps
   * a workspace that ignores practices entirely working exactly as it did.
   */
  setDefault: orgProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const practice = await ctx.prisma.practice.findFirst({
        where: { id: input.id, orgId: ctx.orgId, archivedAt: null },
        select: { id: true },
      })
      if (!practice) throw new TRPCError({ code: 'NOT_FOUND' })

      // Cleared first, then set. Two statements rather than one because there
      // is no partial unique index to lean on — see the isDefault comment in
      // schema.prisma for why there deliberately is not.
      await ctx.prisma.$transaction([
        ctx.prisma.practice.updateMany({
          where: { orgId: ctx.orgId, isDefault: true },
          data: { isDefault: false },
        }),
        ctx.prisma.practice.updateMany({
          where: { id: input.id, orgId: ctx.orgId },
          data: { isDefault: true },
        }),
      ])
      return { success: true }
    }),

  /**
   * Claim numbers that appear under more than one clinic.
   *
   * DETECTION ONLY, and that is the deliberate part. ClaimWork is keyed
   * `@@unique([orgId, claimNumber])` (schema.prisma), so two clinics under one
   * billing company that both use "1001" share one row of human state — a note
   * written on one shows on the other. The correct key is
   * `@@unique([orgId, practiceId, claimNumber])`, but that is a breaking key
   * change with a backfill, and it is not worth doing speculatively: most
   * practice management systems issue claim numbers that are unique across the
   * database they came from.
   *
   * So this ships first, in Settings, and says plainly whether the problem is
   * real in THIS workspace. If it reports nothing for every customer, the key
   * never needs changing. If it reports something, there is evidence to change
   * it against instead of a guess.
   */
  claimNumberCollisions: orgProcedure.query(async ({ ctx }) => {
    const rows = await ctx.prisma.$queryRaw<
      Array<{ claimNumber: string; practices: bigint }>
    >`
      SELECT "claimNumber", COUNT(DISTINCT "practiceId") AS practices
      FROM "denial_rows"
      WHERE "orgId" = ${ctx.orgId}
        AND "claimNumber" IS NOT NULL
        AND "practiceId" IS NOT NULL
      GROUP BY "claimNumber"
      HAVING COUNT(DISTINCT "practiceId") > 1
      ORDER BY "claimNumber"
      LIMIT 50
    `
    return {
      // bigint does not survive the tRPC JSON boundary. Narrowed here rather
      // than at the call site, where forgetting it is a runtime throw.
      collisions: rows.map(r => ({ claimNumber: r.claimNumber, practices: Number(r.practices) })),
    }
  }),
})

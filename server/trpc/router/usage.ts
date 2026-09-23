import { z } from 'zod'
import { router, orgProcedure } from '../trpc'
import { PERMITTED_DETAIL, isRecordable, type UsageEventName } from '@/lib/usage/events'

/**
 * How the product is actually used, so a layout argument can be settled with a
 * number instead of a second opinion.
 *
 * See lib/usage/events.ts for what may be recorded and why the vocabulary is
 * closed at both ends.
 */
export const usageRouter = router({
  /**
   * Record one event. Never fails the thing the biller was doing.
   *
   * A rejected pair returns `{ recorded: false }` rather than throwing. A
   * telemetry write is a side effect of a click, and the only honest failure
   * mode for it is to be dropped — a toast saying "could not record that you
   * opened a claim" is a worse product than not knowing.
   *
   * There is no rate limit and no dedupe here. Both belong at the call site,
   * where "the dialog re-rendered" and "the biller opened it again" can still
   * be told apart; by the time a request arrives they cannot be.
   */
  record: orgProcedure
    .input(
      z.object({
        name: z.string().max(64),
        /** Bounded per name by PERMITTED_DETAIL. Not free text. */
        detail: z.string().max(32).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!isRecordable(input.name, input.detail)) return { recorded: false }

      await ctx.prisma.usageEvent.create({
        data: {
          orgId: ctx.orgId,
          userId: ctx.session.user?.id ?? null,
          name: input.name as UsageEventName,
          detail: input.detail ?? null,
        },
      })
      return { recorded: true }
    }),

  /**
   * The counts, for the one decision this was added to settle.
   *
   * Nothing renders this yet, deliberately. The question — is the claim detail
   * dialog worth the click it costs — gets asked once, by a person, after a
   * fortnight of real use; building a panel that answers it every day would
   * cost more than the change it is meant to inform. It is a procedure rather
   * than a SQL snippet in a comment so that whoever asks it is reading the same
   * org scoping as the rest of the app.
   *
   * Read it as three numbers: how many claims were opened, how many of those
   * opens involved expanding anything, and how the two routes to the drafter
   * compare. If `CLAIM_TO_DRAFTER.list` dwarfs everything else, the routing
   * change on /claims was right and the dialog should shrink further.
   */
  claimDetail: orgProcedure
    .input(z.object({ days: z.number().int().min(1).max(365).default(14) }).default({ days: 14 }))
    .query(async ({ ctx, input }) => {
      const since = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000)

      const rows = await ctx.prisma.usageEvent.groupBy({
        by: ['name', 'detail'],
        where: { orgId: ctx.orgId, createdAt: { gte: since } },
        _count: { _all: true },
      })

      const count = (name: UsageEventName, detail: string | null) =>
        rows.find(r => r.name === name && r.detail === detail)?._count._all ?? 0

      const sections = Object.fromEntries(
        PERMITTED_DETAIL.CLAIM_SECTION_OPENED.map(d => [d, count('CLAIM_SECTION_OPENED', d)]),
      )

      return {
        since,
        opened: count('CLAIM_OPENED', null),
        sections,
        // Every expansion, not every claim: one biller opening three sections
        // on one claim is three here. Compared against `opened` it reads as
        // "sections expanded per claim opened", which is the shape of the
        // question — a ratio well under one means most opens read nothing.
        expansions: Object.values(sections).reduce((a, b) => a + b, 0),
        toDrafter: {
          fromList: count('CLAIM_TO_DRAFTER', 'list'),
          fromDetail: count('CLAIM_TO_DRAFTER', 'detail'),
        },
      }
    }),
})

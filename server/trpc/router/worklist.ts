import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { router, orgProcedure } from '../trpc'
import { triage, triageRow, type ClaimRow } from '@/lib/denials/triage'
import { refineDenial } from '@/lib/denials/rarc'
import { callGuidance, scoreRow } from '@/lib/denials/score'
import { payerOf, payerTurnaround } from '@/lib/insights/aggregate'
import { FACT_ROW_CAP } from '@/lib/insights/facts'
import { draftResponseForRow } from '@/lib/denials/draft-response'
import { reviseAppealLetter } from '@/lib/billing/revise-appeal'
import { money } from '@/lib/money'

/**
 * The saved worklist.
 *
 * Every query here is scoped by ctx.orgId, which orgProcedure resolves and
 * refuses to guess at. A query in this file without `orgId` in its where clause
 * is a data leak between two paying customers, not a missing filter.
 *
 * Nothing derived is stored. Remedy, filing window, days left and expiry are all
 * computed from the row's facts on every read, because a deadline written to the
 * database is wrong the next morning and a remedy written there goes stale the
 * moment a CARC mapping is corrected.
 */

const STATUSES = ['TO_WORK', 'DRAFTED', 'SENT', 'PAID', 'DEAD'] as const

type PersistedRow = {
  id: string
  claimNumber: string | null
  payer: string | null
  carc: string
  billed: unknown
  denialDate: Date | null
  cpt: string | null
  icd10: string | null
  reason: string | null
  status: string
  note: string | null
}

/**
 * Each payer's median days to settle, from the most recent A/R snapshot.
 *
 * Used only for the call guidance on sent rows. A workspace with no claims
 * export gets an empty map and the guidance degrades to a labelled rule of
 * thumb rather than disappearing — see callGuidance in lib/denials/score.ts.
 *
 * Selects the five columns the median actually needs. A worklist request has no
 * business loading every dollar column of an A/R snapshot.
 */
function payerMedians(ctx: {
  prisma: import('@prisma/client').PrismaClient
  orgId: string
  once: import('../context').Memo
}): Promise<Map<string, number>> {
  // summary and rows both want this and arrive in the same batched request.
  return ctx.once('worklist:payerMedians', async () => {
    const batch = await ctx.prisma.importBatch.findFirst({
      where: { orgId: ctx.orgId, kind: 'CLAIMS' },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    })
    if (!batch) return new Map<string, number>()

    const claims = await ctx.prisma.orgClaim.findMany({
      where: { orgId: ctx.orgId, batchId: batch.id },
      select: {
        payer: true,
        status: true,
        serviceDate: true,
        submittedDate: true,
        remitDate: true,
      },
      take: FACT_ROW_CAP,
    })

    return payerTurnaround(claims)
  })
}

function toClaimRow(row: PersistedRow): ClaimRow {
  return {
    claimNumber: row.claimNumber ?? undefined,
    payer: row.payer ?? undefined,
    carc: row.carc,
    billed: money(row.billed),
    denialDate: row.denialDate,
    cpt: row.cpt ?? undefined,
    icd10: row.icd10 ?? undefined,
    reason: row.reason ?? undefined,
  }
}

export const worklistRouter = router({
  /** The tiles, over every open row in the workspace. */
  summary: orgProcedure.query(async ({ ctx }) => {
    const today = new Date()

    const [rows, settled, followUpsDue] = await Promise.all([
      // Capped, not paginated: the bands below are derived per row, so there is
      // no SQL predicate that could select "the interesting ones" up front.
      ctx.prisma.denialRow.findMany({
        where: { orgId: ctx.orgId, status: { notIn: ['PAID', 'DEAD'] } },
        take: FACT_ROW_CAP,
      }),
      // Recovered money is the only number a customer will check against their
      // bank, so it counts nothing but rows a human marked PAID. A sum and a
      // count are all this needs — it used to load every paid row to add them
      // up in JS, which grows without bound and forever.
      ctx.prisma.denialRow.aggregate({
        where: { orgId: ctx.orgId, status: 'PAID' },
        _sum: { billed: true },
        _count: true,
      }),
      ctx.prisma.denialRow.count({
        where: {
          orgId: ctx.orgId,
          status: { notIn: ['PAID', 'DEAD'] },
          followUpAt: { lte: today },
        },
      }),
    ])

    const claimRows = rows.map(toClaimRow)
    const worklist = triage(claimRows, today)

    // Band counts come from the same scorer the table sorts by, so the tile and
    // the queue can never disagree about what "work now" means.
    //
    // Both bands are reported, not just the top one. Filing windows run 90 to
    // 180 days, so in a healthy queue almost nothing is inside the two-week
    // cliff that scores into `now` — a tile wired to that band alone would read
    // 0 most days and look broken while the queue below it was full of real
    // work. The tile leads with what needs attention this week and breaks out
    // the genuinely urgent underneath.
    let workNow = 0
    let workNowBilled = 0
    let needsAttention = 0
    let needsAttentionBilled = 0
    for (const [i, row] of rows.entries()) {
      const base = triageRow(claimRows[i], today)
      const scored = scoreRow(
        {
          billed: base.billed,
          daysLeft: base.daysLeft,
          actionable: base.actionable,
          remedy: base.remedy,
          denialDate: row.denialDate,
          lastTouchedAt: row.lastTouchedAt,
          followUpAt: row.followUpAt,
        },
        today,
      )
      if (scored.band === 'now') {
        workNow += 1
        workNowBilled += base.billed
      }
      if (scored.band === 'now' || scored.band === 'soon') {
        needsAttention += 1
        needsAttentionBilled += base.billed
      }
    }

    return {
      total: worklist.total,
      atStake: worklist.atStake,
      actionable: worklist.actionable,
      expiringSoon: worklist.expiringSoon,
      expiringSoonBilled: worklist.expiringSoonBilled,
      notRecoverable: worklist.notRecoverable,
      expired: worklist.expired,
      unknown: worklist.unknown,
      byRemedy: worklist.byRemedy,
      workNow,
      workNowBilled: Math.round(workNowBilled * 100) / 100,
      needsAttention,
      needsAttentionBilled: Math.round(needsAttentionBilled * 100) / 100,
      followUpsDue,
      recovered: Math.round(money(settled._sum.billed) * 100) / 100,
      recoveredCount: settled._count,
    }
  }),

  /**
   * Rows, highest priority first.
   *
   * The sort used to be soonest-deadline-then-dollars. That is a defensible sort
   * and a bad queue: it puts a $40 adjustment expiring Friday above a $12,000
   * authorization denial with three weeks left, and never notices that nobody
   * has touched the $12,000 row in a month. scoreRow() mixes deadline, dollars,
   * staleness, the biller's own follow-up date and the cost of the remedy, which
   * is what a billing manager asked for and what Epic's work queues do.
   *
   * Sorted in memory rather than in SQL because every input is derived, not
   * stored. A batch is a few thousand rows at the top end, which is cheap to
   * sort and worth it to never serve a stale priority. If a workspace ever
   * outgrows that, the fix is a materialised column refreshed nightly — not
   * storing the score.
   */
  rows: orgProcedure
    .input(
      z
        .object({
          batchId: z.string().optional(),
          status: z.enum(STATUSES).optional(),
          limit: z.number().min(1).max(500).default(100),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const [rows, medians] = await Promise.all([
        ctx.prisma.denialRow.findMany({
          where: {
            orgId: ctx.orgId,
            ...(input?.batchId ? { batchId: input.batchId } : {}),
            ...(input?.status ? { status: input.status } : {}),
          },
          include: { _count: { select: { drafts: true } } },
          take: FACT_ROW_CAP,
        }),
        payerMedians(ctx),
      ])

      const today = new Date()
      // triageRow() also returns `note` — the remedy guidance for this CARC.
      // The biller's own note is kept separate rather than shadowing it.
      const triaged = rows.map(row => {
        const base = triageRow(toClaimRow(row), today)
        return {
          id: row.id,
          status: row.status,
          userNote: row.note,
          draftCount: row._count.drafts,
          ...base,
          denialDate: row.denialDate,
          lastTouchedAt: row.lastTouchedAt,
          followUpAt: row.followUpAt,
          // What the remittance actually said, where a vague CARC leaves the
          // next step undetermined. Null is a real answer: nothing honest to add.
          refinement: refineDenial({ carc: row.carc, reason: row.reason }),
          ...scoreRow(
            {
              billed: base.billed,
              daysLeft: base.daysLeft,
              actionable: base.actionable,
              remedy: base.remedy,
              denialDate: row.denialDate,
              lastTouchedAt: row.lastTouchedAt,
              followUpAt: row.followUpAt,
            },
            today,
          ),
          call: callGuidance(
            {
              status: row.status,
              lastTouchedAt: row.lastTouchedAt,
              payerMedianDaysToPay: medians.get(payerOf(row.payer)) ?? null,
            },
            today,
          ),
        }
      })

      // Score first. Ties break on the deadline, then on money — so two rows
      // that score alike still come out in a defensible order rather than
      // whatever the database happened to return.
      triaged.sort((a, b) => {
        if (a.score !== b.score) return b.score - a.score
        if (a.daysLeft === null && b.daysLeft === null) return b.billed - a.billed
        if (a.daysLeft === null) return 1
        if (b.daysLeft === null) return -1
        if (a.daysLeft !== b.daysLeft) return a.daysLeft - b.daysLeft
        return b.billed - a.billed
      })

      return triaged.slice(0, input?.limit ?? 100)
    }),

  /**
   * Denial imports only.
   *
   * The batch table holds claims snapshots too since imports were generalised.
   * Counting those here would make a workspace that has only uploaded an A/R
   * export look like it has a worklist, and render an empty table instead of the
   * import box.
   */
  batches: orgProcedure.query(async ({ ctx }) => {
    return ctx.prisma.importBatch.findMany({
      where: { orgId: ctx.orgId, kind: 'DENIALS' },
      orderBy: { createdAt: 'desc' },
      take: 25,
    })
  }),

  /**
   * Move a denial along, and record that a human did it.
   *
   * This mutation existed before anything in the UI called it, which meant no
   * row could ever leave DRAFTED: the recovery funnel could not show a recovery,
   * "worked" was unmeasurable, and there was no last-touch signal for the
   * priority score to read. Closing that loop is what makes the queue and the
   * funnel true.
   *
   * `lastTouchedAt` is stamped here rather than relying on updatedAt, which any
   * batch write would reset. A follow-up date is optional and typically set when
   * marking a row SENT — that is the point at which a biller knows when they
   * want to look again.
   */
  setStatus: orgProcedure
    .input(
      z.object({
        rowId: z.string(),
        status: z.enum(STATUSES),
        /** Null clears an existing follow-up; undefined leaves it alone. */
        followUpAt: z.coerce.date().nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // updateMany, not update: it takes orgId in the where clause, so a row id
      // belonging to another workspace matches nothing instead of being updated.
      const result = await ctx.prisma.denialRow.updateMany({
        where: { id: input.rowId, orgId: ctx.orgId },
        data: {
          status: input.status,
          lastTouchedAt: new Date(),
          ...(input.followUpAt === undefined ? {} : { followUpAt: input.followUpAt }),
        },
      })
      if (result.count === 0) throw new TRPCError({ code: 'NOT_FOUND' })
      return { success: true }
    }),

  /**
   * The biller's own note on a row.
   *
   * Small field, disproportionate value. The most-cited failure of AI denial
   * tools in the field is that "the denial reason might state one thing, while
   * on call you find out the underlying reason is entirely another" — and that
   * second reason exists nowhere in any export. This is where it lands. It is
   * also a touch, so it feeds the staleness signal in the priority score.
   */
  setNote: orgProcedure
    .input(z.object({ rowId: z.string(), note: z.string().max(2_000) }))
    .mutation(async ({ ctx, input }) => {
      const trimmed = input.note.trim()
      const result = await ctx.prisma.denialRow.updateMany({
        where: { id: input.rowId, orgId: ctx.orgId },
        data: { note: trimmed || null, lastTouchedAt: new Date() },
      })
      if (result.count === 0) throw new TRPCError({ code: 'NOT_FOUND' })
      return { success: true }
    }),

  /**
   * Follow-ups that have come due, across the whole workspace.
   *
   * Answers "what did I promise to look at today" without scanning the queue.
   */
  dueFollowUps: orgProcedure.query(async ({ ctx }) => {
    const rows = await ctx.prisma.denialRow.findMany({
      where: {
        orgId: ctx.orgId,
        status: { notIn: ['PAID', 'DEAD'] },
        followUpAt: { lte: new Date() },
      },
      orderBy: { followUpAt: 'asc' },
      take: 50,
      select: {
        id: true,
        claimNumber: true,
        payer: true,
        carc: true,
        billed: true,
        followUpAt: true,
        status: true,
      },
    })
    return rows.map(r => ({ ...r, billed: money(r.billed) }))
  }),

  drafts: orgProcedure
    .input(z.object({ rowId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.denialDraft.findMany({
        where: { rowId: input.rowId, orgId: ctx.orgId },
        orderBy: { version: 'asc' },
      })
    }),

  /**
   * Draft the document this denial calls for, and record it as worked.
   *
   * The DenialWorkedEvent is the billable unit. It is written in the same
   * transaction as the draft and has a unique constraint on rowId, so redrafting
   * a denial ten times still bills once.
   */
  draft: orgProcedure
    .input(z.object({ rowId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.prisma.denialRow.findFirst({
        where: { id: input.rowId, orgId: ctx.orgId },
      })
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' })

      const drafted = await draftResponseForRow(
        {
          claimNumber: row.claimNumber,
          payer: row.payer,
          carc: row.carc,
          billed: money(row.billed),
          denialDate: row.denialDate,
          cpt: row.cpt,
          icd10: row.icd10,
          reason: row.reason,
        },
        new Date(),
      )

      const latest = await ctx.prisma.denialDraft.findFirst({
        where: { rowId: row.id, orgId: ctx.orgId },
        orderBy: { version: 'desc' },
        select: { version: true },
      })

      const [draft] = await ctx.prisma.$transaction([
        ctx.prisma.denialDraft.create({
          data: {
            orgId: ctx.orgId,
            rowId: row.id,
            artifact: drafted.artifact,
            body: drafted.body,
            summary: JSON.stringify(drafted.summary),
            version: (latest?.version ?? 0) + 1,
          },
        }),
        ctx.prisma.denialRow.updateMany({
          where: { id: row.id, orgId: ctx.orgId, status: 'TO_WORK' },
          data: { status: 'DRAFTED' },
        }),
        ctx.prisma.denialWorkedEvent.upsert({
          where: { rowId: row.id },
          create: { orgId: ctx.orgId, rowId: row.id },
          update: {},
        }),
      ])

      return { draft, artifactLabel: drafted.artifactLabel, summary: drafted.summary }
    }),

  /**
   * Ask for a change to a draft.
   *
   * reviseAppealLetter has existed since the public demo shipped, reachable only
   * by anonymous visitors on the marketing site. This is the same engine, for
   * the customers who are paying for it.
   */
  revise: orgProcedure
    .input(
      z.object({
        rowId: z.string(),
        instruction: z.string().min(1).max(2_000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const drafts = await ctx.prisma.denialDraft.findMany({
        where: { rowId: input.rowId, orgId: ctx.orgId },
        orderBy: { version: 'asc' },
      })
      const current = drafts[drafts.length - 1]
      if (!current) throw new TRPCError({ code: 'NOT_FOUND', message: 'Draft this denial first.' })

      const revised = await reviseAppealLetter({
        letter: current.body,
        instruction: input.instruction,
        history: drafts.slice(0, -1).map(d => ({ role: 'assistant' as const, text: d.body })),
      })

      const draft = await ctx.prisma.denialDraft.create({
        data: {
          orgId: ctx.orgId,
          rowId: input.rowId,
          artifact: current.artifact,
          body: revised.letter,
          summary: current.summary,
          version: current.version + 1,
        },
      })

      return { draft, reply: revised.reply }
    }),

  /**
   * What this workspace owes. Counted, not estimated.
   *
   * Priced from the tiers published on the marketing site. Invoiced by hand
   * while the numbers are small — metering first, checkout later.
   */
  usage: orgProcedure.query(async ({ ctx }) => {
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

    const [org, thisMonth, allTime] = await Promise.all([
      ctx.prisma.organization.findUnique({ where: { id: ctx.orgId } }),
      ctx.prisma.denialWorkedEvent.count({
        where: { orgId: ctx.orgId, createdAt: { gte: monthStart } },
      }),
      ctx.prisma.denialWorkedEvent.count({ where: { orgId: ctx.orgId } }),
    ])

    return { plan: org?.plan ?? 'TRIAGE', denialsWorkedThisMonth: thisMonth, denialsWorkedAllTime: allTime }
  }),
})

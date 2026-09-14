import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { router, orgProcedure } from '../trpc'
import { triage, triageRow, type ClaimRow } from '@/lib/denials/triage'
import { refineDenial } from '@/lib/denials/rarc'
import { searchWhere } from '@/lib/denials/search'
import { BANDS, callGuidance, scoreRow, type PriorityBand } from '@/lib/denials/score'
import { payerOf, payerTurnaround } from '@/lib/insights/aggregate'
import { FACT_ROW_CAP } from '@/lib/insights/facts'
import { draftResponseForRow } from '@/lib/denials/draft-response'
import { artifactFor } from '@/lib/billing/appeal-prompt'
import { getPlaybook } from '@/lib/billing/denial-playbooks'
import {
  DEFAULT_FOLLOW_UP_DAYS,
  SUBMISSION_CHANNELS,
  payerKey,
  resolveDestination,
} from '@/lib/billing/submission'
import { reviseAppealLetter } from '@/lib/billing/revise-appeal'
import { SUBMISSION_OUTCOMES, rowStatusForOutcome } from '@/lib/denials/outcomes'
import { money } from '@/lib/money'
import { draftAllowance, upgradeMessage } from '@/lib/plans'

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

/**
 * The first instant of the current calendar month, in the server's local zone.
 *
 * The free allowance resets on the 1st and both the wall and the meter have to
 * agree on when that is, so they read it from here rather than each building
 * their own date.
 */
function startOfMonth(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1)
}


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

/**
 * The biller's unsaved note and follow-up date, as they sit on screen.
 *
 * Drafting and revising both accept these, and both write them before they run.
 * The reason is a loop the dialog otherwise loses: a biller types what the payer
 * said on the phone, sets a date to chase it, and clicks "Draft the response"
 * without first clicking "Save note" — and the single most valuable sentence
 * about the claim is discarded at the moment it was most needed. Persisting here
 * means the note is saved because the work happened, not because the biller
 * remembered a second button.
 *
 * `undefined` means "the client is not telling us"; a null follow-up means the
 * biller cleared it, and an empty note means they erased it.
 */
const PENDING_WORK = {
  note: z.string().max(2_000).optional(),
  followUpAt: z.coerce.date().nullish(),
}

/**
 * Write those edits, and hand back the row the document will be drafted from.
 *
 * Reads the row after the write rather than trusting the input, so the drafting
 * context is whatever is actually stored — the same thing the biller will see
 * when the dialog refetches.
 */
async function saveAndLoadRow(
  ctx: { prisma: import('@prisma/client').PrismaClient; orgId: string },
  input: { rowId: string; note?: string; followUpAt?: Date | null },
) {
  if (input.note !== undefined || input.followUpAt !== undefined) {
    await ctx.prisma.denialRow.updateMany({
      where: { id: input.rowId, orgId: ctx.orgId },
      data: {
        ...(input.note === undefined ? {} : { note: input.note.trim() || null }),
        ...(input.followUpAt === undefined ? {} : { followUpAt: input.followUpAt }),
        lastTouchedAt: new Date(),
      },
    })
  }

  const row = await ctx.prisma.denialRow.findFirst({
    where: { id: input.rowId, orgId: ctx.orgId },
  })
  if (!row) throw new TRPCError({ code: 'NOT_FOUND' })
  return row
}

/**
 * The same two facts, written for a model that is revising rather than drafting.
 *
 * A revision only ever sees the letter and the instruction, so without this the
 * note is invisible to every version after the first. Returns null when there is
 * nothing to say, so the prompt omits the section rather than carrying a heading
 * over an empty body.
 */
function standingContext(row: { note: string | null; followUpAt: Date | null }): string | null {
  const parts: string[] = []
  const note = row.note?.trim()
  if (note) parts.push(`Note from the biller working this claim:\n${note}`)
  if (row.followUpAt) {
    parts.push(
      `The practice intends to follow up on ${row.followUpAt.toISOString().slice(0, 10)}. ` +
        `This is their own diary date, not a deadline the payer agreed to.`,
    )
  }
  return parts.length ? parts.join('\n\n') : null
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
    // Every band, not just the two the tiles lead with. The tiles answer "how
    // much is urgent"; the chart beside them answers "how is the whole queue
    // shaped", and that question needs the quiet bands too — a queue that is
    // 90% "can wait" and one that is 90% "work now" produce the same two tiles.
    const byBand: Record<PriorityBand, { count: number; billed: number }> = {
      now: { count: 0, billed: 0 },
      soon: { count: 0, billed: 0 },
      later: { count: 0, billed: 0 },
      parked: { count: 0, billed: 0 },
    }
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
      byBand[scored.band].count += 1
      byBand[scored.band].billed += base.billed
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
      // Ordered most urgent first, and always all four — a band with nothing in
      // it is a fact about the queue, so it is sent as a zero rather than
      // dropped. A chart whose categories come and go cannot be read across two
      // visits to the page.
      byBand: BANDS.map(band => ({
        band,
        count: byBand[band].count,
        billed: Math.round(byBand[band].billed * 100) / 100,
      })),
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
          // Free text over the row's own columns. Filtered in SQL rather than
          // in the client, because the table only renders the top slice by
          // priority and a claim someone is hunting for is, by definition, the
          // one they could not find in it.
          q: z.string().max(120).optional(),
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
            ...searchWhere(input?.q),
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
   * A follow-up date on its own.
   *
   * setStatus takes one too, but only as a passenger: until this existed the
   * date input in RowDetail could not be saved without also clicking a status
   * button, so "I called, they are reprocessing it, check back Friday" forced
   * the biller to move the row to a status that was not true.
   */
  setFollowUp: orgProcedure
    .input(
      z.object({
        rowId: z.string(),
        /** Null clears it. */
        followUpAt: z.coerce.date().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.prisma.denialRow.updateMany({
        where: { id: input.rowId, orgId: ctx.orgId },
        data: { followUpAt: input.followUpAt, lastTouchedAt: new Date() },
      })
      if (result.count === 0) throw new TRPCError({ code: 'NOT_FOUND' })
      return { success: true }
    }),

  /**
   * Where this denial goes, and what has to travel with it.
   *
   * A separate query rather than another field on `rows`: this is only needed
   * once a biller opens one row, and `rows` already runs four derivations per
   * row against a capped read. Widening it for something the table never renders
   * would slow the queue for every workspace.
   *
   * Resolved on read like every other derived thing here. A destination written
   * to the database goes stale the moment a payer moves its appeals unit, and
   * the customer's own saved entry is the one that has to win anyway.
   */
  destination: orgProcedure
    .input(z.object({ rowId: z.string() }))
    .query(async ({ ctx, input }) => {
      const row = await ctx.prisma.denialRow.findFirst({
        where: { id: input.rowId, orgId: ctx.orgId },
        select: { carc: true, payer: true },
      })
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' })

      const key = payerKey(row.payer)
      const saved = key
        ? await ctx.prisma.payerDestination.findUnique({
            where: { orgId_payerKey: { orgId: ctx.orgId, payerKey: key } },
          })
        : null

      return resolveDestination({
        payerName: row.payer,
        carc: row.carc,
        artifact: artifactFor(getPlaybook(row.carc)),
        orgDestination: saved
          ? {
              payerLabel: saved.payerLabel,
              channel: saved.channel,
              portalUrl: saved.portalUrl,
              faxNumber: saved.faxNumber,
              mailingAddress: saved.mailingAddress,
              notes: saved.notes,
            }
          : null,
      })
    }),

  /** Every attempt at getting a document to the payer for this row. */
  submissions: orgProcedure
    .input(z.object({ rowId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.denialSubmission.findMany({
        where: { rowId: input.rowId, orgId: ctx.orgId },
        orderBy: { sentAt: 'desc' },
        take: 20,
      })
    }),

  /**
   * Record that a document actually went to the payer.
   *
   * This is what `status: SENT` should always have meant. On its own the status
   * says a button was clicked; it does not say through which channel, on what
   * date, or under what confirmation number — and a payer that refuses an appeal
   * as untimely is answered with exactly those three facts. Keeping them outside
   * the product was the reason a biller still needed a spreadsheet.
   *
   * NOTE FOR ANYONE EXTENDING THIS: the input is `.strict()` and names no
   * patient field, deliberately. The identifiers are merged into the document in
   * the browser (lib/appeals/merge.ts) and must not become a mutation argument —
   * a name arriving here would be the first PHI ever to reach the server and
   * would quietly end the property that lets a workspace run without a BAA.
   */
  recordSubmission: orgProcedure
    .input(
      z
        .object({
          rowId: z.string(),
          draftId: z.string().optional(),
          draftVersion: z.number().int().positive().optional(),
          channel: z.enum(SUBMISSION_CHANNELS),
          destination: z.string().min(1).max(500),
          sentAt: z.coerce.date(),
          confirmationRef: z.string().max(200).optional(),
          notes: z.string().max(2_000).optional(),
          /** Omitted means "use the default"; null means the biller cleared it. */
          followUpAt: z.coerce.date().nullish(),
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.prisma.denialRow.findFirst({
        where: { id: input.rowId, orgId: ctx.orgId },
        select: { id: true },
      })
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' })

      // Undefined and null mean different things: nothing chosen falls back to
      // the default so a sent row never sits with no follow-up at all, but an
      // explicit null is the biller saying they do not want one.
      const followUpAt =
        input.followUpAt === undefined
          ? new Date(input.sentAt.getTime() + DEFAULT_FOLLOW_UP_DAYS * 86_400_000)
          : input.followUpAt

      const [submission] = await ctx.prisma.$transaction([
        ctx.prisma.denialSubmission.create({
          data: {
            orgId: ctx.orgId,
            rowId: input.rowId,
            draftId: input.draftId ?? null,
            draftVersion: input.draftVersion ?? null,
            channel: input.channel,
            destination: input.destination,
            sentAt: input.sentAt,
            confirmationRef: input.confirmationRef?.trim() || null,
            notes: input.notes?.trim() || null,
            submittedById: ctx.session?.user?.id ?? null,
          },
        }),
        ctx.prisma.denialRow.updateMany({
          where: { id: input.rowId, orgId: ctx.orgId },
          data: { status: 'SENT', lastTouchedAt: new Date(), followUpAt },
        }),
      ])

      return { submission }
    }),

  /**
   * Record what the payer sent back.
   *
   * The other half of recordSubmission, and the reason that one is worth
   * having. A submission with no outcome says a letter went out; the pair says
   * whether this argument, to this payer, on this reason code, is one that gets
   * paid — which is a fact about the payer that exists in no manual, no
   * clearinghouse feed and no model's training data, and can only be learned by
   * writing it down every time.
   *
   * Written onto the submission, never onto the row. A denial that loses a
   * first-level appeal and wins a second-level one has to keep both halves; the
   * row can only hold the last one. See the comment on DenialSubmission.
   *
   * Re-recordable on purpose. Outcomes get typed in from a determination letter
   * that turns out to cover a different claim, and a ledger a biller cannot
   * correct is one they stop trusting and then stop filling in. PENDING is
   * accepted here — though the form does not offer it — so a mis-click can be
   * put back.
   *
   * NOTE FOR ANYONE EXTENDING THIS: `.strict()`, and no patient field, for the
   * same reason recordSubmission has none. A determination letter names the
   * patient; what gets stored from it is the ruling, the date, the amount and
   * the code.
   */
  recordOutcome: orgProcedure
    .input(
      z
        .object({
          submissionId: z.string(),
          outcome: z.enum(SUBMISSION_OUTCOMES),
          /** The date on the determination, not the date this was typed in. */
          outcomeAt: z.coerce.date().nullish(),
          amountRecovered: z.number().nonnegative().max(10_000_000).nullish(),
          outcomeCarc: z.string().max(20).nullish(),
          outcomeNote: z.string().max(2_000).nullish(),
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      const submission = await ctx.prisma.denialSubmission.findFirst({
        where: { id: input.submissionId, orgId: ctx.orgId },
        select: { id: true, rowId: true, sentAt: true },
      })
      if (!submission) throw new TRPCError({ code: 'NOT_FOUND' })

      // A determination cannot predate the letter it answers. Almost always a
      // mistyped year, and it would sit in the median turnaround as a negative
      // number forever, so it is refused at the door rather than filtered out
      // of the aggregate later.
      if (input.outcomeAt && input.outcomeAt.getTime() < submission.sentAt.getTime()) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'That date is before the submission went out. Check the year.',
        })
      }

      const now = new Date()
      const resolved = input.outcome !== 'PENDING'
      const nextStatus = rowStatusForOutcome(input.outcome)

      await ctx.prisma.$transaction([
        // updateMany for the orgId in the where clause, same as everywhere else.
        ctx.prisma.denialSubmission.updateMany({
          where: { id: input.submissionId, orgId: ctx.orgId },
          data: {
            outcome: input.outcome,
            // Undated is allowed: "they denied it, I do not have the letter in
            // front of me" is a real answer and a far better one than nothing.
            // It counts in the win rate and sits out of the median turnaround.
            outcomeAt: resolved ? (input.outcomeAt ?? null) : null,
            amountRecovered: resolved ? (input.amountRecovered ?? null) : null,
            outcomeCarc: resolved ? (input.outcomeCarc?.trim() || null) : null,
            outcomeNote: resolved ? (input.outcomeNote?.trim() || null) : null,
            outcomeSource: resolved ? 'BILLER' : null,
            outcomeById: resolved ? (ctx.session?.user?.id ?? null) : null,
            outcomeRecordedAt: resolved ? now : null,
          },
        }),
        ctx.prisma.denialRow.updateMany({
          where: { id: submission.rowId, orgId: ctx.orgId },
          data: {
            ...(nextStatus ? { status: nextStatus } : {}),
            lastTouchedAt: now,
            // The follow-up existed to prompt exactly this. Recording the answer
            // is what it was waiting for, so it clears — a row that came back
            // denied re-enters the queue on its filing deadline, which is now
            // much shorter, rather than on a date set before anyone knew.
            followUpAt: null,
          },
        }),
      ])

      return { success: true }
    }),

  /**
   * Appeals that went out and were never closed out.
   *
   * The ledger is only worth what gets written into it, so the gap has to be
   * visible somewhere a biller already looks rather than inferable from a
   * report nobody runs. Oldest first: the ones most likely to have been decided
   * weeks ago and forgotten.
   */
  awaitingOutcome: orgProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(25) }).optional())
    .query(async ({ ctx, input }) => {
      const submissions = await ctx.prisma.denialSubmission.findMany({
        where: { orgId: ctx.orgId, outcome: 'PENDING' },
        orderBy: { sentAt: 'asc' },
        take: input?.limit ?? 25,
        select: {
          id: true,
          rowId: true,
          channel: true,
          destination: true,
          sentAt: true,
          confirmationRef: true,
          row: {
            select: { claimNumber: true, payer: true, carc: true, billed: true, status: true },
          },
        },
      })

      const now = Date.now()
      return submissions.map(s => ({
        id: s.id,
        rowId: s.rowId,
        channel: s.channel,
        destination: s.destination,
        sentAt: s.sentAt,
        confirmationRef: s.confirmationRef,
        claimNumber: s.row.claimNumber,
        payer: s.row.payer,
        carc: s.row.carc,
        billed: money(s.row.billed),
        rowStatus: s.row.status,
        // Derived here rather than stored, same as every other interval.
        daysOut: Math.floor((now - s.sentAt.getTime()) / 86_400_000),
      }))
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
    .input(z.object({ rowId: z.string(), ...PENDING_WORK }))
    .mutation(async ({ ctx, input }) => {
      // The practice signs the letter, so it is loaded alongside the row. Without
      // it the model was left to guess at a signature block and did exactly that
      // — inventing a plausible practice name, which is worse than the
      // [PRACTICE NAME] placeholder because nobody catches it before it is sent.
      const [row, practice, workedThisMonth] = await Promise.all([
        saveAndLoadRow(ctx, input),
        ctx.prisma.organization.findUnique({
          where: { id: ctx.orgId },
          select: {
            plan: true,
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
          },
        }),
        ctx.prisma.denialWorkedEvent.count({
          where: { orgId: ctx.orgId, createdAt: { gte: startOfMonth(new Date()) } },
        }),
      ])

      // The wall, checked here so a refused draft never spends a model call.
      //
      // Only a *new* billable unit is refused. A denial already counted stays
      // draftable, because the alternative is locking a biller out of the letter
      // they already spent the allowance on. DenialWorkedEvent is unique per
      // row, so redrafting one can never consume a second unit anyway.
      const allowance = draftAllowance(practice?.plan ?? 'TRIAGE', workedThisMonth)
      if (allowance.atLimit) {
        const alreadyWorked = await ctx.prisma.denialWorkedEvent.findFirst({
          where: { rowId: row.id, orgId: ctx.orgId },
          select: { id: true },
        })
        if (!alreadyWorked) {
          // Deliberately not FORBIDDEN: isNoWorkspace() in
          // components/insights/NoWorkspace.tsx matches that code and would
          // render this as "this account has no workspace" — wrong, and not
          // something the reader could act on.
          throw new TRPCError({
            code: 'TOO_MANY_REQUESTS',
            message: upgradeMessage(
              `This workspace has worked all ${allowance.limit} of its denials this month.`,
            ),
          })
        }
      }

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
          // What the export could never carry: what the payer actually said, and
          // when the biller means to chase it. The first draft is built around
          // these rather than needing to be argued into them afterwards.
          billerNote: row.note,
          followUpAt: row.followUpAt,
        },
        new Date(),
        practice,
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
        ...PENDING_WORK,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [row, drafts] = await Promise.all([
        saveAndLoadRow(ctx, input),
        ctx.prisma.denialDraft.findMany({
          where: { rowId: input.rowId, orgId: ctx.orgId },
          orderBy: { version: 'asc' },
        }),
      ])
      const current = drafts[drafts.length - 1]
      if (!current) throw new TRPCError({ code: 'NOT_FOUND', message: 'Draft this denial first.' })

      const revised = await reviseAppealLetter({
        letter: current.body,
        instruction: input.instruction,
        history: drafts.slice(0, -1).map(d => ({ role: 'assistant' as const, text: d.body })),
        // Re-sent on every revision. The model rewrites the whole letter each
        // time, so a note supplied only on the first pass is dropped by the
        // second along with everything the first drew from it.
        context: standingContext(row) ?? undefined,
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
    const monthStart = startOfMonth(now)

    const [org, thisMonth, allTime] = await Promise.all([
      ctx.prisma.organization.findUnique({
        where: { id: ctx.orgId },
        select: { plan: true },
      }),
      ctx.prisma.denialWorkedEvent.count({
        where: { orgId: ctx.orgId, createdAt: { gte: monthStart } },
      }),
      ctx.prisma.denialWorkedEvent.count({ where: { orgId: ctx.orgId } }),
    ])

    // The allowance is computed, never stored — same rule as every other derived
    // number here. A limit written to the database is wrong the moment the plan
    // changes, and the plan changes from a Stripe webhook we do not control.
    return {
      ...draftAllowance(org?.plan ?? 'TRIAGE', thisMonth),
      // The 1st of next month. Month 12 rolls the year over on its own.
      resetsAt: new Date(now.getFullYear(), now.getMonth() + 1, 1),
      denialsWorkedThisMonth: thisMonth,
      denialsWorkedAllTime: allTime,
    }
  }),
})

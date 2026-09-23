import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import type { DenialEventKind } from '@prisma/client'
import { router, orgProcedure, practiceProcedure } from '../trpc'
import { triage, triageRow, type ClaimRow } from '@/lib/denials/triage'
import { searchWhere } from '@/lib/denials/search'
import {
  buildWorklistRow,
  compareWorklistRows,
  medianFor,
} from '@/lib/denials/worklist-row'
import { BANDS, scoreRow, type PriorityBand } from '@/lib/denials/score'
import { loadPayerMedians } from '@/lib/denials/payer-medians'
import { FACT_ROW_CAP } from '@/lib/insights/facts'
import { draftResponseForRow } from '@/lib/denials/draft-response'
import { writeNoteFromRough } from '@/lib/denials/write-note'
import { standingContext } from '@/lib/denials/standing-context'
import { artifactFor } from '@/lib/billing/appeal-prompt'
import { getPlaybook } from '@/lib/billing/denial-playbooks'
import {
  DEFAULT_FOLLOW_UP_DAYS,
  SUBMISSION_CHANNELS,
  payerKey,
  resolveDestination,
} from '@/lib/billing/submission'
import { reviseAppealLetter } from '@/lib/billing/revise-appeal'
/*
  A server file importing lib/appeals/merge.ts will look, to the next reader,
  exactly like the thing that file's header forbids. It is not. The warning there
  is about merge.ts acquiring a server dependency — the merge itself moving onto
  the server, which is what would put a patient's name in a request body. This is
  the opposite direction: the server borrowing the browser's own definition of
  which placeholders are a patient's, so that the rule enforced at the write and
  the rule the biller is shown are literally the same code.
*/
import { droppedPatientSlots } from '@/lib/appeals/merge'
import { practiceIdentity, PRACTICE_IDENTITY_SELECT } from '@/lib/practices/identity'
import { loadPracticeNames } from '@/lib/practices/names'
import { SUBMISSION_OUTCOMES, isWin, rowStatusForOutcome } from '@/lib/denials/outcomes'
import { statusLabel } from '@/lib/denials/status'
import { buildClaimTimeline, followUpCount } from '@/lib/claims/timeline'
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
 * Each payer's median days to settle, memoised for this request.
 *
 * The load itself is lib/denials/payer-medians.ts, shared with the export route
 * so both agree on which A/R snapshot the medians come from. What stays here is
 * only the memo: summary and rows both want this and arrive in the same batched
 * request, so it must not be two queries.
 *
 * A workspace with no claims export gets an empty map and the call guidance
 * degrades to a labelled rule of thumb rather than disappearing — see
 * callGuidance in lib/denials/score.ts.
 */
function payerMedians(ctx: {
  prisma: import('@prisma/client').PrismaClient
  orgId: string
  once: import('../context').Memo
  practiceWhere: import('@/lib/practices/scope').PracticeWhere
  practiceId: string | null
}): Promise<Map<string, number>> {
  // Practice in the key, for the reason ../context.ts states: anything varying
  // by input must put that input in the key. Without it the first query of a
  // batched request fixes the scope for every later one.
  return ctx.once(`worklist:payerMedians:${ctx.practiceId ?? 'all'}`, () =>
    loadPayerMedians(ctx.prisma, ctx.orgId, ctx.practiceWhere),
  )
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

/** yyyy-mm-dd, or "cleared" — what a FOLLOW_UP_SET event records. */
function followUpDetail(date: Date | null): string {
  return date ? date.toISOString().slice(0, 10) : 'cleared'
}

/**
 * The events a note/follow-up write should leave behind.
 *
 * Built rather than written so every path that can change these two fields —
 * setNote, setFollowUp, setStatus's passenger, and the implicit save inside
 * draft/revise — records the same history. Before this, DenialRow.note was a
 * single column that each save overwrote, so "what did we already try on this
 * claim" was answerable only for the most recent attempt.
 *
 * Returns [] when nothing changed, so a no-op save does not litter the timeline.
 * An empty note is still an event: erasing what the payer said is a thing that
 * happened, and the text survives on the previous NOTE_ADDED row.
 */
function workEvents(
  input: { note?: string; followUpAt?: Date | null },
  actorId: string | null,
): { kind: DenialEventKind; detail: string; actorId: string | null }[] {
  const events: { kind: DenialEventKind; detail: string; actorId: string | null }[] = []
  if (input.note !== undefined) {
    events.push({ kind: 'NOTE_ADDED', detail: input.note.trim(), actorId })
  }
  if (input.followUpAt !== undefined) {
    events.push({ kind: 'FOLLOW_UP_SET', detail: followUpDetail(input.followUpAt), actorId })
  }
  return events
}

/**
 * Write those edits, and hand back the row the document will be drafted from.
 *
 * Reads the row after the write rather than trusting the input, so the drafting
 * context is whatever is actually stored — the same thing the biller will see
 * when the dialog refetches.
 *
 * The update and its events go in one transaction: a note recorded without its
 * history, or a history entry for a write that failed, are both worse than
 * neither.
 */
async function saveAndLoadRow(
  ctx: { prisma: import('@prisma/client').PrismaClient; orgId: string },
  input: { rowId: string; note?: string; followUpAt?: Date | null; actorId?: string | null },
) {
  if (input.note !== undefined || input.followUpAt !== undefined) {
    const events = workEvents(input, input.actorId ?? null)
    await ctx.prisma.$transaction([
      ctx.prisma.denialRow.updateMany({
        where: { id: input.rowId, orgId: ctx.orgId },
        data: {
          ...(input.note === undefined ? {} : { note: input.note.trim() || null }),
          ...(input.followUpAt === undefined ? {} : { followUpAt: input.followUpAt }),
          lastTouchedAt: new Date(),
        },
      }),
      ctx.prisma.denialEvent.createMany({
        data: events.map(e => ({ ...e, orgId: ctx.orgId, rowId: input.rowId })),
      }),
    ])
  }

  const row = await ctx.prisma.denialRow.findFirst({
    where: { id: input.rowId, orgId: ctx.orgId },
  })
  if (!row) throw new TRPCError({ code: 'NOT_FOUND' })
  return row
}

/**
 * When the note that is about to feed a draft was written.
 *
 * The note itself lives on DenialRow and is overwritten on every save, so a
 * version that says "drafted from your note" has no way to say *which* note
 * unless the timestamp is captured at the moment of drafting. Reads the newest
 * NOTE_ADDED event, which is the row the same save has just written.
 *
 * Null when there is no note: a draft built from nothing must not claim to have
 * been built from something.
 */
async function noteWrittenAt(
  ctx: { prisma: import('@prisma/client').PrismaClient; orgId: string },
  rowId: string,
  note: string | null,
): Promise<Date | null> {
  if (!note?.trim()) return null
  const event = await ctx.prisma.denialEvent.findFirst({
    where: { orgId: ctx.orgId, rowId, kind: 'NOTE_ADDED' },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  })
  return event?.createdAt ?? null
}

/**
 * The PHI boundary, enforced at the one write that can cross it.
 *
 * An editable letter body means a biller can select "[PATIENT NAME]", type
 * "Jane Doe" and save — and that body is a server-owned column. Nothing can
 * recognise a name, but the placeholder that stood there is measurably gone, and
 * `droppedPatientSlots` is the same function the textarea runs on every
 * keystroke. A biller who is blocked in the browser and a biller who posts
 * straight to the API get the identical rule.
 *
 * Not a zod .superRefine, which was the shape originally planned: the body this
 * has to be compared against is the previously stored version, which is in the
 * database and not in the input. A refinement over a client-supplied "before"
 * would be checking the edit against whatever the caller said it started from,
 * which is no check at all.
 */
function assertNoPatientSlotLost(before: string, after: string) {
  const dropped = droppedPatientSlots(before, after)
  if (dropped.length === 0) return
  throw new TRPCError({
    code: 'BAD_REQUEST',
    message:
      'Patient details go in the fields below the letter, not in the letter — Yeam never ' +
      `receives them. Put ${dropped.map(d => d.token).join(', ')} back and fill it in there.`,
  })
}

export const worklistRouter = router({
  /**
   * The tiles, over every open row in view.
   *
   * On practiceProcedure and not orgProcedure, which is the easy one to forget:
   * this is a separate query from `rows`, so a practice filter applied to the
   * table and not to the tiles gives a biller eleven rows under a tile that
   * says forty — and the tile is the number they would repeat in a status
   * meeting. All three reads below carry it.
   */
  summary: practiceProcedure.query(async ({ ctx }) => {
    const today = new Date()

    const [rows, settled, followUpsDue] = await Promise.all([
      // Capped, not paginated: the bands below are derived per row, so there is
      // no SQL predicate that could select "the interesting ones" up front.
      ctx.prisma.denialRow.findMany({
        where: { orgId: ctx.orgId, ...ctx.practiceWhere, status: { notIn: ['PAID', 'DEAD'] } },
        take: FACT_ROW_CAP,
      }),
      // Recovered money is the only number a customer will check against their
      // bank, so it counts nothing but rows a human marked PAID. A sum and a
      // count are all this needs — it used to load every paid row to add them
      // up in JS, which grows without bound and forever.
      ctx.prisma.denialRow.aggregate({
        where: { orgId: ctx.orgId, ...ctx.practiceWhere, status: 'PAID' },
        _sum: { billed: true },
        _count: true,
      }),
      ctx.prisma.denialRow.count({
        where: {
          orgId: ctx.orgId,
          ...ctx.practiceWhere,
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
  rows: practiceProcedure
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
          /**
           * Only rows that have moved since this person last said they had seen
           * the queue.
           *
           * Filtered here rather than in the client so the count above the
           * table, the rows in it and the paging underneath are all talking
           * about the same set. A client-side filter over the loaded page would
           * say "7 changed" and then show four of them.
           */
          changedOnly: z.boolean().optional(),
          /**
           * Where the previous page stopped — the full sort tuple, not an offset.
           *
           * Offsets cannot work here. The ranking is derived on read from
           * today's date, so between two requests a row can cross a deadline
           * threshold, change score, and move: an offset would then skip one row
           * and repeat another. A cursor naming the exact row the last page
           * ended on survives that, because it is matched by identity.
           */
          cursor: z
            .object({
              score: z.number(),
              daysLeft: z.number().nullable(),
              billed: z.number(),
              id: z.string(),
            })
            .nullish(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session?.user?.id
      const [rows, medians, pref, practiceNames] = await Promise.all([
        ctx.prisma.denialRow.findMany({
          where: {
            orgId: ctx.orgId,
            ...ctx.practiceWhere,
            ...(input?.batchId ? { batchId: input.batchId } : {}),
            ...(input?.status ? { status: input.status } : {}),
            ...searchWhere(input?.q),
          },
          // An explicit select, not the whole row. This reads up to FACT_ROW_CAP
          // (50,000) records to score them, so every column that comes back and
          // is never used is paid for fifty thousand times.
          //
          // It also no longer carries `include: { _count: { drafts } }`, which
          // was a correlated subquery per row — 50,000 of them to render 200.
          // The count is fetched below, for the page that is actually returned.
          select: {
            id: true,
            status: true,
            note: true,
            claimNumber: true,
            payer: true,
            carc: true,
            billed: true,
            denialDate: true,
            cpt: true,
            icd10: true,
            reason: true,
            lastTouchedAt: true,
            reconciledAt: true,
            followUpAt: true,
            practiceId: true,
          },
          take: FACT_ROW_CAP,
        }),
        payerMedians(ctx),
        /*
          When this person last said they had seen the queue.

          Read here rather than accepted as an input. It could have been passed
          from the client — it is already in the preference query the page runs —
          but that would put it in the query key, and every "mark all seen" would
          then re-run the scoring pass over the whole candidate set twice: once
          to drop the count to zero, once when the key changed back. One indexed
          lookup on a unique pair is cheaper than that.

          ── Why this one read is allowed to fail ──────────────────────────────

          Because it is the queue hanging off it. `rows` is the product's home
          page, and the digest built on this value is a convenience on top of it:
          a workspace that cannot read a preference row should see its denials
          with no dots on them, not an empty table.

          That is not hypothetical. `worklist_preferences` is one of the
          migrations not yet applied to production (DEPLOY.md:148 — they go on by
          hand), so shipping this coupled hard would have emptied the worklist for
          every customer until the backlog landed. In development the same thing
          happens to a dev server started before the migration: it holds a Prisma
          Client with no `worklistPreference` on it and the property is undefined,
          which is why this is a try/catch around an await rather than a
          `.catch()` on the promise — there is no promise to attach to when the
          delegate itself is missing.

          Logged, not swallowed. A silent fallback here would hide a real outage
          of the preferences table behind a feature quietly not working.
        */
        (async () => {
          if (!userId) return null
          try {
            const row = await ctx.prisma.worklistPreference.findUnique({
              where: { orgId_userId: { orgId: ctx.orgId, userId } },
              select: { worklistSeenAt: true },
            })
            return row
          } catch (err) {
            console.error('worklist digest: preference read failed, digest off', err)
            return null
          }
        })(),
        // Memoized: `summary` and the export ask for the same map on the same
        // batched request, and it is the same handful of rows every time.
        ctx.once(`practiceNames:${ctx.orgId}`, () =>
          loadPracticeNames(ctx.prisma, ctx.orgId),
        ),
      ])
      const seenAt = pref?.worklistSeenAt ?? null

      const today = new Date()
      // Scored without draft counts: the count is not an input to the score, so
      // fetching it for 50,000 rows to rank them would be work thrown away.
      const triaged = rows
        .map(row =>
          buildWorklistRow(
            { ...row, billed: money(row.billed) },
            {
              today,
              payerMedianDaysToPay: medianFor(medians, row.payer),
              draftCount: 0,
              practiceNames,
            },
          ),
        )
        .sort(compareWorklistRows)

      /*
        What has moved since they last looked.

        Counted over the whole candidate set, not the page, because "7 rows
        changed" is a digest and a digest that only covers the first hundred rows
        understates itself silently. It costs nothing extra: these rows are
        already in memory to be scored.

        Null seenAt means nobody has ever marked the queue seen, and then the
        honest count is zero rather than "everything" — a badge on every row on
        the first morning is noise, and noise is how a signal like this gets
        trained out of a team.
      */
      const changed = seenAt
        ? triaged.filter(r => r.changedAt !== null && r.changedAt > seenAt)
        : []
      const visible = input?.changedOnly ? changed : triaged

      // Everything strictly after the cursor row in the sort order. findIndex on
      // the id rather than on the tuple: the id is what makes the order total,
      // and a row whose score moved since the last page is still the same row.
      const from = input?.cursor
        ? (() => {
            const at = visible.findIndex(r => r.id === input.cursor!.id)
            // A cursor row that has left the result set — filtered away, or
            // reconciled by an import between pages — falls back to the tuple
            // rather than restarting the list from the top.
            if (at !== -1) return at + 1
            const c = input.cursor!
            const idx = visible.findIndex(r => compareWorklistRows(r, c) > 0)
            return idx === -1 ? visible.length : idx
          })()
        : 0

      const limit = input?.limit ?? 100
      const page = visible.slice(from, from + limit)
      const last = page[page.length - 1]
      const nextCursor =
        from + limit < visible.length && last
          ? { score: last.score, daysLeft: last.daysLeft, billed: last.billed, id: last.id }
          : null

      // One grouped query for the page, instead of a subquery per candidate row.
      const counts = page.length
        ? await ctx.prisma.denialDraft.groupBy({
            by: ['rowId'],
            where: { orgId: ctx.orgId, rowId: { in: page.map(r => r.id) } },
            _count: { _all: true },
          })
        : []
      const draftCounts = new Map(counts.map(c => [c.rowId, c._count._all]))

      return {
        items: page.map(row => ({ ...row, draftCount: draftCounts.get(row.id) ?? 0 })),
        nextCursor,
        /** The whole result set, so the client can say how deep the queue is. */
        total: visible.length,
        /** How many rows have moved since this person last marked the queue seen. */
        changedCount: changed.length,
        /** Null until they mark it seen once — the digest stays off until then. */
        seenAt,
      }
    }),

  /**
   * Denial imports only.
   *
   * The batch table holds claims snapshots too since imports were generalised.
   * Counting those here would make a workspace that has only uploaded an A/R
   * export look like it has a worklist, and render an empty table instead of the
   * import box.
   */
  batches: practiceProcedure.query(async ({ ctx }) => {
    return ctx.prisma.importBatch.findMany({
      where: { orgId: ctx.orgId, ...ctx.practiceWhere, kind: 'DENIALS' },
      orderBy: { createdAt: 'desc' },
      take: 25,
    })
  }),

  /**
   * The example questions the assistant offers before anyone has typed.
   *
   * Three of the four starters are workspace-agnostic and stay hardcoded in the
   * client. The fourth named a payer — "How is Aetna doing versus the rest?" —
   * which in a workspace with no Aetna sends the model to a tool that correctly
   * returns nothing, and the model answers that there is no such data. That
   * reads as the assistant refusing, and it was the most reproducible way to see
   * it happen: a suggested question the product itself guaranteed would fail.
   *
   * Returns the payer carrying the most open denials, or null when the workspace
   * is empty and the client should fall back to a question about no payer at all.
   */
  starters: practiceProcedure.query(async ({ ctx }) => {
    const byPayer = await ctx.prisma.denialRow.groupBy({
      by: ['payer'],
      where: { orgId: ctx.orgId, ...ctx.practiceWhere, status: { notIn: ['PAID', 'DEAD'] } },
      _count: { _all: true },
      orderBy: { _count: { payer: 'desc' } },
      take: 1,
    })

    // A blank payer is left as null rather than run through payerOf(): the
    // label that function returns reads fine in a table and badly in a question,
    // and "How is Unknown payer doing versus the rest?" is not worth suggesting.
    const topPayer = byPayer[0]?.payer?.trim() || null

    return { topPayer }
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
      const actorId = ctx.session?.user?.id ?? null
      const [result] = await ctx.prisma.$transaction([
        ctx.prisma.denialRow.updateMany({
          where: { id: input.rowId, orgId: ctx.orgId },
          data: {
            status: input.status,
            lastTouchedAt: new Date(),
            ...(input.followUpAt === undefined ? {} : { followUpAt: input.followUpAt }),
          },
        }),
        ctx.prisma.denialEvent.createMany({
          data: [
            {
              orgId: ctx.orgId,
              rowId: input.rowId,
              kind: input.status === 'TO_WORK' ? 'REOPENED' : 'STATUS_CHANGED',
              detail: statusLabel(input.status),
              actorId,
            },
            // The date rides along on this mutation, so its history has to as
            // well — otherwise a follow-up set while marking a row SENT would be
            // the one change that left no trace.
            ...(input.followUpAt === undefined
              ? []
              : [{
                  orgId: ctx.orgId,
                  rowId: input.rowId,
                  kind: 'FOLLOW_UP_SET' as const,
                  detail: followUpDetail(input.followUpAt),
                  actorId,
                }]),
          ],
        }),
      ])
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
      const [result] = await ctx.prisma.$transaction([
        ctx.prisma.denialRow.updateMany({
          where: { id: input.rowId, orgId: ctx.orgId },
          data: { note: trimmed || null, lastTouchedAt: new Date() },
        }),
        // The column holds the current note; this holds every note. Overwriting
        // the column is still correct — draft-response.ts wants the latest — but
        // it is no longer destructive, because the previous text is here.
        ctx.prisma.denialEvent.createMany({
          data: [{
            orgId: ctx.orgId,
            rowId: input.rowId,
            kind: 'NOTE_ADDED',
            detail: trimmed,
            actorId: ctx.session?.user?.id ?? null,
          }],
        }),
      ])
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
      const [result] = await ctx.prisma.$transaction([
        ctx.prisma.denialRow.updateMany({
          where: { id: input.rowId, orgId: ctx.orgId },
          data: { followUpAt: input.followUpAt, lastTouchedAt: new Date() },
        }),
        ctx.prisma.denialEvent.createMany({
          data: [{
            orgId: ctx.orgId,
            rowId: input.rowId,
            kind: 'FOLLOW_UP_SET',
            detail: followUpDetail(input.followUpAt),
            actorId: ctx.session?.user?.id ?? null,
          }],
        }),
      ])
      if (result.count === 0) throw new TRPCError({ code: 'NOT_FOUND' })
      return { success: true }
    }),

  /**
   * This person's layout, and where they were when they last left.
   *
   * Returns null rather than defaults when nothing has been chosen, so the
   * client can tell "never set" from "set to the same value as the default" and
   * keep reading its own constants.
   */
  preference: orgProcedure.query(async ({ ctx }) => {
    const userId = ctx.session?.user?.id
    if (!userId) return null
    const row = await ctx.prisma.worklistPreference.findUnique({
      where: { orgId_userId: { orgId: ctx.orgId, userId } },
      select: {
        columnWidths: true,
        splitRatio: true,
        lastRowId: true,
        lastStep: true,
        worklistSeenAt: true,
        scratchRowId: true,
        scratchBody: true,
        scratchBaseVersion: true,
        scratchAt: true,
      },
    })
    if (!row) return null

    // columnWidths is narrowed here rather than handed over as Prisma's
    // JsonValue. That type is a deeply recursive union, and pushing it through
    // tRPC's inference blows TypeScript's instantiation depth in the client —
    // the same limit that forces components/worklist/types.ts to be written by
    // hand. Narrowing at the boundary keeps the cost on this side of the wire.
    return {
      ...row,
      columnWidths: (row.columnWidths ?? null) as Record<string, number> | null,
    }
  }),

  /**
   * Save part of it. Every field is optional; only what is sent is written.
   *
   * One mutation rather than four, because these are written from four unrelated
   * gestures — dragging a divider, dragging a column, opening a row, scrolling
   * the panel — and none of them should have to know about the others. `.strict()`
   * so a field added to the client without a matching column here fails loudly
   * rather than being silently dropped.
   */
  savePreference: orgProcedure
    .input(
      z
        .object({
          columnWidths: z.record(z.string(), z.number()).optional(),
          splitRatio: z.number().min(0.2).max(0.9).optional(),
          /** Null clears the resume pointer — "I am done with that row". */
          lastRowId: z.string().nullish(),
          /*
            Which pane of the work panel to reopen on. The panel steps rather
            than scrolls (lib/denials/panes.ts), and `outcome` was added when
            the outcome form became a pane of its own. A String column, so rows
            written before that still hold one of the first three — the client
            validates what it reads rather than trusting it.
          */
          lastStep: z.enum(['note', 'draft', 'send', 'outcome']).nullish(),
          worklistSeenAt: z.coerce.date().nullish(),
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session?.user?.id
      if (!userId) throw new TRPCError({ code: 'UNAUTHORIZED' })

      // Only the keys actually sent, so saving a column width cannot blank the
      // resume pointer by omission.
      const data = {
        ...(input.columnWidths === undefined ? {} : { columnWidths: input.columnWidths }),
        ...(input.splitRatio === undefined ? {} : { splitRatio: input.splitRatio }),
        ...(input.lastRowId === undefined ? {} : { lastRowId: input.lastRowId }),
        ...(input.lastStep === undefined ? {} : { lastStep: input.lastStep }),
        ...(input.worklistSeenAt === undefined ? {} : { worklistSeenAt: input.worklistSeenAt }),
      }

      await ctx.prisma.worklistPreference.upsert({
        where: { orgId_userId: { orgId: ctx.orgId, userId } },
        create: { orgId: ctx.orgId, userId, ...data },
        update: data,
      })
      return { success: true }
    }),

  /**
   * Park an uncommitted edit to a letter, or throw it away.
   *
   * The alternative was a debounced autosave writing a DenialDraft every couple
   * of seconds, which destroys the one property the version list is for. This
   * keeps the unsaved text somewhere durable without pretending it is a version:
   * it is offered back as Restore or Discard the next time the claim is opened,
   * and Save is still the only thing that writes history.
   *
   * Goes through the same patient-placeholder guard as `saveDraftBody`. A column
   * that skipped it would be a way to put a name in Postgres by typing it and
   * then never clicking Save — the likeliest version of that mistake, not the
   * least.
   *
   * `body: null` discards. Deliberately not a separate mutation: discard and
   * save race each other on the same four columns, and one write path means the
   * last gesture wins instead of the last round-trip.
   */
  saveScratch: orgProcedure
    .input(
      z
        .object({
          rowId: z.string(),
          body: z.string().max(40_000).nullable(),
          baseVersion: z.number().int().positive(),
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session?.user?.id
      if (!userId) throw new TRPCError({ code: 'UNAUTHORIZED' })

      if (input.body === null) {
        await ctx.prisma.worklistPreference.updateMany({
          where: { orgId: ctx.orgId, userId, scratchRowId: input.rowId },
          data: { scratchRowId: null, scratchBody: null, scratchBaseVersion: null, scratchAt: null },
        })
        return { success: true }
      }

      const base = await ctx.prisma.denialDraft.findFirst({
        where: { rowId: input.rowId, orgId: ctx.orgId, version: input.baseVersion },
        select: { body: true },
      })
      if (!base) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `There is no version ${input.baseVersion} of this letter.`,
        })
      }
      assertNoPatientSlotLost(base.body, input.body)

      const data = {
        scratchRowId: input.rowId,
        scratchBody: input.body,
        scratchBaseVersion: input.baseVersion,
        scratchAt: new Date(),
      }
      await ctx.prisma.worklistPreference.upsert({
        where: { orgId_userId: { orgId: ctx.orgId, userId } },
        create: { orgId: ctx.orgId, userId, ...data },
        update: data,
      })
      // Deliberately does NOT stamp DenialRow.lastTouchedAt. Typing is not
      // working a claim; committing the version is, and saveDraftBody stamps it.
      return { success: true }
    }),

  /**
   * Everything that has happened to this row, newest first.
   *
   * The note and the follow-up date are single columns that each save
   * overwrites, which is right for "what does this row say now" and useless for
   * "what have we already tried". A biller who called the payer twice had one
   * sentence to show for it. This is the other half of that record.
   *
   * Actor names are resolved here rather than shipped as ids: a timeline that
   * reads "by cm3k9x..." is not a timeline. One extra query for the handful of
   * distinct people who touched one row.
   */
  history: orgProcedure
    .input(z.object({ rowId: z.string() }))
    .query(async ({ ctx, input }) => {
      const events = await ctx.prisma.denialEvent.findMany({
        where: { rowId: input.rowId, orgId: ctx.orgId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      })

      const actorIds = [...new Set(events.map(e => e.actorId).filter((id): id is string => !!id))]
      const actors = actorIds.length
        ? await ctx.prisma.user.findMany({
            // orgId in the where, like every other read here: a name is only
            // ours to show if the person is in this workspace.
            where: { id: { in: actorIds }, orgId: ctx.orgId },
            select: { id: true, name: true, email: true },
          })
        : []
      const nameOf = new Map(
        actors.map(a => [a.id, a.name?.trim() || a.email?.split('@')[0] || null]),
      )

      return events.map(e => ({
        id: e.id,
        kind: e.kind,
        detail: e.detail,
        at: e.createdAt,
        actor: e.actorId ? (nameOf.get(e.actorId) ?? null) : null,
      }))
    }),

  /**
   * The same row's history, merged with everything else that happened to it.
   *
   * `history` above is the raw event log, and the panel reads it that way on
   * purpose — the prior notes and the origin of the follow-up date both need the
   * event KIND, which a merged list has already flattened into a label.
   *
   * This is the other question: not "what did I write" but "what has been done
   * to this claim, by anyone, in what order" — the import it arrived on, every
   * event, every draft, every attempt at reaching the payer. It is answered by
   * buildClaimTimeline, the same pure builder /claims uses, so the two pages
   * cannot tell different stories about one claim.
   */
  timeline: orgProcedure
    .input(z.object({ rowId: z.string() }))
    .query(async ({ ctx, input }) => {
      const row = await ctx.prisma.denialRow.findFirst({
        where: { id: input.rowId, orgId: ctx.orgId },
        select: {
          batch: { select: { filename: true, createdAt: true } },
          events: { orderBy: { createdAt: 'desc' }, take: 100 },
          drafts: {
            orderBy: { version: 'asc' },
            select: { version: true, artifact: true, createdAt: true, source: true },
          },
          submissions: {
            orderBy: { sentAt: 'desc' },
            take: 20,
            select: {
              channel: true,
              destination: true,
              sentAt: true,
              confirmationRef: true,
              notes: true,
            },
          },
        },
      })
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' })

      const entries = buildClaimTimeline({
        imported: { filename: row.batch.filename, at: row.batch.createdAt },
        events: row.events,
        drafts: row.drafts,
        submissions: row.submissions,
      })

      // Names, not ids, for the same reason `history` resolves them: a timeline
      // that reads "by cm3k9x..." is not a timeline.
      const actorIds = [...new Set(entries.map(e => e.actorId).filter((id): id is string => !!id))]
      const actors = actorIds.length
        ? await ctx.prisma.user.findMany({
            where: { id: { in: actorIds }, orgId: ctx.orgId },
            select: { id: true, name: true, email: true },
          })
        : []
      const nameOf = new Map(
        actors.map(a => [a.id, a.name?.trim() || a.email?.split('@')[0] || null]),
      )

      return {
        entries: entries.map(e => ({
          at: e.at,
          kind: e.kind,
          label: e.label,
          detail: e.detail,
          actor: e.actorId ? (nameOf.get(e.actorId) ?? null) : null,
        })),
        /**
         * Attempts that actually reached the payer.
         *
         * Submissions, not drafts: a letter written four times and sent once is
         * one follow-up. This is the number a biller wants before phoning.
         */
        followUps: followUpCount(row.submissions),
      }
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
        // Both events, because this mutation genuinely does two things. The
        // follow-up one matters most when the biller chose nothing and got the
        // 30-day default: without it the date appears on the row with no author
        // and no reason, which is indistinguishable from a bug.
        ctx.prisma.denialEvent.createMany({
          data: [
            {
              orgId: ctx.orgId,
              rowId: input.rowId,
              kind: 'STATUS_CHANGED' as const,
              detail: statusLabel('SENT'),
              actorId: ctx.session?.user?.id ?? null,
            },
            {
              orgId: ctx.orgId,
              rowId: input.rowId,
              kind: 'FOLLOW_UP_SET' as const,
              detail: followUpDetail(followUpAt),
              actorId: ctx.session?.user?.id ?? null,
            },
          ],
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
            // The follow-up existed to prompt exactly this, so recording the
            // answer clears it — but only when the answer ends the matter.
            //
            // This used to clear unconditionally, on the reasoning that a denied
            // row re-enters the queue on its filing deadline. That deadline is
            // for the ORIGINAL claim; the clock on a second-level appeal is a
            // different and shorter one this product does not model. So the case
            // the old comment described is precisely the case where the biller's
            // own date was the only thing tracking the row — and it was the case
            // that threw it away. Silence from the payer is the same story.
            ...(isWin(input.outcome) || input.outcome === 'WITHDRAWN'
              ? { followUpAt: null }
              : {}),
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
   *
   * DenialSubmission carries no practiceId of its own — it is one appeal, and
   * the practice is a property of the row it was sent for. So the scope is
   * applied THROUGH the relation rather than denormalised onto a third table.
   * That is a join, which the two big scans deliberately avoid, but this one is
   * bounded at 25 pending submissions rather than 50,000 rows.
   */
  awaitingOutcome: practiceProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(25) }).optional())
    .query(async ({ ctx, input }) => {
      const submissions = await ctx.prisma.denialSubmission.findMany({
        where: {
          orgId: ctx.orgId,
          outcome: 'PENDING',
          ...(ctx.practiceId ? { row: { practiceId: ctx.practiceId } } : {}),
        },
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
   * Follow-ups that have come due, across everything in view.
   *
   * Answers "what did I promise to look at today" without scanning the queue.
   * Scoped, because a biller working one clinic this morning is being asked
   * what THEY promised — a follow-up on a row they cannot see and cannot open
   * is not an answer to that question.
   */
  dueFollowUps: practiceProcedure.query(async ({ ctx }) => {
    const rows = await ctx.prisma.denialRow.findMany({
      where: {
        orgId: ctx.orgId,
        ...ctx.practiceWhere,
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
    .input(
      z.object({
        rowId: z.string(),
        /**
         * What the biller asked for before this letter existed.
         *
         * `revise` could always steer a draft and `draft` could not, so the
         * first letter was always the generic one and the biller's real
         * preference arrived as a complaint about the output. Optional, and a
         * blank one is dropped by the prompt builder.
         */
        instruction: z.string().max(2_000).optional(),
        ...PENDING_WORK,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // The practice signs the letter, so it is loaded alongside the row. Without
      // it the model was left to guess at a signature block and did exactly that
      // — inventing a plausible practice name, which is worse than the
      // [PRACTICE NAME] placeholder because nobody catches it before it is sent.
      const [row, org, workedThisMonth] = await Promise.all([
        saveAndLoadRow(ctx, { ...input, actorId: ctx.session?.user?.id ?? null }),
        ctx.prisma.organization.findUnique({
          where: { id: ctx.orgId },
          select: { plan: true, ...PRACTICE_IDENTITY_SELECT },
        }),
        ctx.prisma.denialWorkedEvent.count({
          where: { orgId: ctx.orgId, createdAt: { gte: startOfMonth(new Date()) } },
        }),
      ])

      // Which clinic signs THIS letter, which is the row's own practice — not
      // whichever one the biller happens to have selected in the switcher. Those
      // differ constantly: combined mode is the default, and a letter drafted
      // there must still carry the right clinic's NPI. Loaded from the row
      // rather than from ctx.practiceId for exactly that reason.
      const rowPractice = row.practiceId
        ? await ctx.prisma.practice.findFirst({
            // orgId in the filter even though the row already carries it: the
            // rule is that every query names the boundary.
            where: { id: row.practiceId, orgId: ctx.orgId },
            select: { name: true, ...PRACTICE_IDENTITY_SELECT },
          })
        : null
      const practice = practiceIdentity(rowPractice, org)

      // The wall, checked here so a refused draft never spends a model call.
      //
      // Only a *new* billable unit is refused. A denial already counted stays
      // draftable, because the alternative is locking a biller out of the letter
      // they already spent the allowance on. DenialWorkedEvent is unique per
      // row, so redrafting one can never consume a second unit anyway.
      const allowance = draftAllowance(org?.plan ?? 'TRIAGE', workedThisMonth)
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
          // Direction about the document, kept separate from the note all the
          // way into the prompt — the note may not be read as an instruction and
          // this may not be read as a fact.
          draftingInstruction: input.instruction ?? null,
        },
        new Date(),
        practice,
      )

      const [latest, noteAt] = await Promise.all([
        ctx.prisma.denialDraft.findFirst({
          where: { rowId: row.id, orgId: ctx.orgId },
          orderBy: { version: 'desc' },
          select: { version: true },
        }),
        noteWrittenAt(ctx, row.id, row.note),
      ])

      const [draft] = await ctx.prisma.$transaction([
        ctx.prisma.denialDraft.create({
          data: {
            orgId: ctx.orgId,
            rowId: row.id,
            artifact: drafted.artifact,
            body: drafted.body,
            summary: JSON.stringify(drafted.summary),
            version: (latest?.version ?? 0) + 1,
            noteAt,
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
   * Turn what the biller just said into the note they would have written.
   *
   * The note is the most valuable field in the product and the one people skip,
   * because writing it happens straight off a forty-minute hold with the next
   * call already queued. This is the mail-client bargain: the human supplies
   * what they know — dictated in the browser, or typed as fragments — and the
   * model supplies the sentence.
   *
   * RETURNS A PROPOSAL AND WRITES NOTHING. A model that saved into the note
   * would be writing the field everything else trusts without anyone having read
   * it, and `DenialRow.lastTouchedAt` would start to mean "a machine did
   * something" — which distorts stalenessFactor and therefore the queue. Save
   * stays `setNote`, and stays the biller's act.
   *
   * Walled exactly like `draft`: a workspace at its limit can still write notes
   * on denials it has already worked, and cannot start a new one. The wall says
   * "everything already here stays open", and this is the only other model call
   * a row can reach.
   */
  writeNote: orgProcedure
    .input(z.object({ rowId: z.string(), rough: z.string().min(1).max(4_000) }).strict())
    .mutation(async ({ ctx, input }) => {
      const [row, org, workedThisMonth] = await Promise.all([
        ctx.prisma.denialRow.findFirst({
          where: { id: input.rowId, orgId: ctx.orgId },
          select: { claimNumber: true, payer: true, carc: true, reason: true },
        }),
        ctx.prisma.organization.findUnique({
          where: { id: ctx.orgId },
          select: { plan: true },
        }),
        ctx.prisma.denialWorkedEvent.count({
          where: { orgId: ctx.orgId, createdAt: { gte: startOfMonth(new Date()) } },
        }),
      ])
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' })

      const allowance = draftAllowance(org?.plan ?? 'TRIAGE', workedThisMonth)
      if (allowance.atLimit) {
        const alreadyWorked = await ctx.prisma.denialWorkedEvent.findFirst({
          where: { rowId: input.rowId, orgId: ctx.orgId },
          select: { id: true },
        })
        if (!alreadyWorked) {
          throw new TRPCError({
            code: 'TOO_MANY_REQUESTS',
            message: upgradeMessage(
              `This workspace has worked all ${allowance.limit} of its denials this month.`,
            ),
          })
        }
      }

      return { note: await writeNoteFromRough(input.rough, row) }
    }),

  /**
   * The biller's own edit to the letter, committed as a version.
   *
   * Appends rather than overwrites, exactly as `revise` does, so a biller's
   * rewrite and a model's revision interleave in one linear history and `source`
   * is what tells them apart. That is also why there is no autosave behind this:
   * a row every two seconds would bury the version somebody actually wants to go
   * back to. Unsaved keystrokes live in `saveScratch` instead.
   *
   * `baseVersion` is the version the text on screen was derived from. It is what
   * the PHI guard diffs against — the stored body, not one the caller supplied —
   * and it is how the answer can say a newer version arrived while this one was
   * being typed. It is not a lock: the table is append-only, so a save landing on
   * top of a revision loses nothing, and refusing the write would strand the
   * biller with edits and nowhere to put them.
   */
  saveDraftBody: orgProcedure
    .input(
      z
        .object({
          rowId: z.string(),
          body: z.string().min(1).max(40_000),
          baseVersion: z.number().int().positive(),
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      const drafts = await ctx.prisma.denialDraft.findMany({
        where: { rowId: input.rowId, orgId: ctx.orgId },
        orderBy: { version: 'asc' },
        select: { id: true, version: true, body: true, artifact: true, summary: true },
      })
      const latest = drafts[drafts.length - 1]
      if (!latest) throw new TRPCError({ code: 'NOT_FOUND', message: 'Draft this denial first.' })

      const base = drafts.find(d => d.version === input.baseVersion)
      if (!base) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `There is no version ${input.baseVersion} of this letter.`,
        })
      }

      assertNoPatientSlotLost(base.body, input.body)

      // Unchanged text is not a version. Clicking Save twice, or blurring a
      // field nobody touched, must not add a v6 identical to v5.
      if (input.body.trim() === latest.body.trim()) {
        return { draft: latest, basedOn: latest.version, supersededBy: null as number | null }
      }

      const [draft] = await ctx.prisma.$transaction([
        ctx.prisma.denialDraft.create({
          data: {
            orgId: ctx.orgId,
            rowId: input.rowId,
            // The instrument does not change because the wording did. A biller
            // editing a corrected claim is still working on a corrected claim.
            artifact: base.artifact,
            summary: base.summary,
            body: input.body,
            version: latest.version + 1,
            source: 'BILLER',
          },
        }),
        // A person rewrote the letter, so the row was genuinely touched — this
        // is the one kind of write that is allowed to move lastTouchedAt, and
        // staleness in the priority score would otherwise keep climbing while
        // somebody was working the claim.
        ctx.prisma.denialRow.updateMany({
          where: { id: input.rowId, orgId: ctx.orgId },
          data: { lastTouchedAt: new Date() },
        }),
      ])

      // The scratch existed to survive an uncommitted edit. This is the commit.
      const userId = ctx.session?.user?.id
      if (userId) {
        await ctx.prisma.worklistPreference.updateMany({
          where: { orgId: ctx.orgId, userId, scratchRowId: input.rowId },
          data: { scratchRowId: null, scratchBody: null, scratchBaseVersion: null, scratchAt: null },
        })
      }

      return {
        draft,
        basedOn: input.baseVersion,
        /** Non-null when a version arrived while this edit was being typed. */
        supersededBy: latest.version === input.baseVersion ? null : latest.version,
      }
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
        saveAndLoadRow(ctx, { ...input, actorId: ctx.session?.user?.id ?? null }),
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
          // Carried on every revision, not just the first. standingContext put
          // the note in this prompt too, so this version was drafted from it as
          // much as version 1 was.
          noteAt: await noteWrittenAt(ctx, input.rowId, row.note),
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

import { z } from 'zod'
import { router, practiceProcedure } from '../trpc'
import { money } from '@/lib/money'
import {
  FACT_ROW_CAP,
  latestClaimsBatch as factsLatestClaimsBatch,
  loadFacts as factsLoadFacts,
  type Facts,
} from '@/lib/insights/facts'
import {
  byArtifact,
  byCode,
  byPayer,
  byPayerAndCode,
  coverage,
  tally,
  type OutcomeRecord,
} from '@/lib/denials/outcomes'
import { artifactFor } from '@/lib/billing/appeal-prompt'
import { getPlaybook } from '@/lib/billing/denial-playbooks'
import { payerKey, resolveDestination } from '@/lib/billing/submission'
import { UNKNOWN_PAYER } from '@/lib/billing/payer-key'
import {
  AGING_BUCKETS,
  agingBucketRange,
  arAging,
  type ClaimFact,
  denialTrend,
  overview,
  payerScorecard,
  recoveryFunnel,
  revenueByMonth,
  topCarcs,
  topCodes,

} from '@/lib/insights/aggregate'

/**
 * The customer's own numbers.
 *
 * Every query here is scoped by ctx.orgId, which orgProcedure resolves and
 * refuses to guess at. A query in this file without `orgId` in its where clause
 * is a data leak between two paying customers, not a missing filter.
 *
 * Nothing derived is stored. Aging buckets, collection rates and denial rates
 * are computed on every read by lib/insights/aggregate.ts, because a bucket
 * written to the database is wrong the next morning.
 *
 * The claims snapshot is read from the MOST RECENT claims batch only, never the
 * union of every upload. A monthly A/R export re-states the same claims, so
 * unioning two of them double-counts everything in both.
 */

const CLAIM_STATUSES = [
  'PAID',
  'PARTIAL',
  'DENIED',
  'PENDING',
  'REJECTED',
  'WRITTEN_OFF',
  'UNKNOWN',
] as const

type Ctx = {
  prisma: import('@prisma/client').PrismaClient
  orgId: string
  once: import('../context').Memo
  /** From practiceProcedure. `{}` in combined mode — see lib/practices/scope.ts. */
  practiceWhere: import('@/lib/practices/scope').PracticeWhere
  practiceId: string | null
}

/**
 * One row of the claims table. Named so the empty branch types identically.
 *
 * Exactly what the table renders, and nothing else. It used to carry allowed,
 * paid, patientResp, remitDate, cpt and icd10 as well — none of which any
 * column showed, on 100 rows a page. A wire type that promises more than the
 * screen uses is read, later, as a column somebody removed by accident.
 * Everything else about a claim is one click away in claims.detail.
 */
type ClaimListItem = {
  id: string
  claimNumber: string | null
  payer: string | null
  status: string
  billed: number
  balance: number
  serviceDate: Date | null
  carc: string | null
  /** The denial row this claim is already being worked on, if any. */
  worklistRowId: string | null
}

/**
 * Both halves of the picture, loaded once per request.
 *
 * The loader itself lives in lib/insights/facts.ts so the chat agent reads the
 * workspace through the identical query. These wrappers exist only to unpack
 * the tRPC context.
 *
 * `loadFacts` is memoized on the request context, which matters more than it
 * looks: the Analytics page fires seven queries, six of them land here, and
 * httpBatchLink delivers all seven as ONE request. Without the memo that is six
 * full loads of the customer's A/R to render one page.
 */
function latestClaimsBatch(ctx: Ctx) {
  return factsLatestClaimsBatch(ctx.prisma, ctx.orgId, ctx.practiceWhere)
}

function loadFacts(ctx: Ctx): Promise<Facts> {
  // The practice is IN THE MEMO KEY, which is not optional tidiness: the memo
  // is per-request and six of the Analytics page's seven queries land here in
  // one batch. A fixed key would let the first of them decide the scope for all
  // the rest — and since the switcher can change between requests, the bug
  // would appear as a page that is correct until you change clinic and then
  // shows the previous one's numbers under the new one's name. See the "anything
  // varying by input must put that input in the key" rule in ../context.ts.
  return ctx.once(`insights:facts:${ctx.practiceId ?? 'all'}`, () =>
    factsLoadFacts(ctx.prisma, ctx.orgId, ctx.practiceWhere),
  )
}

type ClaimWhere = Record<string, unknown>
type PracticeWhere = import('@/lib/practices/scope').PracticeWhere

/**
 * An explicit status and the "unsettled" toggle are both tests on the same
 * column. Spreading them separately let whichever came second silently win, so
 * they are intersected here: picking Denied AND unsettled means denied, because
 * denied is already unsettled; picking Paid AND unsettled means nothing matches,
 * which is the truthful answer rather than a quietly widened result.
 */
function statusFilter(
  status: (typeof CLAIM_STATUSES)[number] | undefined,
  unsettled: boolean | undefined,
): ClaimWhere {
  const SETTLED = ['PAID', 'WRITTEN_OFF']
  if (!unsettled) return status ? { status } : {}
  if (!status) return { status: { notIn: SETTLED } }
  return SETTLED.includes(status) ? { id: '__none__' } : { status }
}

/**
 * Rows whose anchor date falls in a window, reproducing anchorDate()'s coalesce
 * — service date, else submitted, else remit — as an OR. Testing serviceDate
 * alone would drop every row that only has a remit date, which the aging chart
 * still counts.
 */
function anchorBetween(range: { from: Date | null; to: Date | null }): ClaimWhere {
  const within = {
    ...(range.from ? { gte: range.from } : {}),
    ...(range.to ? { lte: range.to } : {}),
  }
  return {
    OR: [
      { serviceDate: within },
      { serviceDate: null, submittedDate: within },
      { serviceDate: null, submittedDate: null, remitDate: within },
    ],
  }
}

/**
 * What the claims table is filtered by, declared once.
 *
 * `claimList` and `claimSummary` answer two questions about the same set of
 * rows — what are they, and what do they add up to — and the strip above the
 * table is worthless if those two sets can drift apart. Sharing the shape and
 * the where clause makes that drift a type error rather than a support ticket.
 *
 * Paging and sort are not here: they change which rows come back, never which
 * rows match, and a total that moved when you sorted the table would be wrong.
 */
const CLAIM_FILTERS = {
  status: z.enum(CLAIM_STATUSES).optional(),
  payer: z.string().optional(),
  search: z.string().optional(),
  carc: z.string().optional(),
  /**
   * One procedure code, matched exactly.
   *
   * CPT used to be reachable only through `search`, which ORs a `contains`
   * across claimNumber, cpt and icd10 — so drilling into 99213 also caught
   * every claim whose number happened to contain it. An aggregate that says
   * "22 claims" has to land on those 22.
   */
  cpt: z.string().optional(),
  from: z.date().optional(),
  to: z.date().optional(),
  /** Aged by the same rule the aging chart uses. */
  aging: z.enum(AGING_BUCKETS).optional(),
  /**
   * Claims the payer has not settled. Expressed as a status test rather
   * than as billed-minus-paid, because column arithmetic is not
   * available in a where clause — so the control is labelled
   * "Unsettled", which is exactly what this does.
   */
  unsettled: z.boolean().optional(),
}

type ClaimFilters = z.infer<z.ZodObject<typeof CLAIM_FILTERS>>

/** The one where clause both claims queries run against. */
function claimWhere(
  orgId: string,
  batchId: string,
  input: ClaimFilters | undefined,
  practiceWhere: PracticeWhere = {},
): ClaimWhere {
  const dateFilter =
    input?.from || input?.to
      ? {
          serviceDate: {
            ...(input.from ? { gte: input.from } : {}),
            ...(input.to ? { lte: input.to } : {}),
          },
        }
      : {}

  return {
    orgId,
    // batchId already implies the practice — one batch is one clinic — but the
    // filter is named anyway so that reading this function tells you both
    // boundaries the query is under, rather than one of them and an inference.
    ...practiceWhere,
    batchId,
    ...statusFilter(input?.status, input?.unsettled),
    ...(input?.payer ? { payer: input.payer } : {}),
    ...(input?.carc ? { carc: input.carc } : {}),
    // Case-insensitive: topCodes upper-cases the codes it groups by, while the
    // stored column keeps whatever spelling the import arrived with.
    ...(input?.cpt ? { cpt: { equals: input.cpt, mode: 'insensitive' as const } } : {}),
    ...dateFilter,
    // Search and aging are both OR-shaped, so they go in an AND array
    // rather than as two `OR` keys — the second spread would otherwise
    // silently replace the first, and searching inside an aging bucket
    // would quietly return the whole bucket.
    AND: [
      ...(input?.search
        ? [
            {
              OR: [
                { claimNumber: { contains: input.search, mode: 'insensitive' as const } },
                { cpt: { contains: input.search, mode: 'insensitive' as const } },
                { icd10: { contains: input.search, mode: 'insensitive' as const } },
              ],
            },
          ]
        : []),
      ...(input?.aging ? [anchorBetween(agingBucketRange(input.aging, new Date()))] : []),
    ],
  }
}

export const insightsRouter = router({
  /**
   * Whether this workspace has anything of its own yet.
   *
   * Drives every empty state and the nav switch that retires the sample
   * practice. Deliberately cheap — it counts, it does not load.
   */
  workspaceState: practiceProcedure.query(async ({ ctx }) => {
    const [denials, claimsBatch, lastImport] = await Promise.all([
      ctx.prisma.denialRow.count({ where: { orgId: ctx.orgId, ...ctx.practiceWhere } }),
      latestClaimsBatch(ctx),
      ctx.prisma.importBatch.findFirst({
        where: { orgId: ctx.orgId, ...ctx.practiceWhere },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
    ])

    return {
      hasDenials: denials > 0,
      hasClaims: claimsBatch !== null,
      hasData: denials > 0 || claimsBatch !== null,
      latestClaimsBatchId: claimsBatch?.id ?? null,
      claimsSnapshotAt: claimsBatch?.createdAt ?? null,
      claimsSnapshotFilename: claimsBatch?.filename ?? null,
      statusDerived: claimsBatch?.statusDerived ?? false,
      lastImportAt: lastImport?.createdAt ?? null,
    }
  }),

  overview: practiceProcedure.query(async ({ ctx }) => {
    const { claims, denials, statusDerived, batch, truncated } = await loadFacts(ctx)
    return {
      ...overview(claims, denials, new Date(), { statusDerived }),
      snapshotAt: batch?.createdAt ?? null,
      snapshotFilename: batch?.filename ?? null,
      // Every total above is a floor when this is true. Surfaced rather than
      // swallowed: a silently partial revenue figure is worse than a labelled
      // one. See FACT_ROW_CAP in lib/insights/facts.ts.
      truncated,
    }
  }),

  aging: practiceProcedure.query(async ({ ctx }) => {
    const { claims } = await loadFacts(ctx)
    return arAging(claims, new Date())
  }),

  revenue: practiceProcedure.query(async ({ ctx }) => {
    const { claims } = await loadFacts(ctx)
    return revenueByMonth(claims)
  }),

  /**
   * Denial rate by month where a snapshot supplies the denominator, and denied
   * counts by month where it does not.
   *
   * The distinction is the point: a rate computed over denials alone is 100%.
   * The UI labels the second case as counts rather than a rate.
   */
  denials: practiceProcedure.query(async ({ ctx }) => {
    const { claims, denials } = await loadFacts(ctx)
    if (claims.length > 0) {
      return { basis: 'snapshot' as const, months: denialTrend(claims) }
    }

    const months = new Map<string, { month: string; denied: number; deniedBilled: number }>()
    for (const denial of denials) {
      if (!denial.denialDate) continue
      const key = `${denial.denialDate.getFullYear()}-${String(denial.denialDate.getMonth() + 1).padStart(2, '0')}`
      const row = months.get(key) ?? { month: key, denied: 0, deniedBilled: 0 }
      row.denied += 1
      row.deniedBilled += denial.billed
      months.set(key, row)
    }
    return {
      basis: 'denials-only' as const,
      months: [...months.values()]
        .map(r => ({ ...r, total: 0, rejected: 0, denialRate: null, deniedBilled: Math.round(r.deniedBilled * 100) / 100 }))
        .sort((a, b) => a.month.localeCompare(b.month)),
    }
  }),

  payers: practiceProcedure.query(async ({ ctx }) => {
    const { claims, denials } = await loadFacts(ctx)
    return payerScorecard(claims, denials, new Date())
  }),

  /**
   * Where a response to this payer actually goes.
   *
   * The scorecard's own numbers all come from `payers` above and need no second
   * query; this is the half of "what do I know about this payer" that is not an
   * aggregate — the appeals channel, the form they insist on, the EDI id — and
   * it is fetched only when someone opens one payer, the same bargain
   * worklist.destination strikes for one row.
   *
   * The instrument follows this payer's most common open reason code rather
   * than a fixed guess, because a corrected claim does not go to the appeals
   * unit. resolveDestination is the same function the send panel calls, so the
   * scorecard cannot name a channel the send step would disagree with.
   */
  payerDetail: practiceProcedure
    .input(z.object({ payer: z.string().min(1).max(200) }))
    .query(async ({ ctx, input }) => {
      const name = input.payer
      const key = payerKey(name)
      // The scorecard files rows that named no payer under one heading. There
      // is no appeals unit for a heading, so there is nothing to look up.
      if (!key || name === UNKNOWN_PAYER) return { destination: null, carc: null }

      const byCarc = await ctx.prisma.denialRow.groupBy({
        by: ['carc'],
        where: {
          orgId: ctx.orgId,
          ...ctx.practiceWhere,
          payer: name,
          status: { notIn: ['PAID', 'DEAD'] },
        },
        _count: { carc: true },
        orderBy: { _count: { carc: 'desc' } },
        take: 1,
      })
      const carc = byCarc[0]?.carc ?? ''

      const saved = await ctx.prisma.payerDestination.findUnique({
        where: { orgId_payerKey: { orgId: ctx.orgId, payerKey: key } },
      })

      return {
        carc: carc || null,
        destination: resolveDestination({
          payerName: name,
          carc,
          artifact: artifactFor(getPlaybook(carc)),
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
        }),
      }
    }),

  codes: practiceProcedure.query(async ({ ctx }) => {
    const { claims, denials } = await loadFacts(ctx)
    return topCodes(claims, denials)
  }),

  carcs: practiceProcedure.query(async ({ ctx }) => {
    const { denials } = await loadFacts(ctx)
    return topCarcs(denials, new Date())
  }),

  recovery: practiceProcedure.query(async ({ ctx }) => {
    const { denials } = await loadFacts(ctx)
    return recoveryFunnel(denials)
  }),

  /** Distinct payer names in the snapshot, for the claims table filter. */
  payerNames: practiceProcedure.query(async ({ ctx }) => {
    const batch = await latestClaimsBatch(ctx)
    if (!batch) return []
    const rows = await ctx.prisma.orgClaim.findMany({
      where: { orgId: ctx.orgId, ...ctx.practiceWhere, batchId: batch.id },
      distinct: ['payer'],
      select: { payer: true },
      orderBy: { payer: 'asc' },
    })
    return rows.map(r => r.payer).filter((p): p is string => Boolean(p && p.trim()))
  }),

  /**
   * The claims table.
   *
   * Filtered and paged in SQL rather than in memory: unlike the worklist, none
   * of these columns are derived, so the database can do the work.
   */
  claimList: practiceProcedure
    .input(
      z
        .object({
          ...CLAIM_FILTERS,
          sort: z.enum(['newest', 'oldest', 'billed']).default('newest'),
          limit: z.number().min(1).max(200).default(50),
          cursor: z.string().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const batch = await latestClaimsBatch(ctx)
      if (!batch) {
        return {
          snapshotAt: null as Date | null,
          nextCursor: undefined as string | undefined,
          items: [] as ClaimListItem[],
        }
      }

      const limit = input?.limit ?? 50

      // Sorting is always tie-broken by id: the cursor pages by id, so a
      // non-unique order would skip or repeat rows across pages.
      const orderBy = {
        newest: [{ serviceDate: 'desc' as const }, { id: 'asc' as const }],
        oldest: [{ serviceDate: 'asc' as const }, { id: 'asc' as const }],
        billed: [{ billed: 'desc' as const }, { id: 'asc' as const }],
      }[input?.sort ?? 'newest']

      const rows = await ctx.prisma.orgClaim.findMany({
        where: claimWhere(ctx.orgId, batch.id, input, ctx.practiceWhere),
        orderBy,
        take: limit + 1,
        cursor: input?.cursor ? { id: input.cursor } : undefined,
        skip: input?.cursor ? 1 : 0,
      })

      const nextCursor = rows.length > limit ? rows.pop()!.id : undefined

      // Which of these denied claims are already on the worklist, so the table
      // can link straight into the drafter instead of offering a dead end.
      const deniedNumbers = rows
        .filter(r => r.status === 'DENIED' && r.claimNumber)
        .map(r => r.claimNumber as string)
      const worklistRows = deniedNumbers.length
        ? await ctx.prisma.denialRow.findMany({
            // Scoped: with two clinics sharing a claim number, an unscoped
            // lookup would link this row into the OTHER clinic's worklist.
            // See practices.claimNumberCollisions.
            where: { orgId: ctx.orgId, ...ctx.practiceWhere, claimNumber: { in: deniedNumbers } },
            select: { id: true, claimNumber: true },
          })
        : []
      const worklistByClaim = new Map(
        worklistRows.filter(r => r.claimNumber).map(r => [r.claimNumber as string, r.id]),
      )

      return {
        snapshotAt: batch.createdAt as Date | null,
        nextCursor,
        items: rows.map((row): ClaimListItem => ({
          id: row.id,
          claimNumber: row.claimNumber,
          payer: row.payer,
          status: row.status,
          billed: money(row.billed),
          // Rounded, not just floored: billed - paid - adjustment leaves float
          // dust (1.4e-14) on a fully settled claim, which renders as "$0.00"
          // instead of "—" and reads as a real balance of zero rather than none.
          balance: Math.max(0, Math.round((money(row.billed) - money(row.paid) - money(row.adjustment)) * 100) / 100),
          serviceDate: row.serviceDate,
          carc: row.carc,
          worklistRowId: row.claimNumber ? (worklistByClaim.get(row.claimNumber) ?? null) : null,
        })),
      }
    }),

  /**
   * What the rows under the current filters add up to.
   *
   * The claims table opens on six empty dropdowns and a hundred rows of equal
   * weight, which asks the reader to already know what is wrong before it will
   * help them. This is the sentence that page was missing: how much is out
   * there, how old it is, and how much of it nobody has settled.
   *
   * Aged with `arAging`, the same function behind the Analytics chart, so the
   * strip and that chart cannot report different money for the same snapshot.
   *
   * Summed over the filtered set rather than the whole snapshot, so narrowing to
   * one payer re-totals to that payer. That costs a scan the paged table does
   * not do, which is why it is capped and says so — see `truncated`.
   */
  claimSummary: practiceProcedure
    .input(z.object(CLAIM_FILTERS).optional())
    .query(async ({ ctx, input }) => {
      const empty = {
        count: 0,
        billed: 0,
        outstanding: 0,
        denied: 0,
        deniedBilled: 0,
        buckets: AGING_BUCKETS.map(bucket => ({
          bucket,
          amount: 0,
          count: 0,
          avgDays: null,
          oldestDays: null,
        })),
        undated: { amount: 0, count: 0 },
        truncated: false,
      }

      const batch = await latestClaimsBatch(ctx)
      if (!batch) return empty

      const rows = await ctx.prisma.orgClaim.findMany({
        where: claimWhere(ctx.orgId, batch.id, input, ctx.practiceWhere),
        // Only what the totals and the buckets need. This reads more rows than
        // the table does, so it must not also read more columns.
        select: {
          status: true,
          billed: true,
          paid: true,
          adjustment: true,
          serviceDate: true,
          submittedDate: true,
          remitDate: true,
        },
        take: FACT_ROW_CAP,
      })
      if (rows.length === 0) return empty

      const claims = rows.map(row => ({
        status: row.status as ClaimFact['status'],
        billed: money(row.billed),
        paid: row.paid === null ? null : money(row.paid),
        adjustment: row.adjustment === null ? null : money(row.adjustment),
        serviceDate: row.serviceDate,
        submittedDate: row.submittedDate,
        remitDate: row.remitDate,
      }))

      const aging = arAging(claims, new Date())
      const denials = claims.filter(c => c.status === 'DENIED')

      return {
        count: claims.length,
        billed: Math.round(claims.reduce((sum, c) => sum + c.billed, 0) * 100) / 100,
        outstanding: Math.round(aging.total * 100) / 100,
        denied: denials.length,
        deniedBilled: Math.round(denials.reduce((sum, c) => sum + c.billed, 0) * 100) / 100,
        buckets: aging.buckets,
        undated: aging.undated,
        // The same caveat the rest of the app shows rather than carries: a
        // total that silently stopped at the cap reads as the whole answer.
        truncated: rows.length === FACT_ROW_CAP,
      }
    }),

  /**
   * Denied claims in the snapshot that are not on the worklist yet.
   *
   * Offered as an explicit action rather than imported automatically: a customer
   * who uploaded both a denials export and an A/R export already has these, and
   * adding them silently would duplicate every work item.
   */
  unworkedDenials: practiceProcedure.query(async ({ ctx }) => {
    const batch = await latestClaimsBatch(ctx)
    if (!batch) return { count: 0, billed: 0 }

    const [denied, existing] = await Promise.all([
      ctx.prisma.orgClaim.findMany({
        where: { orgId: ctx.orgId, ...ctx.practiceWhere, batchId: batch.id, status: 'DENIED' },
        select: { claimNumber: true, billed: true, carc: true },
      }),
      ctx.prisma.denialRow.findMany({
        where: { orgId: ctx.orgId, ...ctx.practiceWhere },
        select: { claimNumber: true },
      }),
    ])

    const known = new Set(existing.map(r => r.claimNumber).filter(Boolean))
    const missing = denied.filter(d => d.carc && (!d.claimNumber || !known.has(d.claimNumber)))

    return {
      count: missing.length,
      billed: Math.round(missing.reduce((sum, d) => sum + money(d.billed), 0) * 100) / 100,
    }
  }),

  /**
   * What actually got paid, by payer, by reason code, by instrument.
   *
   * Every other query in this file measures the practice. This one measures the
   * payers — and it is the only thing in the product that could not be rebuilt
   * from a fresh export tomorrow, because it is assembled from what this
   * workspace sent and what came back, one appeal at a time. There is no file to
   * re-upload it from if it is lost.
   *
   * Reads submissions rather than rows on purpose. A row that ends up paid says
   * the claim was recovered; the submissions say which of the two letters did
   * it, and that is the part worth knowing.
   *
   * The whole aggregate is computed on read by lib/denials/outcomes.ts, the same
   * discipline as every other number here: a stored win rate is a number about
   * the day it was written, and this one moves every time a determination lands.
   */
  appealOutcomes: practiceProcedure.query(async ({ ctx }) => {
    const submissions = await ctx.prisma.denialSubmission.findMany({
      // DenialSubmission carries no practiceId — it is one appeal, and the
      // practice belongs to the row it was sent for. Filtered through the
      // relation, the same way worklist.awaitingOutcome does it.
      where: {
        orgId: ctx.orgId,
        ...(ctx.practiceId ? { row: { practiceId: ctx.practiceId } } : {}),
      },
      // Capped like loadFacts is, and for the same reason — but ordered so the
      // cap drops the oldest attempts rather than an arbitrary slice, and the
      // response says when it bit.
      orderBy: { sentAt: 'desc' },
      take: FACT_ROW_CAP,
      select: {
        channel: true,
        sentAt: true,
        outcome: true,
        outcomeAt: true,
        outcomeCarc: true,
        amountRecovered: true,
        row: { select: { payer: true, carc: true, cpt: true, billed: true } },
      },
    })

    // The instrument is not a column on the submission: artifactFor() derives it
    // from the reason code, the same call the drafting path makes, so correcting
    // a CARC mapping re-labels the history instead of leaving it wrong forever.
    const records: OutcomeRecord[] = submissions.map(s => ({
      payerKey: payerKey(s.row.payer),
      payerLabel: s.row.payer,
      carc: s.row.carc,
      cpt: s.row.cpt,
      artifact: artifactFor(getPlaybook(s.row.carc)),
      channel: s.channel,
      outcome: s.outcome,
      sentAt: s.sentAt,
      outcomeAt: s.outcomeAt,
      billed: money(s.row.billed),
      amountRecovered: s.amountRecovered === null ? null : money(s.amountRecovered),
      outcomeCarc: s.outcomeCarc,
    }))

    return {
      coverage: coverage(records),
      overall: tally(records),
      byPayerAndCode: byPayerAndCode(records).slice(0, 50),
      byPayer: byPayer(records).slice(0, 25),
      byCode: byCode(records).slice(0, 25),
      byArtifact: byArtifact(records),
      truncated: submissions.length === FACT_ROW_CAP,
    }
  }),
})

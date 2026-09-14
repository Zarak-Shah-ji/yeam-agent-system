import { z } from 'zod'
import { router, orgProcedure } from '../trpc'
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
import { payerKey } from '@/lib/billing/submission'
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
}

/** One row of the claims table. Named so the empty branch types identically. */
type ClaimListItem = {
  id: string
  claimNumber: string | null
  payer: string | null
  status: string
  billed: number
  allowed: number | null
  paid: number | null
  patientResp: number | null
  balance: number
  serviceDate: Date | null
  remitDate: Date | null
  cpt: string | null
  icd10: string | null
  carc: string | null
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
  return factsLatestClaimsBatch(ctx.prisma, ctx.orgId)
}

function loadFacts(ctx: Ctx): Promise<Facts> {
  return ctx.once('insights:facts', () => factsLoadFacts(ctx.prisma, ctx.orgId))
}

type ClaimWhere = Record<string, unknown>

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
function claimWhere(orgId: string, batchId: string, input: ClaimFilters | undefined): ClaimWhere {
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
    batchId,
    ...statusFilter(input?.status, input?.unsettled),
    ...(input?.payer ? { payer: input.payer } : {}),
    ...(input?.carc ? { carc: input.carc } : {}),
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
  workspaceState: orgProcedure.query(async ({ ctx }) => {
    const [denials, claimsBatch, lastImport] = await Promise.all([
      ctx.prisma.denialRow.count({ where: { orgId: ctx.orgId } }),
      latestClaimsBatch(ctx),
      ctx.prisma.importBatch.findFirst({
        where: { orgId: ctx.orgId },
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

  overview: orgProcedure.query(async ({ ctx }) => {
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

  aging: orgProcedure.query(async ({ ctx }) => {
    const { claims } = await loadFacts(ctx)
    return arAging(claims, new Date())
  }),

  revenue: orgProcedure.query(async ({ ctx }) => {
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
  denials: orgProcedure.query(async ({ ctx }) => {
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

  payers: orgProcedure.query(async ({ ctx }) => {
    const { claims, denials } = await loadFacts(ctx)
    return payerScorecard(claims, denials, new Date())
  }),

  codes: orgProcedure.query(async ({ ctx }) => {
    const { claims, denials } = await loadFacts(ctx)
    return topCodes(claims, denials)
  }),

  carcs: orgProcedure.query(async ({ ctx }) => {
    const { denials } = await loadFacts(ctx)
    return topCarcs(denials, new Date())
  }),

  recovery: orgProcedure.query(async ({ ctx }) => {
    const { denials } = await loadFacts(ctx)
    return recoveryFunnel(denials)
  }),

  /** Distinct payer names in the snapshot, for the claims table filter. */
  payerNames: orgProcedure.query(async ({ ctx }) => {
    const batch = await latestClaimsBatch(ctx)
    if (!batch) return []
    const rows = await ctx.prisma.orgClaim.findMany({
      where: { orgId: ctx.orgId, batchId: batch.id },
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
  claimList: orgProcedure
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
        where: claimWhere(ctx.orgId, batch.id, input),
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
            where: { orgId: ctx.orgId, claimNumber: { in: deniedNumbers } },
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
          allowed: row.allowed === null ? null : money(row.allowed),
          paid: row.paid === null ? null : money(row.paid),
          patientResp: row.patientResp === null ? null : money(row.patientResp),
          // Rounded, not just floored: billed - paid - adjustment leaves float
          // dust (1.4e-14) on a fully settled claim, which renders as "$0.00"
          // instead of "—" and reads as a real balance of zero rather than none.
          balance: Math.max(0, Math.round((money(row.billed) - money(row.paid) - money(row.adjustment)) * 100) / 100),
          serviceDate: row.serviceDate,
          remitDate: row.remitDate,
          cpt: row.cpt,
          icd10: row.icd10,
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
  claimSummary: orgProcedure
    .input(z.object(CLAIM_FILTERS).optional())
    .query(async ({ ctx, input }) => {
      const empty = {
        count: 0,
        billed: 0,
        outstanding: 0,
        denied: 0,
        deniedBilled: 0,
        buckets: AGING_BUCKETS.map(bucket => ({ bucket, amount: 0, count: 0 })),
        undated: { amount: 0, count: 0 },
        truncated: false,
      }

      const batch = await latestClaimsBatch(ctx)
      if (!batch) return empty

      const rows = await ctx.prisma.orgClaim.findMany({
        where: claimWhere(ctx.orgId, batch.id, input),
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
  unworkedDenials: orgProcedure.query(async ({ ctx }) => {
    const batch = await latestClaimsBatch(ctx)
    if (!batch) return { count: 0, billed: 0 }

    const [denied, existing] = await Promise.all([
      ctx.prisma.orgClaim.findMany({
        where: { orgId: ctx.orgId, batchId: batch.id, status: 'DENIED' },
        select: { claimNumber: true, billed: true, carc: true },
      }),
      ctx.prisma.denialRow.findMany({
        where: { orgId: ctx.orgId },
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
  appealOutcomes: orgProcedure.query(async ({ ctx }) => {
    const submissions = await ctx.prisma.denialSubmission.findMany({
      where: { orgId: ctx.orgId },
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

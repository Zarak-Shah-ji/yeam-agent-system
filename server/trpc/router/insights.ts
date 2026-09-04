import { z } from 'zod'
import { router, orgProcedure } from '../trpc'
import { money } from '@/lib/money'
import {
  latestClaimsBatch as factsLatestClaimsBatch,
  loadFacts as factsLoadFacts,
  type Facts,
} from '@/lib/insights/facts'
import {
  arAging,
  denialTrend,
  overview,
  payerScorecard,
  recoveryFunnel,
  revenueByMonth,
  topCarcs,
  topCodes,
  type ClaimFact,
  type DenialFact,
} from '@/lib/insights/aggregate'
import type { ClaimStatus } from '@/lib/imports/claims-profile'

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
          status: z.enum(CLAIM_STATUSES).optional(),
          payer: z.string().optional(),
          search: z.string().optional(),
          from: z.date().optional(),
          to: z.date().optional(),
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
      const dateFilter =
        input?.from || input?.to
          ? { serviceDate: { ...(input.from ? { gte: input.from } : {}), ...(input.to ? { lte: input.to } : {}) } }
          : {}

      const rows = await ctx.prisma.orgClaim.findMany({
        where: {
          orgId: ctx.orgId,
          batchId: batch.id,
          ...(input?.status ? { status: input.status } : {}),
          ...(input?.payer ? { payer: input.payer } : {}),
          ...(input?.search
            ? {
                OR: [
                  { claimNumber: { contains: input.search, mode: 'insensitive' as const } },
                  { cpt: { contains: input.search, mode: 'insensitive' as const } },
                  { icd10: { contains: input.search, mode: 'insensitive' as const } },
                ],
              }
            : {}),
          ...dateFilter,
        },
        orderBy: [{ serviceDate: 'desc' }, { id: 'asc' }],
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
})

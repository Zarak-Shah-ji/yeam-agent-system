import type { PrismaClient } from '@prisma/client'
import type { PracticeWhere } from '@/lib/practices/scope'
import { money } from '@/lib/money'
import type { ClaimFact, DenialFact } from '@/lib/insights/aggregate'
import type { ClaimStatus } from '@/lib/imports/claims-profile'

/**
 * The two collections every workspace number is computed from, loaded once.
 *
 * This used to live inside server/trpc/router/insights.ts. It moved here because
 * the chat agent needs exactly the same facts, and the alternative was a second
 * loader that would drift from this one — most likely by forgetting the orgId
 * filter, which is the whole ballgame.
 *
 * TWO SOURCES, TWO QUESTIONS, NEVER SUMMED. The claims snapshot is the
 * denominator; the denial worklist is the work. See lib/insights/aggregate.ts.
 *
 * The claims side reads the MOST RECENT claims batch only. A monthly A/R export
 * re-states the same claims, so unioning two of them double-counts everything
 * in both.
 */

/**
 * How many rows either side will load before it gives up and says so.
 *
 * These queries used to be unbounded. A workspace with a year of A/R would pull
 * every row into the lambda on every request, and the failure mode at the top of
 * that curve is a timeout with no explanation. A ceiling turns it into a number
 * that is visibly partial, which a customer can act on. `truncated` is plumbed
 * through to the UI for exactly that reason — an under-report has to be loud.
 */
export const FACT_ROW_CAP = 50_000

/** Only the columns the aggregates read. An A/R snapshot is wide. */
const CLAIM_FIELDS = {
  claimNumber: true,
  payer: true,
  status: true,
  billed: true,
  allowed: true,
  paid: true,
  patientResp: true,
  adjustment: true,
  serviceDate: true,
  submittedDate: true,
  remitDate: true,
  cpt: true,
  icd10: true,
  carc: true,
} as const

const DENIAL_FIELDS = {
  claimNumber: true,
  payer: true,
  carc: true,
  billed: true,
  denialDate: true,
  cpt: true,
  icd10: true,
  reason: true,
  status: true,
} as const

type ClaimRecordFromDb = Record<keyof typeof CLAIM_FIELDS, unknown> & {
  claimNumber: string | null
  payer: string | null
  status: string
  serviceDate: Date | null
  submittedDate: Date | null
  remitDate: Date | null
  cpt: string | null
  icd10: string | null
  carc: string | null
}

type DenialRecordFromDb = {
  claimNumber: string | null
  payer: string | null
  carc: string
  billed: unknown
  denialDate: Date | null
  cpt: string | null
  icd10: string | null
  reason: string | null
  status: string
}

export function toClaimFact(row: ClaimRecordFromDb): ClaimFact {
  return {
    claimNumber: row.claimNumber,
    payer: row.payer,
    status: row.status as ClaimStatus,
    billed: money(row.billed),
    allowed: row.allowed === null ? null : money(row.allowed),
    paid: row.paid === null ? null : money(row.paid),
    patientResp: row.patientResp === null ? null : money(row.patientResp),
    adjustment: row.adjustment === null ? null : money(row.adjustment),
    serviceDate: row.serviceDate,
    submittedDate: row.submittedDate,
    remitDate: row.remitDate,
    cpt: row.cpt,
    icd10: row.icd10,
    carc: row.carc,
  }
}

export function toDenialFact(row: DenialRecordFromDb): DenialFact {
  return {
    claimNumber: row.claimNumber ?? undefined,
    payer: row.payer ?? undefined,
    carc: row.carc,
    billed: money(row.billed),
    denialDate: row.denialDate,
    cpt: row.cpt ?? undefined,
    icd10: row.icd10 ?? undefined,
    reason: row.reason ?? undefined,
    status: row.status,
  }
}

export type ClaimsBatch = {
  id: string
  createdAt: Date
  filename: string
  statusDerived: boolean
}

export type Facts = {
  batch: ClaimsBatch | null
  claims: ClaimFact[]
  denials: DenialFact[]
  statusDerived: boolean
  /** True when either side hit FACT_ROW_CAP, so every total below is a floor. */
  truncated: boolean
}

/** The most recent claims snapshot, if the workspace has one. */
export function latestClaimsBatch(
  prisma: PrismaClient,
  orgId: string,
  practiceWhere: PracticeWhere = {},
): Promise<ClaimsBatch | null> {
  return prisma.importBatch.findFirst({
    where: { orgId, ...practiceWhere, kind: 'CLAIMS' },
    orderBy: { createdAt: 'desc' },
    select: { id: true, createdAt: true, filename: true, statusDerived: true },
  })
}

/**
 * Everything the analytics and the chat agent read, for one workspace.
 *
 * `practiceWhere` narrows all three reads to one clinic. It is a spreadable
 * fragment rather than a practiceId so that combined mode costs literally no
 * predicate — see lib/practices/scope.ts. It never carries an orgId and must
 * never be the only filter here.
 *
 * Note the batch lookup takes it too. The claims snapshot is per-clinic: a
 * biller isolated to Riverside who sees Oakwood's newest A/R export gets
 * Riverside's denials measured against Oakwood's payment turnarounds, which is
 * wrong in a way no total on the page would reveal.
 */
export async function loadFacts(
  prisma: PrismaClient,
  orgId: string,
  practiceWhere: PracticeWhere = {},
): Promise<Facts> {
  const batch = await latestClaimsBatch(prisma, orgId, practiceWhere)

  const [claimRows, denialRows] = await Promise.all([
    batch
      ? prisma.orgClaim.findMany({
          // batchId already implies the practice; the filter is kept anyway so
          // that every read in this function names the same two boundaries.
          where: { orgId, ...practiceWhere, batchId: batch.id },
          select: CLAIM_FIELDS,
          take: FACT_ROW_CAP,
        })
      : Promise.resolve([]),
    prisma.denialRow.findMany({
      where: { orgId, ...practiceWhere },
      select: DENIAL_FIELDS,
      take: FACT_ROW_CAP,
    }),
  ])

  return {
    batch,
    claims: claimRows.map(toClaimFact),
    denials: denialRows.map(toDenialFact),
    statusDerived: batch?.statusDerived ?? false,
    truncated: claimRows.length >= FACT_ROW_CAP || denialRows.length >= FACT_ROW_CAP,
  }
}

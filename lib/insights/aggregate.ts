/**
 * What the numbers say, computed on read.
 *
 * Pure functions with an injected `today`, following lib/denials/triage.ts: a
 * bucket or a rate written to the database is wrong the next morning, and a test
 * that reads the clock rots the moment it is written.
 *
 * TWO SOURCES, TWO QUESTIONS, NEVER SUMMED.
 *   - The claims snapshot is the DENOMINATOR. It answers "of everything billed,
 *     how much came back". A claims batch is a point in time; the caller passes
 *     the most recent one, because unioning January's export with February's
 *     double-counts every claim in both.
 *   - The denial worklist is the WORK. It answers "what is still recoverable and
 *     when does it expire". Denial rows accumulate across uploads by design.
 * A customer who uploads both files has the same denial represented in each.
 * Adding them together inflates every total, so nothing here does.
 */

import {
  EXPIRING_SOON_DAYS,
  filingWindow,
  lookupCarc,
  normalizeCarc,
  triage,
  triageRow,
  type ClaimRow,
} from '@/lib/denials/triage'
import { PROCEDURES } from '@/lib/billing/procedure-codes'
import type { ClaimStatus } from '@/lib/imports/claims-profile'

/* ----------------------------------------------------------------- facts --- */

/** A claim line as it left the database, decimals already converted. */
export type ClaimFact = {
  claimNumber?: string | null
  payer?: string | null
  status: ClaimStatus
  billed: number
  allowed?: number | null
  paid?: number | null
  patientResp?: number | null
  adjustment?: number | null
  serviceDate: Date | null
  submittedDate: Date | null
  remitDate: Date | null
  cpt?: string | null
  icd10?: string | null
  carc?: string | null
}

export type DenialFact = ClaimRow & { status: string }

const UNKNOWN_PAYER = 'Unknown payer'

/**
 * One canonical spelling per reason code, for grouping.
 *
 * "CO-97", "CO97" and "co 97" are the same denial. Grouping on the raw string
 * splits them into three rows, each looking a third as expensive as the problem
 * actually is — which is exactly the row a biller would deprioritise.
 */
export function canonicalCarc(raw: string): string {
  const { group, code } = normalizeCarc(raw ?? '')
  if (!code) return 'UNKNOWN'
  return group ? `${group}-${code}` : code
}

export function payerOf(value: string | null | undefined): string {
  const name = (value ?? '').trim()
  return name || UNKNOWN_PAYER
}

/** The date a claim's clock starts: when the service happened, else when it was filed. */
export function anchorDate(claim: ClaimFact): Date | null {
  return claim.serviceDate ?? claim.submittedDate ?? claim.remitDate
}

/**
 * What the payer still owes on this claim.
 *
 * Settled claims contribute nothing: a paid claim is not receivable, and a
 * written-off one has been given up on. Everything else is billed less whatever
 * came in and whatever was contractually adjusted away, floored at zero so an
 * overpayment cannot show up as negative A/R and quietly cancel out a real
 * balance somewhere else.
 */
export function outstanding(claim: ClaimFact): number {
  if (claim.status === 'PAID' || claim.status === 'WRITTEN_OFF') return 0
  // Rounded before the comparison: the subtraction leaves float dust on a fully
  // settled claim (1.4e-14), which is not zero and would age as a real balance.
  const balance = Math.round((claim.billed - (claim.paid ?? 0) - (claim.adjustment ?? 0)) * 100) / 100
  return balance > 0 ? balance : 0
}

const MS_PER_DAY = 86_400_000

function daysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate())
  return Math.round((b - a) / MS_PER_DAY)
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** Percent, or null when there is no denominator. A rate of 0/0 is not zero. */
function rate(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null
  return round2((numerator / denominator) * 100)
}

/* ----------------------------------------------------------------- aging --- */

export const AGING_BUCKETS = ['0-30', '31-60', '61-90', '91-120', '120+'] as const
export type AgingBucket = (typeof AGING_BUCKETS)[number]

export type AgingRow = { bucket: AgingBucket; amount: number; count: number }

function bucketFor(age: number): AgingBucket {
  if (age <= 30) return '0-30'
  if (age <= 60) return '31-60'
  if (age <= 90) return '61-90'
  if (age <= 120) return '91-120'
  return '120+'
}

/**
 * Outstanding dollars by age.
 *
 * Claims with no usable date are reported separately rather than dropped or
 * dumped into the oldest bucket — an undated balance is a data problem the
 * customer should see, not an aged receivable.
 */
export function arAging(
  claims: ClaimFact[],
  today: Date,
): { buckets: AgingRow[]; total: number; undated: { amount: number; count: number } } {
  const buckets = new Map<AgingBucket, AgingRow>(
    AGING_BUCKETS.map(b => [b, { bucket: b, amount: 0, count: 0 }]),
  )
  const undated = { amount: 0, count: 0 }
  let total = 0

  for (const claim of claims) {
    const amount = outstanding(claim)
    if (amount <= 0) continue
    total += amount

    const anchor = anchorDate(claim)
    if (!anchor) {
      undated.amount += amount
      undated.count += 1
      continue
    }
    const row = buckets.get(bucketFor(daysBetween(anchor, today)))!
    row.amount += amount
    row.count += 1
  }

  for (const row of buckets.values()) row.amount = round2(row.amount)
  undated.amount = round2(undated.amount)

  return { buckets: [...buckets.values()], total: round2(total), undated }
}

/* --------------------------------------------------------------- revenue --- */

export type RevenueMonth = {
  month: string
  billed: number
  allowed: number
  paid: number
  count: number
}

/** Billed against what actually came in, by month. Measured, not multiplied. */
export function revenueByMonth(claims: ClaimFact[]): RevenueMonth[] {
  const months = new Map<string, RevenueMonth>()

  for (const claim of claims) {
    const anchor = anchorDate(claim)
    if (!anchor) continue
    const key = monthKey(anchor)
    const row = months.get(key) ?? { month: key, billed: 0, allowed: 0, paid: 0, count: 0 }
    row.billed += claim.billed
    row.allowed += claim.allowed ?? 0
    row.paid += claim.paid ?? 0
    row.count += 1
    months.set(key, row)
  }

  return [...months.values()]
    .map(r => ({ ...r, billed: round2(r.billed), allowed: round2(r.allowed), paid: round2(r.paid) }))
    .sort((a, b) => a.month.localeCompare(b.month))
}

/* ---------------------------------------------------------- denial trend --- */

export type DenialMonth = {
  month: string
  total: number
  denied: number
  rejected: number
  /** Percent, or null when the month has no claims to divide by. */
  denialRate: number | null
  deniedBilled: number
}

/**
 * Denial rate by month, from the snapshot.
 *
 * A rejection is a clearinghouse or front-end refusal, not a payer denial, so it
 * is counted separately rather than folded in to make the number look worse.
 */
export function denialTrend(claims: ClaimFact[]): DenialMonth[] {
  const months = new Map<string, DenialMonth>()

  for (const claim of claims) {
    const anchor = anchorDate(claim)
    if (!anchor) continue
    const key = monthKey(anchor)
    const row =
      months.get(key) ??
      { month: key, total: 0, denied: 0, rejected: 0, denialRate: null, deniedBilled: 0 }
    row.total += 1
    if (claim.status === 'DENIED') {
      row.denied += 1
      row.deniedBilled += claim.billed
    }
    if (claim.status === 'REJECTED') row.rejected += 1
    months.set(key, row)
  }

  return [...months.values()]
    .map(r => ({ ...r, deniedBilled: round2(r.deniedBilled), denialRate: rate(r.denied, r.total) }))
    .sort((a, b) => a.month.localeCompare(b.month))
}

/* ------------------------------------------------------------ payer view --- */

export type PayerRow = {
  payer: string
  claims: number
  billed: number
  allowed: number
  paid: number
  outstanding: number
  denied: number
  /** Percent of this payer's claims denied, or null with no claims. */
  denialRate: number | null
  /** paid / billed. What the practice actually keeps of what it asks for. */
  grossCollectionRate: number | null
  /** paid / allowed. What it keeps of what it was ever going to be owed. */
  netCollectionRate: number | null
  /** Median is deliberate — one 300-day outlier should not move this. */
  medianDaysToPay: number | null
  topCarc: { carc: string; label: string; count: number } | null
  filingWindowDays: number
  filingWindowSource: 'payer' | 'default'
  /** From the worklist, not the snapshot: still recoverable, still in window. */
  atStake: number
  openDenials: number
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid]
}

/**
 * How long this claim took the payer to settle, or null if it cannot be known.
 *
 * One definition, used by both the payer scorecard and the worklist's
 * "is this worth calling about" guidance. Two copies of this would drift, and
 * the two screens would then quietly disagree about the same payer.
 *
 * Only settled claims count. A pending claim has not finished taking however
 * long it is going to take, so including it would drag every median down.
 */
export type SettlementFact = Pick<
  ClaimFact,
  'payer' | 'status' | 'serviceDate' | 'submittedDate' | 'remitDate'
>

export function daysToPay(claim: SettlementFact): number | null {
  if (claim.status !== 'PAID' && claim.status !== 'PARTIAL') return null
  const filed = claim.submittedDate ?? claim.serviceDate
  if (!claim.remitDate || !filed) return null
  const days = daysBetween(filed, claim.remitDate)
  return days >= 0 ? days : null
}

/**
 * Median days to pay, per payer, keyed by the same normalised name the scorecard
 * groups on.
 *
 * This is the input to the worklist's call guidance: a resubmission sent four
 * days ago to a payer whose median is 34 days is in process, and calling about
 * it wastes the biller's morning. See callGuidance in lib/denials/score.ts.
 */
export function payerTurnaround(claims: SettlementFact[]): Map<string, number> {
  const byPayer = new Map<string, number[]>()

  for (const claim of claims) {
    const days = daysToPay(claim)
    if (days === null) continue
    const key = payerOf(claim.payer)
    const list = byPayer.get(key)
    if (list) list.push(days)
    else byPayer.set(key, [days])
  }

  const out = new Map<string, number>()
  for (const [payer, values] of byPayer) {
    const m = median(values)
    if (m !== null) out.set(payer, m)
  }
  return out
}

/**
 * One row per payer, joining the snapshot to the worklist.
 *
 * The two halves answer different questions and are kept in different columns:
 * `denialRate` and the collection rates come from the claims snapshot, `atStake`
 * and `openDenials` from the denial worklist. They are never added together.
 */
export function payerScorecard(
  claims: ClaimFact[],
  denials: DenialFact[],
  today: Date,
): PayerRow[] {
  type Acc = {
    payer: string
    claims: number
    billed: number
    allowed: number
    paid: number
    outstanding: number
    denied: number
    daysToPay: number[]
    carcs: Map<string, number>
    atStake: number
    openDenials: number
  }
  const byPayer = new Map<string, Acc>()

  const accFor = (name: string): Acc => {
    let acc = byPayer.get(name)
    if (!acc) {
      acc = {
        payer: name,
        claims: 0,
        billed: 0,
        allowed: 0,
        paid: 0,
        outstanding: 0,
        denied: 0,
        daysToPay: [],
        carcs: new Map(),
        atStake: 0,
        openDenials: 0,
      }
      byPayer.set(name, acc)
    }
    return acc
  }

  for (const claim of claims) {
    const acc = accFor(payerOf(claim.payer))
    acc.claims += 1
    acc.billed += claim.billed
    acc.allowed += claim.allowed ?? 0
    acc.paid += claim.paid ?? 0
    acc.outstanding += outstanding(claim)
    if (claim.status === 'DENIED') acc.denied += 1

    const settled = daysToPay(claim)
    if (settled !== null) acc.daysToPay.push(settled)
  }

  // The worklist half. Rows already settled or abandoned are not open work.
  const open = denials.filter(d => d.status !== 'PAID' && d.status !== 'DEAD')
  for (const denial of open) {
    const acc = accFor(payerOf(denial.payer))
    const triaged = triageRow(denial, today)
    if (triaged.actionable) acc.atStake += denial.billed
    acc.openDenials += 1
    const key = canonicalCarc(triaged.carc)
    if (key !== 'UNKNOWN') acc.carcs.set(key, (acc.carcs.get(key) ?? 0) + 1)
  }

  return [...byPayer.values()]
    .map(acc => {
      const top = [...acc.carcs.entries()].sort((a, b) => b[1] - a[1])[0]
      const window = filingWindow(acc.payer === UNKNOWN_PAYER ? undefined : acc.payer)
      return {
        payer: acc.payer,
        claims: acc.claims,
        billed: round2(acc.billed),
        allowed: round2(acc.allowed),
        paid: round2(acc.paid),
        outstanding: round2(acc.outstanding),
        denied: acc.denied,
        denialRate: rate(acc.denied, acc.claims),
        grossCollectionRate: rate(acc.paid, acc.billed),
        netCollectionRate: rate(acc.paid, acc.allowed),
        medianDaysToPay: median(acc.daysToPay),
        topCarc: top
          ? { carc: top[0], label: lookupCarc(top[0])?.label ?? 'Unrecognised reason code', count: top[1] }
          : null,
        filingWindowDays: window.days,
        filingWindowSource: window.source,
        atStake: round2(acc.atStake),
        openDenials: acc.openDenials,
      }
    })
    .sort((a, b) => b.billed - a.billed || b.atStake - a.atStake)
}

/* ------------------------------------------------------------ carcs/codes --- */

export type CarcRow = {
  carc: string
  label: string
  remedy: string
  remedyLabel: string
  count: number
  billed: number
  atStake: number
}

/** Denial reasons, worst first by money. Routed through the same rules the drafter uses. */
export function topCarcs(denials: DenialFact[], today: Date, limit = 10): CarcRow[] {
  const rows = new Map<string, CarcRow>()

  for (const denial of denials) {
    const triaged = triageRow(denial, today)
    const key = canonicalCarc(denial.carc)
    const row =
      rows.get(key) ??
      {
        carc: key,
        label: triaged.carcLabel,
        remedy: triaged.remedy,
        remedyLabel: triaged.remedyLabel,
        count: 0,
        billed: 0,
        atStake: 0,
      }
    row.count += 1
    row.billed += denial.billed
    if (triaged.actionable) row.atStake += denial.billed
    rows.set(key, row)
  }

  return [...rows.values()]
    .map(r => ({ ...r, billed: round2(r.billed), atStake: round2(r.atStake) }))
    .sort((a, b) => b.billed - a.billed)
    .slice(0, limit)
}

export type CodeRow = {
  code: string
  /** Only where we genuinely have one. Never the code echoed back at itself. */
  description: string | null
  count: number
  billed: number
  deniedCount: number
  deniedBilled: number
}

function codeTable(
  entries: { code: string | null | undefined; billed: number; denied: boolean }[],
  describe: (code: string) => string | null,
  limit: number,
): CodeRow[] {
  const rows = new Map<string, CodeRow>()
  for (const entry of entries) {
    const code = (entry.code ?? '').trim().toUpperCase()
    if (!code) continue
    const row =
      rows.get(code) ??
      { code, description: describe(code), count: 0, billed: 0, deniedCount: 0, deniedBilled: 0 }
    row.count += 1
    row.billed += entry.billed
    if (entry.denied) {
      row.deniedCount += 1
      row.deniedBilled += entry.billed
    }
    rows.set(code, row)
  }
  return [...rows.values()]
    .map(r => ({ ...r, billed: round2(r.billed), deniedBilled: round2(r.deniedBilled) }))
    .sort((a, b) => b.deniedBilled - a.deniedBilled || b.count - a.count)
    .slice(0, limit)
}

/**
 * Which procedures and diagnoses are costing money.
 *
 * Falls back to the denial worklist when there is no claims snapshot, so this
 * says something true from the first upload. CPT descriptions come from the
 * table in lib/billing/procedure-codes.ts; a code we cannot name renders as the
 * bare code rather than echoing itself into the description column.
 */
export function topCodes(
  claims: ClaimFact[],
  denials: DenialFact[],
  limit = 10,
): { cpt: CodeRow[]; icd10: CodeRow[] } {
  const source =
    claims.length > 0
      ? claims.map(c => ({
          cpt: c.cpt,
          icd10: c.icd10,
          billed: c.billed,
          denied: c.status === 'DENIED',
        }))
      : denials.map(d => ({ cpt: d.cpt, icd10: d.icd10, billed: d.billed, denied: true }))

  return {
    cpt: codeTable(
      source.map(s => ({ code: s.cpt, billed: s.billed, denied: s.denied })),
      code => PROCEDURES[code]?.description ?? null,
      limit,
    ),
    icd10: codeTable(
      source.map(s => ({ code: s.icd10, billed: s.billed, denied: s.denied })),
      () => null,
      limit,
    ),
  }
}

/* --------------------------------------------------------------- recovery --- */

export type RecoveryStage = {
  status: string
  label: string
  count: number
  billed: number
}

const STAGE_LABEL: Record<string, string> = {
  TO_WORK: 'To work',
  DRAFTED: 'Drafted',
  SENT: 'Sent',
  PAID: 'Recovered',
  DEAD: 'Given up',
}

/**
 * What the worklist actually turned into. The answer to "what did this get us".
 *
 * `recovered` is the only number here a customer will check against their bank,
 * so it counts nothing but rows marked PAID.
 */
export function recoveryFunnel(denials: DenialFact[]): {
  stages: RecoveryStage[]
  recovered: number
  recoveredCount: number
  worked: number
} {
  const stages = new Map<string, RecoveryStage>(
    Object.entries(STAGE_LABEL).map(([status, label]) => [
      status,
      { status, label, count: 0, billed: 0 },
    ]),
  )

  for (const denial of denials) {
    const stage = stages.get(denial.status)
    if (!stage) continue
    stage.count += 1
    stage.billed += denial.billed
  }

  for (const stage of stages.values()) stage.billed = round2(stage.billed)

  const paid = stages.get('PAID')!
  const worked = [...stages.values()]
    .filter(s => s.status !== 'TO_WORK')
    .reduce((n, s) => n + s.count, 0)

  return {
    stages: [...stages.values()],
    recovered: paid.billed,
    recoveredCount: paid.count,
    worked,
  }
}

/* --------------------------------------------------------------- overview --- */

export type Overview = {
  hasClaims: boolean
  hasDenials: boolean
  /** Snapshot side. Null throughout when no claims export has been uploaded. */
  claims: {
    total: number
    billed: number
    allowed: number
    paid: number
    outstanding: number
    denied: number
    denialRate: number | null
    grossCollectionRate: number | null
    netCollectionRate: number | null
    /** True when status was inferred from amounts rather than read from a column. */
    statusDerived: boolean
  } | null
  /** Worklist side. Independent of the snapshot; never added to it. */
  denials: {
    open: number
    atStake: number
    expiringSoon: number
    expiringSoonBilled: number
    notRecoverable: number
    expired: number
    recovered: number
  } | null
}

export function overview(
  claims: ClaimFact[],
  denials: DenialFact[],
  today: Date,
  options: { statusDerived?: boolean } = {},
): Overview {
  const openDenials = denials.filter(d => d.status !== 'PAID' && d.status !== 'DEAD')
  const worklist = triage(openDenials, today)
  const recovered = denials
    .filter(d => d.status === 'PAID')
    .reduce((sum, d) => sum + d.billed, 0)

  const totals = claims.reduce(
    (acc, c) => {
      acc.billed += c.billed
      acc.allowed += c.allowed ?? 0
      acc.paid += c.paid ?? 0
      acc.outstanding += outstanding(c)
      if (c.status === 'DENIED') acc.denied += 1
      return acc
    },
    { billed: 0, allowed: 0, paid: 0, outstanding: 0, denied: 0 },
  )

  return {
    hasClaims: claims.length > 0,
    hasDenials: denials.length > 0,
    claims:
      claims.length === 0
        ? null
        : {
            total: claims.length,
            billed: round2(totals.billed),
            allowed: round2(totals.allowed),
            paid: round2(totals.paid),
            outstanding: round2(totals.outstanding),
            denied: totals.denied,
            denialRate: rate(totals.denied, claims.length),
            grossCollectionRate: rate(totals.paid, totals.billed),
            netCollectionRate: rate(totals.paid, totals.allowed),
            statusDerived: options.statusDerived ?? false,
          },
    denials:
      denials.length === 0
        ? null
        : {
            open: worklist.total,
            atStake: round2(worklist.atStake),
            expiringSoon: worklist.expiringSoon,
            expiringSoonBilled: round2(worklist.expiringSoonBilled),
            notRecoverable: worklist.notRecoverable,
            expired: worklist.expired,
            recovered: round2(recovered),
          },
  }
}

export { EXPIRING_SOON_DAYS }

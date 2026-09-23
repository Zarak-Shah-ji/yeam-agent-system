/**
 * What this practice's own data says about a claim's codes.
 *
 * The question a biller wants answered — "is the right code on this, and what
 * does this payer actually pay for it?" — is not one a language model can answer
 * from a claim line. The server holds no clinical documentation by design: no
 * chart note, no PHI, nothing but codes, amounts and dates. A model asked to
 * judge coding from that would be guessing, and a confident guess about a CPT is
 * how a practice ends up upcoding.
 *
 * So the answer is computed, not generated, from two things that are actually
 * evidence:
 *
 *   1. The payer already told you. A CARC is the payer stating what it thinks is
 *      wrong — CO-11 IS "the diagnosis does not support this procedure". That is
 *      ground truth about coding, not an inference. It comes from
 *      lib/denials/triage.ts and lib/billing/denial-playbooks.ts.
 *
 *   2. The practice's own history. For this payer and this CPT, which diagnoses
 *      have actually been paid, at what rate, over how many claims. Org-specific,
 *      drawn from rows already in the database, and impossible to hallucinate.
 *
 * Every number here carries its sample size. A 100% paid rate over two claims is
 * not a fact about a payer, and rendering it without the "n=2" is how it becomes
 * one.
 */

import { describeIcd, isKnownProcedure, profileFor } from '@/lib/billing/procedure-codes'
import { MIN_SAMPLE } from '@/lib/stats/min-sample'

/** The columns of an OrgClaim this reasons over. */
export type ClaimCodeFact = {
  payer: string | null
  cpt: string | null
  icd10: string | null
  status: string
  billed: number
  allowed: number | null
  paid: number | null
  carc: string | null
}

/** Re-exported from its own module; see lib/stats/min-sample.ts. */
export { MIN_SAMPLE }

/** Which population a statistic was drawn from, so the UI can say. */
export type StatScope = 'payer+cpt' | 'cpt' | 'payer'

export type CodeHistory = {
  scope: StatScope
  /** Claims behind every number below. */
  n: number
  paid: number
  denied: number
  paidRate: number
  deniedRate: number
  /** Median paid-to-billed ratio among claims that were paid. Null if none were. */
  medianPaidRatio: number | null
  /** The reason this combination is denied for most often. */
  topCarc: { code: string; count: number } | null
  /** True when the sample is too thin to quote a rate from. */
  thin: boolean
}

export type DiagnosisCandidate = {
  icd10: string
  description: string | null
  n: number
  paid: number
  paidRate: number
  /** True when this is the diagnosis already on the claim. */
  current: boolean
  /** Too few claims behind it to rank on its rate. */
  thin: boolean
}

export type CodeSignals = {
  cpt: string | null
  icd10: string | null
  payer: string | null
  cptDescription: string | null
  icdDescription: string | null
  /**
   * 'consistent' only when the CPT is in the reference table AND the claim's
   * ICD-10 is one of its accepted pairings. Never 'inconsistent': the table
   * covers 59 codes, so absence is ignorance, not disagreement.
   */
  coherence: 'consistent' | 'unknown'
  history: CodeHistory | null
  candidates: DiagnosisCandidate[]
  /** Why a rate might be missing, in words the UI can print. */
  limits: string[]
}

const SETTLED_PAID = new Set(['PAID', 'PARTIAL'])
const SETTLED_DENIED = new Set(['DENIED', 'REJECTED'])

function norm(value: string | null): string | null {
  const t = (value ?? '').trim().toUpperCase()
  return t || null
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const m = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
  return Math.round(m * 1000) / 1000
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

function summarize(rows: ClaimCodeFact[], scope: StatScope): CodeHistory {
  const paid = rows.filter(r => SETTLED_PAID.has(r.status))
  const denied = rows.filter(r => SETTLED_DENIED.has(r.status))

  const carcs = new Map<string, number>()
  for (const r of denied) {
    const code = norm(r.carc)
    if (code) carcs.set(code, (carcs.get(code) ?? 0) + 1)
  }
  const top = [...carcs.entries()].sort((a, b) => b[1] - a[1])[0]

  const ratios = paid
    .filter(r => r.paid !== null && r.billed > 0)
    .map(r => (r.paid as number) / r.billed)

  const n = rows.length
  return {
    scope,
    n,
    paid: paid.length,
    denied: denied.length,
    paidRate: n > 0 ? round1((paid.length / n) * 100) : 0,
    deniedRate: n > 0 ? round1((denied.length / n) * 100) : 0,
    medianPaidRatio: median(ratios),
    topCarc: top ? { code: top[0], count: top[1] } : null,
    thin: n < MIN_SAMPLE,
  }
}

/**
 * Widen until the sample is worth quoting, and say which population was used.
 *
 * Payer and code together is the question being asked; the fallbacks answer a
 * broader one. Passing that off as the narrow answer would be the lie — hence
 * `scope` travelling with every number.
 */
function pickHistory(all: ClaimCodeFact[], payer: string | null, cpt: string | null): CodeHistory | null {
  if (!cpt) return null

  const byCpt = all.filter(r => norm(r.cpt) === cpt)
  if (byCpt.length === 0) return null

  if (payer) {
    const both = byCpt.filter(r => norm(r.payer) === payer)
    if (both.length >= MIN_SAMPLE) return summarize(both, 'payer+cpt')
    if (byCpt.length >= MIN_SAMPLE) return summarize(byCpt, 'cpt')
    // Neither is big enough: report the specific one and flag it as thin rather
    // than quietly reporting a broader population as if it were this payer.
    if (both.length > 0) return summarize(both, 'payer+cpt')
  }

  return summarize(byCpt, 'cpt')
}

/**
 * Which diagnoses have actually been paid on this procedure, for this payer.
 *
 * This is the honest version of "which codes does the payer accept": not a
 * purchased policy table, and not a model's recollection — the practice's own
 * settled claims.
 *
 * Well-evidenced candidates rank above thin ones REGARDLESS of rate. Sorting on
 * rate alone puts a 100%-of-one diagnosis above a 67%-of-thirty, and the top of
 * a list headed "diagnoses your practice has been paid for" is read as the
 * recommendation whatever the small print says. Within each group, rate then
 * sample size.
 */
function buildCandidates(
  all: ClaimCodeFact[],
  payer: string | null,
  cpt: string | null,
  current: string | null,
  limit = 5,
): DiagnosisCandidate[] {
  if (!cpt) return []

  const scoped = all.filter(r => {
    if (norm(r.cpt) !== cpt) return false
    if (!norm(r.icd10)) return false
    return payer ? norm(r.payer) === payer : true
  })

  const byIcd = new Map<string, { n: number; paid: number }>()
  for (const r of scoped) {
    const icd = norm(r.icd10) as string
    const entry = byIcd.get(icd) ?? { n: 0, paid: 0 }
    entry.n += 1
    if (SETTLED_PAID.has(r.status)) entry.paid += 1
    byIcd.set(icd, entry)
  }

  return [...byIcd.entries()]
    .map(([icd10, e]) => ({
      icd10,
      description: describeIcd(icd10),
      n: e.n,
      paid: e.paid,
      paidRate: e.n > 0 ? round1((e.paid / e.n) * 100) : 0,
      current: icd10 === current,
      thin: e.n < MIN_SAMPLE,
    }))
    .sort(
      (a, b) =>
        Number(a.thin) - Number(b.thin) || b.paidRate - a.paidRate || b.n - a.n,
    )
    .slice(0, limit)
}

/**
 * Everything computable about one claim's codes.
 *
 * `all` is the practice's own claim population — the newest A/R snapshot, the
 * same rows every rate in Analytics is drawn from. Older snapshots restate the
 * same claims, so unioning them would double-count and distort every rate here.
 */
export function codeSignals(
  claim: { payer: string | null; cpt: string | null; icd10: string | null },
  all: ClaimCodeFact[],
): CodeSignals {
  const cpt = norm(claim.cpt)
  const icd10 = norm(claim.icd10)
  const payer = norm(claim.payer)
  const limits: string[] = []

  // Positive only. profileFor() answers for every string ever passed to it, so
  // the guard is what stops an unknown CPT being judged against hypertension.
  let coherence: CodeSignals['coherence'] = 'unknown'
  if (cpt && icd10 && isKnownProcedure(cpt)) {
    if (profileFor(cpt).diagnoses.includes(icd10)) coherence = 'consistent'
  }
  if (cpt && !isKnownProcedure(cpt)) {
    limits.push(`${cpt} is not in the built-in procedure reference, so no pairing check was made.`)
  }

  const history = pickHistory(all, payer, cpt)
  const candidates = buildCandidates(all, payer, cpt, icd10)

  if (!cpt) limits.push('This claim has no CPT, so there is nothing to compare against.')
  if (history?.thin) {
    limits.push(
      `Only ${history.n} claim${history.n === 1 ? '' : 's'} in your data match, so these rates are indicative, not reliable.`,
    )
  }
  if (cpt && candidates.length === 0) {
    limits.push('No settled claims in your data carry this procedure with a diagnosis.')
  }

  return {
    cpt,
    icd10,
    payer,
    cptDescription: cpt && isKnownProcedure(cpt) ? profileFor(cpt).description : null,
    icdDescription: icd10 ? describeIcd(icd10) : null,
    coherence,
    history,
    candidates,
    limits,
  }
}

/**
 * A fingerprint of what a review was reasoned from.
 *
 * Cached reviews are keyed on this, so a corrected code or a fresh import
 * invalidates the cache instead of showing a customer conclusions drawn from
 * facts that have since changed.
 */
export function signalsHash(signals: CodeSignals): string {
  const parts = [
    signals.cpt ?? '-',
    signals.icd10 ?? '-',
    signals.payer ?? '-',
    signals.coherence,
    signals.history ? `${signals.history.scope}:${signals.history.n}:${signals.history.paidRate}` : '-',
    signals.candidates.map(c => `${c.icd10}:${c.n}:${c.paidRate}`).join(','),
  ]
  let h = 0
  const raw = parts.join('|')
  for (let i = 0; i < raw.length; i++) h = (Math.imul(h, 31) + raw.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

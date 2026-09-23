import type { TimelineItem } from '@/components/shared/Timeline'

/**
 * One claim, spelled out.
 *
 * Written explicitly rather than inferred with inferRouterOutputs, for the same
 * reason components/worklist/types.ts is: the tRPC + Prisma inference chain in
 * this project blows the TypeScript instantiation depth limit once a
 * Decimal-bearing model is deep enough in the union.
 *
 * Dates arrive as Date on some paths and as strings on others, so anything
 * date-shaped is typed for both and normalised at the point of use.
 */
export type ClaimDetail = {
  id: string
  claimNumber: string | null
  payer: string | null
  status: string
  cpt: string | null
  icd10: string | null
  carc: string | null

  billed: number
  allowed: number | null
  paid: number | null
  patientResp: number | null
  adjustment: number | null
  balance: number

  serviceDate: Date | string | null
  submittedDate: Date | string | null
  remitDate: Date | string | null
  ageDays: number | null
  agingBucket: string | null

  snapshot: { filename: string | null; at: Date | string; statusDerived: boolean }

  /** False when the export gave this row no claim number — there is nothing
   *  stable to key work to. */
  workable: boolean

  work: {
    statusOverride: string | null
    note: string | null
    followUpAt: Date | string | null
    correctedCpt: string | null
    correctedIcd10: string | null
    correctedCarc: string | null
    reviewBody: string | null
    reviewedAt: Date | string | null
    lastTouchedAt: Date | string | null
  } | null

  denial: {
    code: string
    label: string | null
    note: string | null
    remedy: string | null
    payerPosition: string | null
    strategy: string | null
    avoid: string | null
    evidence: string[]
    refinement: { cause: string; action: string } | null
    filingWindowDays: number
    filingWindowSource: string
    daysLeft: number | null
  } | null

  worklistRowId: string | null
  draftCount: number
  submissionCount: number

  /**
   * The last thing a person did to this claim. Null when the import is the only
   * thing that has ever happened to it.
   *
   * On the headline rather than only in the timeline: see lastHumanTouch in
   * lib/claims/timeline.ts for why this one entry is worth promoting out of the
   * list the rest of them live in.
   */
  lastTouch: {
    at: Date | string
    label: string
    kind: 'event' | 'draft' | 'submission'
    actor: string | null
  } | null
  timeline: TimelineItem[]
}

/** Which section is open. Mirrors the `?open=` values on /claims. */
export type SectionId = 'denial' | 'codes' | 'work'

import type { CallVerdict } from '@/lib/denials/score'
import type { RefinementView, ScoreFactorView } from './RowDetail'

/**
 * One row of the worklist, spelled out.
 *
 * Written explicitly rather than inferred from the router with
 * inferRouterOutputs, for the same reason AgentActivityFeed declares its own
 * item type: the tRPC + Prisma inference chain in this project blows the
 * TypeScript instantiation depth limit once a Decimal-bearing model is deep
 * enough in the union. An explicit type costs a little duplication and keeps
 * the editor responsive.
 *
 * Dates arrive over the wire as Date via superjson-free serialization in some
 * paths and as strings in others, so anything date-shaped is typed for both and
 * normalised at the point of use.
 */
export type WorklistRow = {
  id: string
  status: string
  userNote: string | null
  draftCount: number
  /** Which clinic. Both null in a workspace that has never created a practice. */
  practiceId: string | null
  practiceName: string | null

  claimNumber?: string
  payer?: string
  carc: string
  billed: number
  cpt?: string
  icd10?: string
  reason?: string

  remedy: string
  remedyLabel: string
  carcLabel: string
  note: string
  daysLeft: number | null
  windowDays: number
  windowSource: 'payer' | 'default'
  expired: boolean
  actionable: boolean

  denialDate: Date | string | null
  lastTouchedAt: Date | string | null
  followUpAt: Date | string | null
  /** The later of lastTouchedAt and reconciledAt — what the digest compares. */
  changedAt: Date | string | null

  refinement: RefinementView | null

  score: number
  band: string
  factors: ScoreFactorView[]

  /*
    The verdict is the union rather than a bare string: it is a four-member type
    alias with no Prisma in it, so importing it costs nothing against the
    instantiation limit this file exists to dodge, and lib/denials/stages.ts
    switches on it. A widened string here would have pushed that cast into the
    component.
  */
  call: { verdict: CallVerdict; label: string; detail: string; expectedBy: Date | string | null }
}

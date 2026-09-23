import { triageRow, type ClaimRow } from './triage'
import { refineDenial } from './rarc'
import { callGuidance, scoreRow } from './score'
import { payerOf } from '@/lib/insights/aggregate'

/**
 * One worklist row, assembled from what is stored plus what is derived.
 *
 * Lifted out of the `rows` procedure so it can be tested without a database.
 * Everything it calls — triageRow, refineDenial, scoreRow, callGuidance — is
 * already pure; the only thing that was keeping this in the router was habit.
 *
 * The reason it is worth a module of its own is WORKLIST_ROW_KEYS below.
 * components/worklist/types.ts declares the client's view of this shape BY HAND
 * (the tRPC + Prisma inference chain blows TypeScript's instantiation depth once
 * a Decimal-bearing model is deep enough in the union — see the comment there),
 * and WorklistView casts through `as unknown as WorklistRow[]`. Between the two,
 * the compiler cannot see a field added here and forgotten there: it shows up as
 * `undefined` at runtime, in a table cell, in production. The key list plus
 * __tests__/worklist-row-shape.test.ts is the substitute for the type checking
 * this path cannot have.
 */

/** What the builder needs from the database. A narrower select will not do. */
export type PersistedDenialRow = {
  id: string
  status: string
  note: string | null
  claimNumber: string | null
  payer: string | null
  carc: string
  billed: number
  denialDate: Date | null
  cpt: string | null
  icd10: string | null
  reason: string | null
  lastTouchedAt: Date | null
  /** When the import reconciler last changed this row. Machine clock, not human. */
  reconciledAt: Date | null
  followUpAt: Date | null
  /** Which clinic this row was imported for. Null in a workspace with none. */
  practiceId: string | null
}

export type BuildContext = {
  today: Date
  /** Days this payer usually takes to pay, from the A/R snapshot. Null when unknown. */
  payerMedianDaysToPay: number | null
  /** Drafts already written for this row. Counted once per page, not per row. */
  draftCount: number
  /**
   * Practice id to display name, for the whole workspace.
   *
   * A map rather than a name per row, because the caller loads it once — a
   * handful of practices against up to 50,000 rows — and because a row whose
   * practice was archived still has to render something. A miss yields null,
   * which the table shows as an em dash rather than as a broken cell.
   */
  practiceNames?: Map<string, string>
}

/** The later of two dates, either of which may be missing. */
function laterOf(a: Date | null, b: Date | null): Date | null {
  if (!a) return b
  if (!b) return a
  return a.getTime() >= b.getTime() ? a : b
}

function toClaimRow(row: PersistedDenialRow): ClaimRow {
  return {
    claimNumber: row.claimNumber ?? undefined,
    payer: row.payer ?? undefined,
    carc: row.carc,
    billed: row.billed,
    denialDate: row.denialDate,
    cpt: row.cpt ?? undefined,
    icd10: row.icd10 ?? undefined,
    reason: row.reason ?? undefined,
  }
}

export function buildWorklistRow(row: PersistedDenialRow, ctx: BuildContext) {
  // triageRow() also returns `note` — the remedy guidance for this CARC. The
  // biller's own note is carried as `userNote` rather than shadowing it.
  const base = triageRow(toClaimRow(row), ctx.today)

  return {
    id: row.id,
    status: row.status,
    userNote: row.note,
    draftCount: ctx.draftCount,
    // Which clinic, for the column and the filter. Both the id and the label:
    // the id is what the filter sends back and what survives a rename, the
    // label is the only half a person can read.
    practiceId: row.practiceId,
    practiceName: row.practiceId
      ? (ctx.practiceNames?.get(row.practiceId) ?? null)
      : null,
    ...base,
    denialDate: row.denialDate,
    lastTouchedAt: row.lastTouchedAt,
    followUpAt: row.followUpAt,
    /*
      When anything last happened to this row, from either clock.

      Both are needed and they are not interchangeable. lastTouchedAt is a human
      doing something — a note, a status, an outcome — and every mutation in the
      worklist router stamps it, which is why the digest needs no per-event
      query to find "what changed". reconciledAt is the import reconciler closing
      a row out against a remittance, and it is deliberately a separate column
      so a machine write cannot tell the priority score that a person handled the
      row (see the comment on DenialRow in schema.prisma).

      For "has this changed since I last looked" they are the same question, so
      the later of the two is the answer. Derived here rather than stored,
      because a third column would be a denormalisation of two that already
      exist and would go wrong the first time one of them was written directly.
    */
    changedAt: laterOf(row.lastTouchedAt, row.reconciledAt),
    // What the remittance actually said, where a vague CARC leaves the next step
    // undetermined. Null is a real answer: nothing honest to add.
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
      ctx.today,
    ),
    call: callGuidance(
      {
        status: row.status,
        lastTouchedAt: row.lastTouchedAt,
        payerMedianDaysToPay: ctx.payerMedianDaysToPay,
      },
      ctx.today,
    ),
  }
}

export type BuiltWorklistRow = ReturnType<typeof buildWorklistRow>

/**
 * Every key buildWorklistRow emits, spelled out.
 *
 * Kept in sync with components/worklist/types.ts by a test rather than by the
 * compiler. Adding a field to the builder means adding it here and there, and
 * the test fails loudly if you do one and not the other.
 */
export const WORKLIST_ROW_KEYS = [
  // Identity and human-owned state
  'id',
  'status',
  'userNote',
  'draftCount',
  'practiceId',
  'practiceName',
  // From triageRow (spread of ClaimRow + its derivations)
  'claimNumber',
  'payer',
  'carc',
  'billed',
  'cpt',
  'icd10',
  'reason',
  'remedy',
  'remedyLabel',
  'carcLabel',
  'note',
  'daysLeft',
  'windowDays',
  'windowSource',
  'expired',
  'actionable',
  // Dates
  'denialDate',
  'lastTouchedAt',
  'followUpAt',
  'changedAt',
  // Derived on read
  'refinement',
  'score',
  'band',
  'factors',
  'call',
] as const

/** Resolves a payer's median turnaround the same way the router does. */
export function medianFor(
  medians: Map<string, number>,
  payer: string | null,
): number | null {
  return medians.get(payerOf(payer)) ?? null
}

/**
 * The order the queue is worked in.
 *
 * Score first, then the deadline, then the money — so two rows that rank alike
 * still come out in a defensible order rather than whatever the database
 * happened to return.
 *
 * `id` is the final comparator and is not decoration. Without it the sort has no
 * total order: two rows identical on all four leading keys can swap places
 * between two requests over the same data, and a cursor that pages through this
 * ordering would then skip one and repeat the other. Anything that pages MUST
 * keep this last.
 */
export function compareWorklistRows(
  a: Pick<BuiltWorklistRow, 'score' | 'daysLeft' | 'billed' | 'id'>,
  b: Pick<BuiltWorklistRow, 'score' | 'daysLeft' | 'billed' | 'id'>,
): number {
  if (a.score !== b.score) return b.score - a.score
  if (a.daysLeft === null && b.daysLeft !== null) return 1
  if (b.daysLeft === null && a.daysLeft !== null) return -1
  if (a.daysLeft !== null && b.daysLeft !== null && a.daysLeft !== b.daysLeft) {
    return a.daysLeft - b.daysLeft
  }
  if (a.billed !== b.billed) return b.billed - a.billed
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { canReviewCodes, upgradeMessage } from '@/lib/plans'
import { router, orgProcedure, practiceProcedure } from '../trpc'
import { latestClaimsBatch } from '@/lib/insights/facts'
import { anchorDate, bucketFor, daysBetween, outstanding } from '@/lib/insights/aggregate'
import { daysLeft, filingWindow, lookupCarc, REMEDY_LABEL } from '@/lib/denials/triage'
import { refineDenial } from '@/lib/denials/rarc'
import { getPlaybook } from '@/lib/billing/denial-playbooks'
import { buildClaimTimeline, lastHumanTouch } from '@/lib/claims/timeline'
import { codeSignals, signalsHash, type ClaimCodeFact } from '@/lib/claims/code-signals'
import { reviewClaim, ReviewOffMapError, ReviewUnavailableError } from '@/lib/claims/review-claim'
import { GEMINI_AVAILABLE } from '@/lib/ai/gemini-client'
import { TYPESAFE_AVAILABLE } from '@/lib/ai/typesafe-client'
import {
  PREDICTED_REMEDY_LABEL,
  buildPredictionState,
  predictClaim,
  predictionHash,
  type Verdict,
} from '@/lib/claims/predict'
import { FACT_ROW_CAP } from '@/lib/insights/facts'
import { money } from '@/lib/money'

/**
 * One claim, and the work done on it.
 *
 * Split from insights.ts because that router documents itself as read-only and
 * every procedure in it is a query. These are mutations, and they write to a
 * different place than the claim they are about.
 *
 * The split that matters: OrgClaim is a SNAPSHOT. Only the newest CLAIMS batch
 * is read, and next month's A/R export supersedes this one — so a status change
 * or a corrected code written onto an OrgClaim row would be discarded on the
 * customer's normal monthly cadence. Human state lives in ClaimWork, keyed on
 * the claim number, which survives every re-import.
 *
 * Every query is scoped by ctx.orgId. Every write goes through upsert or
 * updateMany with orgId in the where clause, so a claim number belonging to
 * another workspace writes nothing rather than being written.
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

/** Mirrors the ClaimEventKind enum; used to type what recordWork will accept. */
type EventKind =
  | 'STATUS_CHANGED'
  | 'NOTE_ADDED'
  | 'FOLLOW_UP_SET'
  | 'CODE_CORRECTED'
  | 'REVIEWED'
  | 'SENT_TO_WORKLIST'

/**
 * Find or create the sidecar, record what happened, stamp the touch.
 *
 * One helper because every mutation here does the same three things, and an
 * event written without the touch — or a touch without the event — is a history
 * with a hole in it.
 *
 * lastTouchedAt is stamped explicitly rather than with @updatedAt, matching
 * DenialRow: it means "a human worked this", so a background write must not move
 * it.
 */
async function recordWork(
  ctx: { prisma: import('@prisma/client').PrismaClient; orgId: string; session: { user?: { id?: string } | null } },
  claimNumber: string,
  data: Record<string, unknown>,
  event: { kind: EventKind; detail?: string | null },
) {
  const actorId = ctx.session.user?.id ?? null
  const now = new Date()

  return ctx.prisma.$transaction(async tx => {
    const work = await tx.claimWork.upsert({
      where: { orgId_claimNumber: { orgId: ctx.orgId, claimNumber } },
      create: { orgId: ctx.orgId, claimNumber, ...data, lastTouchedAt: now },
      update: { ...data, lastTouchedAt: now },
    })

    await tx.claimEvent.create({
      data: {
        orgId: ctx.orgId,
        workId: work.id,
        kind: event.kind,
        detail: event.detail ?? null,
        actorId,
      },
    })

    return work
  })
}

/** The claim must be in the current snapshot, or there is nothing to work on. */
async function requireClaim(
  ctx: { prisma: import('@prisma/client').PrismaClient; orgId: string; once: import('../context').Memo },
  claimNumber: string,
) {
  const claim = await ctx.prisma.orgClaim.findFirst({
    where: { orgId: ctx.orgId, claimNumber },
    select: { claimNumber: true, status: true, cpt: true, icd10: true, carc: true },
  })
  if (!claim) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'That claim is not in the current snapshot.' })
  }
  return claim
}


/**
 * The claim, and the population its codes are judged against.
 *
 * The population is the newest CLAIMS batch only — the same rows every rate in
 * Analytics is drawn from. Older snapshots restate the same claims, so unioning
 * them would count a claim twice and distort every rate here. Capped the same
 * way the insights loader is capped.
 */
async function loadCodeContext(
  ctx: { prisma: import('@prisma/client').PrismaClient; orgId: string },
  claimNumber: string,
) {
  const claim = await ctx.prisma.orgClaim.findFirst({
    where: { orgId: ctx.orgId, claimNumber },
    orderBy: { createdAt: 'desc' },
  })
  if (!claim) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'That claim is not in the current snapshot.' })
  }

  /*
    The population is taken from THIS CLAIM's practice, not from the switcher.

    These rates are the evidence the code review is built on — "this CPT is paid
    88% of the time for this payer". Judged against another clinic's book they
    are a number about someone else's billing, presented as a fact about this
    claim. The switcher is where the biller is looking; the claim's own practice
    is what the comparison has to be against, and in combined mode those differ
    for every row.

    Null practiceId — a workspace with no practices, or a row imported before
    they existed — means no narrowing, which is the behaviour this always had.
  */
  const practiceWhere = claim.practiceId ? { practiceId: claim.practiceId } : {}

  const [work, batch] = await Promise.all([
    ctx.prisma.claimWork.findUnique({
      where: { orgId_claimNumber: { orgId: ctx.orgId, claimNumber } },
    }),
    ctx.prisma.importBatch.findFirst({
      where: { orgId: ctx.orgId, ...practiceWhere, kind: 'CLAIMS' },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    }),
  ])

  const population = batch
    ? await ctx.prisma.orgClaim.findMany({
        where: { orgId: ctx.orgId, ...practiceWhere, batchId: batch.id },
        select: {
          payer: true,
          cpt: true,
          icd10: true,
          status: true,
          billed: true,
          allowed: true,
          paid: true,
          carc: true,
        },
        take: FACT_ROW_CAP,
      })
    : []

  const facts: ClaimCodeFact[] = population.map(r => ({
    payer: r.payer,
    cpt: r.cpt,
    icd10: r.icd10,
    status: r.status,
    billed: money(r.billed),
    allowed: r.allowed === null ? null : money(r.allowed),
    paid: r.paid === null ? null : money(r.paid),
    carc: r.carc,
  }))

  // A correction is what the biller says the claim should carry, so it is what
  // gets reviewed — reviewing the superseded code would answer a stale question.
  const signals = codeSignals(
    {
      payer: claim.payer,
      cpt: work?.correctedCpt ?? claim.cpt,
      icd10: work?.correctedIcd10 ?? claim.icd10,
    },
    facts,
  )

  return { claim, work, signals }
}

/**
 * The facts a verdict depends on beyond the code signals.
 *
 * signalsHash fingerprints the codes, the payer and the history — everything
 * the written review reasons from. The verdict also weighs the balance and how
 * long is left to file, so those have to be in its key too, or a claim whose
 * filing window has lapsed would go on serving "work this first" forever.
 */
function predictionFacts(
  claim: {
    status: import('@prisma/client').OrgClaimStatus
    payer: string | null
    carc: string | null
    billed: import('@prisma/client').Prisma.Decimal
    paid: import('@prisma/client').Prisma.Decimal | null
    adjustment: import('@prisma/client').Prisma.Decimal | null
    allowed: import('@prisma/client').Prisma.Decimal | null
    serviceDate: Date | null
    submittedDate: Date | null
    remitDate: Date | null
  },
  work: {
    statusOverride: import('@prisma/client').OrgClaimStatus | null
    correctedCarc: string | null
  } | null,
) {
  const today = new Date()
  const status = work?.statusOverride ?? claim.status
  const carcCode = work?.correctedCarc ?? claim.carc
  const carc = carcCode ? lookupCarc(carcCode) : null
  const playbook = carcCode ? getPlaybook(carcCode) : null

  const facts = {
    billed: money(claim.billed),
    allowed: claim.allowed === null ? null : money(claim.allowed),
    paid: claim.paid === null ? null : money(claim.paid),
    adjustment: claim.adjustment === null ? null : money(claim.adjustment),
    status,
    serviceDate: claim.serviceDate,
    submittedDate: claim.submittedDate,
    remitDate: claim.remitDate,
  }

  const anchor = anchorDate(facts)
  const denialAnchor = claim.remitDate ?? claim.serviceDate
  const window = filingWindow(claim.payer ?? undefined)
  const left =
    carcCode && denialAnchor ? daysLeft(denialAnchor, claim.payer ?? undefined, today) : null

  return {
    status,
    carc: carcCode,
    balance: outstanding(facts),
    ageDays: anchor ? daysBetween(anchor, today) : null,
    /** Hoisted out of `filing` because predictionHash keys on it directly. */
    daysLeft: left,
    filing: { daysLeft: left, windowDays: window.days, windowSource: window.source },
    denial: carcCode
      ? {
          code: carcCode,
          label: carc?.label ?? null,
          note: carc?.note ?? null,
          playbookRemedy: carc ? REMEDY_LABEL[carc.remedy] : null,
          payerPosition: playbook?.payerPosition ?? null,
          strategy: playbook?.strategy ?? null,
          avoid: playbook?.avoid ?? null,
        }
      : null,
  }
}

/**
 * A stored verdict, or nothing.
 *
 * A Json column's shape is not enforced by the database, so a verdict written
 * by an older build must degrade to "no verdict" rather than throw inside a
 * query that also has to return the free computed signals. The shape check is
 * deliberately shallow — enough to know the UI can render it.
 */
function readVerdict(body: unknown): Verdict | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null
  const v = body as Record<string, unknown>
  if (typeof v.model !== 'string' || typeof v.at !== 'string') return null
  if (!Array.isArray(v.allowedCodes)) return null
  for (const key of ['bestIcd10', 'denyAgain', 'worthIt', 'remedy']) {
    const j = v[key]
    if (typeof j !== 'object' || j === null || typeof (j as { asked?: unknown }).asked !== 'boolean') {
      return null
    }
  }
  return body as unknown as Verdict
}

export const claimsRouter = router({
  /**
   * Everything known about one claim.
   *
   * A real single-record read rather than picking the row out of the list the
   * table already has: the detail needs the work history, the drafts and the
   * submissions, none of which the list carries and none of which would be worth
   * loading for every row of a 200-row page.
   */
  detail: orgProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const claim = await ctx.prisma.orgClaim.findFirst({
        where: { id: input.id, orgId: ctx.orgId },
        include: { batch: { select: { filename: true, createdAt: true, statusDerived: true } } },
      })
      if (!claim) throw new TRPCError({ code: 'NOT_FOUND' })

      const today = new Date()
      const facts = {
        billed: money(claim.billed),
        allowed: claim.allowed === null ? null : money(claim.allowed),
        paid: claim.paid === null ? null : money(claim.paid),
        patientResp: claim.patientResp === null ? null : money(claim.patientResp),
        adjustment: claim.adjustment === null ? null : money(claim.adjustment),
        status: claim.status,
        serviceDate: claim.serviceDate,
        submittedDate: claim.submittedDate,
        remitDate: claim.remitDate,
      }

      // Aged with the same helpers the aging chart uses, so the two agree.
      const anchor = anchorDate(facts)
      const balance = outstanding(facts)
      const ageDays = anchor ? daysBetween(anchor, today) : null

      // The human side, and the denial row working it, both keyed on the claim
      // number rather than this snapshot row's id.
      const [work, denialRow] = await Promise.all([
        claim.claimNumber
          ? ctx.prisma.claimWork.findUnique({
              where: { orgId_claimNumber: { orgId: ctx.orgId, claimNumber: claim.claimNumber } },
              include: { events: { orderBy: { createdAt: 'desc' }, take: 100 } },
            })
          : null,
        claim.claimNumber
          ? ctx.prisma.denialRow.findFirst({
              where: { orgId: ctx.orgId, claimNumber: claim.claimNumber },
              include: {
                drafts: { orderBy: { version: 'asc' } },
                submissions: { orderBy: { sentAt: 'desc' }, take: 20 },
              },
            })
          : null,
      ])

      // What the payer said, resolved on read like everything else derived. The
      // reason text lives on the denial row, not the snapshot — an A/R export
      // carries the code, the denials export carries the wording.
      const carcCode = work?.correctedCarc ?? claim.carc
      const carc = carcCode ? lookupCarc(carcCode) : null
      const playbook = carcCode ? getPlaybook(carcCode) : null
      const refinement = carcCode
        ? refineDenial({ carc: carcCode, reason: denialRow?.reason ?? null })
        : null

      const window = filingWindow(claim.payer ?? undefined)
      const denialAnchor = claim.remitDate ?? claim.serviceDate
      const left =
        carcCode && denialAnchor
          ? daysLeft(denialAnchor, claim.payer ?? undefined, today)
          : null

      const entries = buildClaimTimeline({
        imported: { filename: claim.batch.filename, at: claim.batch.createdAt },
        events: work?.events ?? [],
        drafts: denialRow?.drafts ?? [],
        submissions: denialRow?.submissions ?? [],
      })

      // Names, not ids — the same resolution worklist.history does, and for the
      // same reason. This side never did it, so every actor the claim timeline
      // carried was dropped on the floor by the renderer: the column exists,
      // the events store it, and the dialog showed nothing. It matters more now
      // that "who" is on the headline rather than buried in a list.
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

      const timeline = entries.map(e => ({
        at: e.at,
        label: e.label,
        detail: e.detail,
        actor: e.actorId ? (nameOf.get(e.actorId) ?? null) : null,
      }))

      // The one clause of the history that belongs on the headline.
      const touch = lastHumanTouch(entries)

      return {
        id: claim.id,
        claimNumber: claim.claimNumber,
        payer: claim.payer,
        cpt: claim.cpt,
        icd10: claim.icd10,
        carc: claim.carc,
        ...facts,
        balance,
        ageDays,
        agingBucket: ageDays === null ? null : bucketFor(ageDays),

        snapshot: {
          filename: claim.batch.filename,
          at: claim.batch.createdAt,
          statusDerived: claim.batch.statusDerived,
        },

        // Null when the export gave this row no claim number: there is nothing
        // stable to key work to, and the UI says so rather than silently
        // dropping a note on the next import.
        workable: Boolean(claim.claimNumber),
        work: work
          ? {
              statusOverride: work.statusOverride,
              note: work.note,
              followUpAt: work.followUpAt,
              correctedCpt: work.correctedCpt,
              correctedIcd10: work.correctedIcd10,
              correctedCarc: work.correctedCarc,
              reviewBody: work.reviewBody,
              reviewedAt: work.reviewedAt,
              lastTouchedAt: work.lastTouchedAt,
            }
          : null,

        denial: carcCode
          ? {
              code: carcCode,
              label: carc?.label ?? null,
              // The useful half: what to actually do, not what it is called.
              note: carc?.note ?? null,
              remedy: carc ? REMEDY_LABEL[carc.remedy] : null,
              payerPosition: playbook?.payerPosition ?? null,
              strategy: playbook?.strategy ?? null,
              avoid: playbook?.avoid ?? null,
              evidence: playbook?.evidence ?? [],
              refinement,
              filingWindowDays: window.days,
              filingWindowSource: window.source,
              daysLeft: left,
            }
          : null,

        worklistRowId: denialRow?.id ?? null,
        draftCount: denialRow?.drafts.length ?? 0,
        submissionCount: denialRow?.submissions.length ?? 0,

        // Null when the import is the only thing that has ever happened. The
        // headline says so in words rather than rendering an empty clause.
        lastTouch: touch
          ? {
              at: touch.at,
              label: touch.label,
              kind: touch.kind as 'event' | 'draft' | 'submission',
              actor: touch.actorId ? (nameOf.get(touch.actorId) ?? null) : null,
            }
          : null,
        timeline,
      }
    }),

  /** Distinct reason codes in the snapshot, for the claims table filter. */
  carcNames: practiceProcedure.query(async ({ ctx }) => {
    const batch = await latestClaimsBatch(ctx.prisma, ctx.orgId, ctx.practiceWhere)
    if (!batch) return []
    const rows = await ctx.prisma.orgClaim.findMany({
      where: { orgId: ctx.orgId, ...ctx.practiceWhere, batchId: batch.id, carc: { not: null } },
      distinct: ['carc'],
      select: { carc: true },
      orderBy: { carc: 'asc' },
    })
    return rows.map(r => r.carc).filter((c): c is string => Boolean(c && c.trim()))
  }),

  /**
   * What the biller says the status is.
   *
   * Recorded as an override alongside the imported status, never over it. "The
   * export says denied, we got it paid on the phone last Tuesday" is two facts,
   * and losing the first one makes the next A/R reconciliation impossible.
   */
  setStatus: orgProcedure
    .input(z.object({ claimNumber: z.string().min(1), status: z.enum(CLAIM_STATUSES) }))
    .mutation(async ({ ctx, input }) => {
      const claim = await requireClaim(ctx, input.claimNumber)
      await recordWork(
        ctx,
        input.claimNumber,
        { statusOverride: input.status },
        { kind: 'STATUS_CHANGED', detail: `${claim.status} to ${input.status}` },
      )
      return { success: true }
    }),

  /**
   * The biller's note. Where the reason the payer gave on the phone lands.
   *
   * The same field DenialRow has, for the same reason: the denial reason on the
   * remittance and the reason a human is told on a call are routinely different,
   * and the second one exists in no export.
   */
  setNote: orgProcedure
    .input(z.object({ claimNumber: z.string().min(1), note: z.string().max(2_000) }))
    .mutation(async ({ ctx, input }) => {
      await requireClaim(ctx, input.claimNumber)
      const trimmed = input.note.trim()
      await recordWork(
        ctx,
        input.claimNumber,
        { note: trimmed || null },
        { kind: 'NOTE_ADDED', detail: trimmed ? trimmed.slice(0, 200) : 'Note cleared' },
      )
      return { success: true }
    }),

  setFollowUp: orgProcedure
    .input(
      z.object({
        claimNumber: z.string().min(1),
        /** Null clears it. */
        followUpAt: z.coerce.date().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireClaim(ctx, input.claimNumber)
      await recordWork(
        ctx,
        input.claimNumber,
        { followUpAt: input.followUpAt },
        {
          kind: 'FOLLOW_UP_SET',
          detail: input.followUpAt
            ? `Check back ${input.followUpAt.toISOString().slice(0, 10)}`
            : 'Follow-up cleared',
        },
      )
      return { success: true }
    }),

  /**
   * What the codes should have been.
   *
   * Stored alongside the imported codes, never replacing them. A coder needs to
   * see "we billed 99213, it should have been 99214" — that difference is the
   * corrected claim, and overwriting the first half destroys it.
   *
   * Undefined leaves a code alone; null clears a correction back to the imported
   * value.
   */
  correctCodes: orgProcedure
    .input(
      z.object({
        claimNumber: z.string().min(1),
        cpt: z.string().max(20).nullish(),
        icd10: z.string().max(20).nullish(),
        carc: z.string().max(20).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const claim = await requireClaim(ctx, input.claimNumber)

      const changes: string[] = []
      const data: Record<string, unknown> = {}
      const fields = [
        ['cpt', 'correctedCpt', claim.cpt, input.cpt],
        ['icd10', 'correctedIcd10', claim.icd10, input.icd10],
        ['carc', 'correctedCarc', claim.carc, input.carc],
      ] as const

      for (const [label, column, imported, next] of fields) {
        if (next === undefined) continue
        const value = next === null ? null : next.trim().toUpperCase() || null
        data[column] = value
        changes.push(
          value === null
            ? `${label} correction cleared`
            : `${label} ${imported ?? '—'} to ${value}`,
        )
      }

      if (changes.length === 0) return { success: true }

      // A correction invalidates both the verdict and the written reading of
      // it: both were reasoned from the codes that just changed. Keeping one
      // while discarding the other leaves a half-stale pair on screen that
      // nobody can reason about.
      data.reviewBody = null
      data.reviewFactsHash = null
      data.reviewedAt = null
      data.predictionBody = null
      data.predictionFactsHash = null
      data.predictionModel = null
      data.predictedAt = null

      await recordWork(ctx, input.claimNumber, data, {
        kind: 'CODE_CORRECTED',
        detail: changes.join(' · '),
      })
      return { success: true }
    }),

  /**
   * The computed half of the code review.
   *
   * Separate from `review` and free: it renders with no model call and no key
   * configured, because the payer's own reason code and the practice's own paid
   * rates are the evidence — the generated prose is a reading of them, not the
   * substance.
   */
  signals: orgProcedure
    .input(z.object({ claimNumber: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const { claim, signals, work } = await loadCodeContext(ctx, input.claimNumber)
      const facts = predictionFacts(claim, work)

      return {
        signals,
        available: GEMINI_AVAILABLE,
        predictionAvailable: TYPESAFE_AVAILABLE,
        // Stale once the facts move, so the UI can offer a refresh rather than
        // showing conclusions drawn from codes that have since been corrected.
        cached:
          work?.reviewBody && work.reviewFactsHash === signalsHash(signals)
            ? { body: work.reviewBody, at: work.reviewedAt }
            : null,
        // A verdict already paid for stays readable on any plan, for the same
        // reason the written review does: what a plan buys is the model call,
        // not the history of what it said.
        verdict:
          work?.predictionFactsHash === predictionHash(signals, facts)
            ? readVerdict(work?.predictionBody)
            : null,
      }
    }),

  /**
   * The bounded verdict: four judgments over one shared state, in one call.
   *
   * Structurally the same as `review` below, and deliberately so — cache check,
   * then the plan gate, then the call, then one transactional write. The
   * difference is what comes back. A generative model is asked for prose and
   * told in the prompt what it may not say; this one is handed a finite map of
   * options built from this practice's own settled claims and returns a key
   * from it. A code that is not in your history cannot come back, because there
   * is nothing for it to come back as.
   */
  predict: orgProcedure
    .input(z.object({ claimNumber: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const [{ claim, work, signals }, org] = await Promise.all([
        loadCodeContext(ctx, input.claimNumber),
        ctx.prisma.organization.findUnique({
          where: { id: ctx.orgId },
          select: { plan: true },
        }),
      ])

      const facts = predictionFacts(claim, work)
      const hash = predictionHash(signals, facts)

      const cached = readVerdict(work?.predictionBody)
      if (cached && work?.predictionFactsHash === hash) {
        return { verdict: cached, cached: true as const }
      }

      // Gated after the cache check, not before — a verdict already generated
      // is already served free by claims.signals, so hiding it here would only
      // be inconsistent. What a plan buys is the call.
      if (!canReviewCodes(org?.plan ?? 'TRIAGE')) {
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: upgradeMessage('Predicting the codes on a claim is a paid feature.'),
        })
      }

      if (!TYPESAFE_AVAILABLE) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message:
            'Claim prediction is not configured on this deployment. The figures above are computed and do not need it.',
        })
      }

      const state = buildPredictionState({
        signals,
        status: facts.status,
        billed: money(claim.billed),
        allowed: claim.allowed === null ? null : money(claim.allowed),
        paid: claim.paid === null ? null : money(claim.paid),
        balance: facts.balance,
        ageDays: facts.ageDays,
        filing: facts.filing,
        denial: facts.denial,
      })

      const result = await predictClaim(state)

      if (!result.ok) {
        if (result.reason === 'nothing-to-ask') {
          // Not a failure: a settled claim with no balance and no reason code
          // has nothing to judge. Say so rather than spending a call to be told.
          return { verdict: null, cached: false as const, skipped: result.skipped }
        }
        throw new TRPCError({
          code: 'BAD_GATEWAY',
          message: 'The prediction service could not be reached. The computed figures are unaffected.',
        })
      }

      const verdict = result.verdict

      await recordWork(
        ctx,
        input.claimNumber,
        {
          predictionBody: verdict as unknown as import('@prisma/client').Prisma.InputJsonValue,
          predictionFactsHash: hash,
          predictionModel: verdict.model,
          predictedAt: new Date(),
        },
        {
          // Reuses REVIEWED rather than adding a PREDICTED enum member: one
          // fewer ALTER TYPE, and lib/claims/timeline.ts falls back to the raw
          // kind, so a distinct member can be added later at no risk.
          kind: 'REVIEWED',
          detail: verdict.remedy.asked
            ? `Predicted from your payer history — ${PREDICTED_REMEDY_LABEL[verdict.remedy.choice]}`
            : 'Predicted from your payer history',
        },
      )

      return { verdict, cached: false as const }
    }),

  /**
   * Read the computed facts back in words.
   *
   * A mutation because it spends a model call and writes the result. Cached
   * against a hash of the facts it was drawn from, so opening the same claim
   * twice costs nothing and a corrected code invalidates it.
   */
  review: orgProcedure
    .input(z.object({ claimNumber: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const [{ claim, work, signals }, org] = await Promise.all([
        loadCodeContext(ctx, input.claimNumber),
        ctx.prisma.organization.findUnique({
          where: { id: ctx.orgId },
          select: { plan: true },
        }),
      ])
      const hash = signalsHash(signals)

      if (work?.reviewBody && work.reviewFactsHash === hash) {
        return { body: work.reviewBody, at: work.reviewedAt, cached: true }
      }

      // Gated after the cache check, not before: a review already generated is
      // already served free by claims.signals, so hiding it here would only be
      // inconsistent. What a plan buys is the model call, not the history.
      if (!canReviewCodes(org?.plan ?? 'TRIAGE')) {
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: upgradeMessage('Reading the code signals back in words is a paid feature.'),
        })
      }

      const carcCode = work?.correctedCarc ?? claim.carc
      const carc = carcCode ? lookupCarc(carcCode) : null
      const playbook = carcCode ? getPlaybook(carcCode) : null
      const denialAnchor = claim.remitDate ?? claim.serviceDate

      const billed = money(claim.billed)
      const paid = claim.paid === null ? null : money(claim.paid)

      /*
        One button, not two.

        The prose is a reading of the verdict, so the review produces one if
        none is cached rather than making it a second thing the biller has to
        click. A written review generated with no verdict behind it is exactly
        the failure mode this work exists to remove, and making it the default
        path would invite it straight back.

        When TypeSafe is unconfigured or the call fails, the review proceeds
        with verdict: null and the prompt's no-verdict branch — which is the
        behaviour this path has always had, now labelled rather than assumed.
      */
      const facts = predictionFacts(claim, work)
      const predictionKey = predictionHash(signals, facts)
      let verdict: Verdict | null =
        work?.predictionFactsHash === predictionKey ? readVerdict(work?.predictionBody) : null

      if (!verdict && TYPESAFE_AVAILABLE) {
        const predicted = await predictClaim(
          buildPredictionState({
            signals,
            status: facts.status,
            billed,
            allowed: claim.allowed === null ? null : money(claim.allowed),
            paid,
            balance: facts.balance,
            ageDays: facts.ageDays,
            filing: facts.filing,
            denial: facts.denial,
          }),
        )
        if (predicted.ok) {
          verdict = predicted.verdict
          await recordWork(
            ctx,
            input.claimNumber,
            {
              predictionBody: predicted.verdict as unknown as import('@prisma/client').Prisma.InputJsonValue,
              predictionFactsHash: predictionKey,
              predictionModel: predicted.verdict.model,
              predictedAt: new Date(),
            },
            { kind: 'REVIEWED', detail: 'Predicted from your payer history' },
          )
        }
      }

      let body: string
      try {
        body = await reviewClaim({
          verdict,
          status: work?.statusOverride ?? claim.status,
          billed,
          paid,
          allowed: claim.allowed === null ? null : money(claim.allowed),
          balance: Math.max(
            0,
            Math.round((billed - (paid ?? 0) - money(claim.adjustment)) * 100) / 100,
          ),
          signals,
          denial: carcCode
            ? {
                code: carcCode,
                label: carc?.label ?? null,
                note: carc?.note ?? null,
                remedy: carc ? REMEDY_LABEL[carc.remedy] : null,
                payerPosition: playbook?.payerPosition ?? null,
                strategy: playbook?.strategy ?? null,
                avoid: playbook?.avoid ?? null,
                daysLeft: denialAnchor
                  ? daysLeft(denialAnchor, claim.payer ?? undefined, new Date())
                  : null,
              }
            : null,
        })
      } catch (err) {
        if (err instanceof ReviewUnavailableError) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: err.message })
        }
        // Deliberately NOT cached. A body that named a code outside the
        // verdict is wrong, and a wrong review served from cache for a month
        // is how one bad suggestion becomes a habit.
        if (err instanceof ReviewOffMapError) {
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: err.message })
        }
        throw err
      }

      const at = new Date()
      await recordWork(
        ctx,
        input.claimNumber,
        { reviewBody: body, reviewFactsHash: hash, reviewedAt: at },
        { kind: 'REVIEWED', detail: 'Codes reviewed against your payer history' },
      )

      return { body, at, cached: false }
    }),
})

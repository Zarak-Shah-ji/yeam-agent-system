/**
 * What to work first.
 *
 * The ask this file answers, from a practice administrator running an RCM team:
 * "assigning a score to every claim to tell the team what is a priority, and for
 * that score to be based on the follow-up date, the last touch, last EDI and the
 * dollar amount — kind of like a mix of everything, along with what aging bucket
 * the claim is in... Epic already has sort of a scoring thing in their work
 * queues but a lot of EHRs are missing that."
 *
 * Before this, the worklist sorted by soonest deadline and then by dollars. That
 * is a defensible sort and a bad queue: it puts a $40 copay adjustment expiring
 * on Friday above a $12,000 authorization denial with three weeks left, and it
 * never notices that nobody has touched the $12,000 row in a month.
 *
 * ── Design rules, all three load-bearing ────────────────────────────────────
 *
 * 1. NOTHING IS STORED. Same discipline as lib/denials/triage.ts and
 *    lib/insights/aggregate.ts: `today` is injected, every function is pure, and
 *    the score is computed on read. A priority written to the database is wrong
 *    the next morning — which is the specific way work queues rot.
 *
 * 2. THE SCORE IS EXPLAINED, NOT ASSERTED. Every score carries the factors that
 *    produced it, and the UI shows them. A biller who cannot see why a row is at
 *    the top will sort by dollars instead and the feature is dead. This is the
 *    difference between a work queue and a horoscope.
 *
 * 3. UNWORKABLE IS ZERO, ALWAYS. A row that is expired or not payer-recoverable
 *    scores 0 no matter how large it is, because the answer to "when do I write
 *    this off versus try again" has to be legible in the queue itself. A $50,000
 *    claim past its filing window is not the most important thing on the list;
 *    it is not on the list.
 *
 * This file is additive. It reads a row that lib/denials/triage.ts has already
 * triaged and adds a ranking on top. It does not touch the CARC table or the
 * filing windows, which are a deliberate copy of the yeam_website versions.
 */

import type { Remedy } from './triage'

/* ------------------------------------------------------------- weighting --- */

/**
 * What each signal is worth, out of 100.
 *
 * Exported and named because these are a judgement call, not a fact, and the
 * first customer with an opinion should be able to see them and argue. They sum
 * to 100 so a score reads as a percentage of "maximum possible urgency".
 *
 * The follow-up date is deliberately NOT in here — see FOLLOW_UP_BONUS. An
 * earlier version made it a sixth weighted slice worth 10, which quietly broke
 * the scale: almost no row has a follow-up date set, so the practical ceiling
 * for a normal row was 90 rather than 100 while the band thresholds were chosen
 * as though it were 100. Every score in a real workspace was deflated by up to
 * ten points for a signal the biller had simply never used.
 */
export const WEIGHTS = {
  /** Time left to act. The only irreversible signal — money can wait, a window cannot. */
  deadline: 38,
  /** Dollars at stake, log-scaled so one large claim cannot flatten the queue. */
  money: 32,
  /** How long since a human last did anything to it. Stops rows going quiet. */
  staleness: 18,
  /** Cost to resolve: a corrected claim is a ten-minute fix, an appeal is not. */
  remedy: 12,
} as const

const TOTAL_WEIGHT = Object.values(WEIGHTS).reduce((a, b) => a + b, 0)

/**
 * An overdue follow-up adds to a complete score rather than owning part of it.
 *
 * A date the biller set themselves is the strongest signal in the system when it
 * exists and is simply absent the rest of the time. As a bonus its absence costs
 * a row nothing, and its presence can push a row that already scores well to the
 * top of the queue — which is what "their judgement outranks ours" should mean.
 * Capped so the total never exceeds 100.
 */
export const FOLLOW_UP_BONUS = 12

/* ------------------------------------------------------------- components --- */

/** Days between two dates, ignoring time of day. Mirrors triage.ts deliberately. */
function daysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate())
  return Math.round((b - a) / 86_400_000)
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}

/**
 * Urgency from the filing window.
 *
 * Steep near the deadline and flat far from it, because the difference between
 * 7 and 14 days left matters enormously and the difference between 120 and 140
 * does not. A row with no date scores mid — it cannot be proven urgent, and
 * burying it is how undated claims quietly die.
 */
export function deadlineFactor(daysLeft: number | null): number {
  if (daysLeft === null) return 0.5
  if (daysLeft <= 0) return 1
  if (daysLeft <= 7) return 1
  if (daysLeft <= 14) return 0.9
  if (daysLeft >= 120) return 0.05
  // Linear between the two-week cliff and the four-month horizon.
  return clamp01(0.9 - ((daysLeft - 14) / (120 - 14)) * 0.85)
}

/**
 * Dollars, log-scaled between a floor and a reference.
 *
 * Linear dollars make a queue useless: one $80,000 claim scores every other row
 * to nothing. A log curve keeps a $4,000 denial clearly above a $600 one without
 * erasing the $600 one. $50 scores 0, the reference scores 1.
 *
 * The reference is calibrated to what denials actually look like, not to what a
 * large claim could theoretically be. Measured against a real workspace, denied
 * claims ran $188 to $3,250 with a median near $740 — against the old $25,000
 * reference that entire practice was squeezed into the bottom third of the
 * curve, so the money signal barely separated a $3,000 denial from a $500 one.
 * At $8,000 the realistic range spreads across most of the curve, and genuinely
 * large denials still sit at the ceiling where they belong.
 */
const MONEY_FLOOR = 50
const MONEY_REFERENCE = 8_000

export function moneyFactor(billed: number): number {
  if (!Number.isFinite(billed) || billed <= MONEY_FLOOR) return 0
  const span = Math.log10(MONEY_REFERENCE) - Math.log10(MONEY_FLOOR)
  return clamp01((Math.log10(billed) - Math.log10(MONEY_FLOOR)) / span)
}

/**
 * How long this has been sitting untouched.
 *
 * `lastTouchedAt` is set only by a human action — marking a row sent, paid or
 * dead, or leaving a note. It is deliberately NOT `updatedAt`, which any batch
 * write resets and which would therefore report a row as freshly handled when
 * nothing happened to it. A row nobody has ever touched ages from its denial
 * date, so an old import does not arrive looking brand new.
 */
export function stalenessFactor(
  lastTouchedAt: Date | null,
  denialDate: Date | null,
  today: Date,
): number {
  const since = lastTouchedAt ?? denialDate
  if (!since) return 0.5
  const days = daysBetween(since, today)
  if (days <= 0) return 0
  return clamp01(days / 30)
}

/**
 * A follow-up date the biller set themselves.
 *
 * Returns 0 to 1, which scoreRow multiplies by FOLLOW_UP_BONUS and adds to an
 * already-complete score. Nothing scheduled scores 0 and costs the row nothing,
 * because most rows will never have one — that is the whole reason this is a
 * bonus rather than a weight.
 */
export function followUpFactor(followUpAt: Date | null, today: Date): number {
  if (!followUpAt) return 0
  const days = daysBetween(followUpAt, today)
  if (days > 0) return 1 // overdue
  if (days === 0) return 0.9 // due today
  if (days >= -3) return 0.4 // due within three days
  return 0
}

/**
 * How cheap this is to resolve.
 *
 * A corrected claim is often a field and a resubmit; an appeal is a letter, an
 * enclosure and a wait. All else equal the ten-minute fix should be worked
 * first, because the queue clears faster and the money lands sooner. An unknown
 * code scores mid — it needs a human's eyes, which is itself a reason to surface it.
 */
export function remedyFactor(remedy: Remedy): number {
  switch (remedy) {
    case 'corrected_claim':
      return 1
    case 'reprocess':
      return 0.8
    case 'appeal':
      return 0.6
    case 'unknown':
      return 0.5
    case 'not_recoverable':
      return 0
  }
}

/* ----------------------------------------------------------------- score --- */

export type ScoreFactor = {
  key: keyof typeof WEIGHTS | 'followUp'
  label: string
  /** Points contributed, already weighted. Rounded for display. */
  points: number
  /** Why, in the words a biller would use. */
  detail: string
}

/** Coarse grouping, for filters and colour. The number ranks; the band explains. */
export type PriorityBand = 'now' | 'soon' | 'later' | 'parked'

export const BAND_LABEL: Record<PriorityBand, string> = {
  now: 'Work now',
  soon: 'This week',
  later: 'Can wait',
  parked: 'Not workable',
}

export type ScoreInput = {
  billed: number
  daysLeft: number | null
  actionable: boolean
  remedy: Remedy
  denialDate: Date | null
  lastTouchedAt: Date | null
  followUpAt: Date | null
}

export type Scored = {
  /** 0–100. Higher is more urgent. */
  score: number
  band: PriorityBand
  /** What produced the score, largest contribution first. */
  factors: ScoreFactor[]
}

function bandFor(score: number): PriorityBand {
  if (score === 0) return 'parked'
  if (score >= 70) return 'now'
  if (score >= 45) return 'soon'
  return 'later'
}

/**
 * Score one denial.
 *
 * The early return is the most important line in the file: a row that cannot be
 * recovered is not ranked at all. Everything below it assumes the row is worth
 * somebody's time and is only deciding whose time, and when.
 */
export function scoreRow(input: ScoreInput, today: Date): Scored {
  if (!input.actionable) {
    return {
      score: 0,
      band: 'parked',
      factors: [
        {
          key: 'remedy',
          label: 'Not workable',
          points: 0,
          detail:
            input.remedy === 'not_recoverable'
              ? 'Not recoverable from the payer — bill the patient or close it.'
              : 'Past the filing window. Nothing to send.',
        },
      ],
    }
  }

  const raw = {
    deadline: deadlineFactor(input.daysLeft),
    money: moneyFactor(input.billed),
    staleness: stalenessFactor(input.lastTouchedAt, input.denialDate, today),
    remedy: remedyFactor(input.remedy),
  }

  const base =
    (Object.entries(raw) as [keyof typeof WEIGHTS, number][]).reduce(
      (sum, [key, value]) => sum + value * WEIGHTS[key],
      0,
    ) *
    (100 / TOTAL_WEIGHT)

  // The bonus rides on top of a complete score, so a row without a follow-up
  // date is measured against the same ceiling as one with it.
  const followUpRaw = followUpFactor(input.followUpAt, today)
  const score = Math.min(100, Math.round(base + followUpRaw * FOLLOW_UP_BONUS))

  const untouchedDays = (() => {
    const since = input.lastTouchedAt ?? input.denialDate
    return since ? daysBetween(since, today) : null
  })()

  const factors: ScoreFactor[] = [
    {
      key: 'deadline',
      label: 'Deadline',
      points: Math.round(raw.deadline * WEIGHTS.deadline),
      detail:
        input.daysLeft === null
          ? 'No remit date, so the window cannot be computed.'
          : input.daysLeft <= 14
            ? `${input.daysLeft} days left to file.`
            : `${input.daysLeft} days left.`,
    },
    {
      key: 'money',
      label: 'Amount',
      points: Math.round(raw.money * WEIGHTS.money),
      detail: `$${Math.round(input.billed).toLocaleString('en-US')} billed.`,
    },
    {
      key: 'staleness',
      label: 'Untouched',
      points: Math.round(raw.staleness * WEIGHTS.staleness),
      detail:
        untouchedDays === null
          ? 'No date to age from.'
          : input.lastTouchedAt
            ? `Last worked ${untouchedDays} days ago.`
            : `Never worked, ${untouchedDays} days old.`,
    },
    {
      key: 'followUp',
      label: 'Follow-up',
      points: Math.round(followUpRaw * FOLLOW_UP_BONUS),
      detail: input.followUpAt
        ? daysBetween(input.followUpAt, today) > 0
          ? 'Follow-up date has passed.'
          : 'Follow-up scheduled.'
        : 'No follow-up set — costs this row nothing.',
    },
    {
      key: 'remedy',
      label: 'Effort',
      points: Math.round(raw.remedy * WEIGHTS.remedy),
      detail:
        input.remedy === 'corrected_claim'
          ? 'Corrected claim — usually a quick fix.'
          : input.remedy === 'appeal'
            ? 'Appeal — needs an argument and evidence.'
            : input.remedy === 'reprocess'
              ? 'Reprocessing request — short, but a wait.'
              : 'Unrecognised code, needs a look.',
    },
  ]

  factors.sort((a, b) => b.points - a.points)

  return { score, band: bandFor(score), factors }
}

/* --------------------------------------------------------- worth a call? --- */

/**
 * Whether chasing this one today is worth the hold music.
 *
 * From the same conversation: "all three of these are very time taking and often
 * it ends that the claim was in process and the call and the time taken out of
 * the day to inquire for the status was not worth it at the end."
 *
 * That is a solvable problem without a single phone integration. We already
 * compute each payer's median days to pay from the A/R snapshot
 * (payerScorecard in lib/insights/aggregate.ts). A resubmission sent four days
 * ago to a payer that takes a median of 34 days is not late — it is in process,
 * and the call is wasted. One sent 60 days ago is overdue and worth the wait.
 *
 * Scoped to rows that have actually been sent. A row still sitting in the queue
 * has nothing to chase: the answer there is to work it, not to call about it.
 */
export type CallVerdict = 'not-sent' | 'in-process' | 'due' | 'overdue' | 'unknown'

export type CallGuidance = {
  verdict: CallVerdict
  label: string
  detail: string
}

export function callGuidance(
  input: {
    status: string
    /** When the row was marked sent. */
    lastTouchedAt: Date | null
    /** Median days this payer takes to pay, from the A/R snapshot. */
    payerMedianDaysToPay: number | null
  },
  today: Date,
): CallGuidance {
  if (input.status !== 'SENT') {
    return {
      verdict: 'not-sent',
      label: '—',
      detail: 'Nothing sent yet, so there is nothing to chase.',
    }
  }

  if (!input.lastTouchedAt) {
    return {
      verdict: 'unknown',
      label: 'No send date',
      detail: 'Marked sent, but without a date to measure from.',
    }
  }

  const waiting = daysBetween(input.lastTouchedAt, today)

  if (input.payerMedianDaysToPay === null) {
    // No snapshot, so no median. A flat 30-day rule of thumb, labelled as one.
    return waiting >= 30
      ? {
          verdict: 'due',
          label: `Waiting ${waiting}d`,
          detail: 'No A/R snapshot for this payer — using a 30-day rule of thumb.',
        }
      : {
          verdict: 'in-process',
          label: `Waiting ${waiting}d`,
          detail: 'Import an A/R export to learn this payer\'s actual turnaround.',
        }
  }

  const median = input.payerMedianDaysToPay

  if (waiting < median) {
    return {
      verdict: 'in-process',
      label: `Don't call yet`,
      detail: `Sent ${waiting}d ago. This payer's median is ${median}d — it is still in process.`,
    }
  }
  if (waiting < median * 1.5) {
    return {
      verdict: 'due',
      label: 'Due a chase',
      detail: `Sent ${waiting}d ago, past this payer's ${median}d median.`,
    }
  }
  return {
    verdict: 'overdue',
    label: 'Overdue',
    detail: `Sent ${waiting}d ago — ${Math.round(waiting / median)}× this payer's ${median}d median.`,
  }
}

import { prisma } from '@/lib/db'

export interface ShowcaseAppeal {
  id: string
  claimNumber: string | null
  patientName: string | null
  payerName: string | null
  serviceDate: string | null
  denialReason: string | null
  denialCode: string | null
  /** Amount in dispute, so the card conveys whether the claim is worth working. */
  billedAmount: number | null
  /** Last date the appeal can be filed under the payer's published window. */
  appealDeadline: string | null
  daysRemaining: number | null
  /** 'remittance' or 'date-of-service' — which limit produced the deadline. */
  deadlineGovernedBy: string | null
  procedureCode: string | null
  /**
   * Which instrument this document is — appeal letter, corrected claim,
   * reconsideration, reprocessing request. Older rows predate the distinction
   * and fall back to an appeal letter.
   */
  artifactLabel: string
  letter: string
  createdAt: Date
}

/** Minimum length that distinguishes a real drafted letter from a stub/error blurb. */
const MIN_LETTER_LENGTH = 200

/** sessionId stamped on letters drafted from a visitor upload in the portal. */
export const PORTAL_SESSION = 'appeals-portal'

/** sessionId stamped on letters drafted from the public tool on yeam.ai. */
export const PUBLIC_DEMO_SESSION = 'public-demo'

/**
 * Pull the letter's own "Re:" header apart for rows written before the agent
 * started persisting summary fields alongside the letter.
 */
function parseFromLetter(letter: string, field: RegExp): string | null {
  const match = letter.match(field)
  return match?.[1]?.trim() || null
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

const DAY_MS = 86_400_000

/**
 * Days left to file, recomputed against today rather than read from the stored
 * value. The agent stamps `daysRemaining` when it drafts, so a letter sitting in
 * the log for a month would otherwise keep advertising the countdown it had on
 * the day it was written. The deadline date is fixed; the countdown is not.
 */
function daysUntil(deadline: string | null): number | null {
  if (!deadline) return null
  const parsed = Date.parse(deadline)
  if (Number.isNaN(parsed)) return null
  return Math.round((parsed - Date.now()) / DAY_MS)
}

/**
 * Read the appeal letters the system has generated from live claim data.
 *
 * There is no Appeal table — BaseAgent persists every completed agent event to
 * `AgentLog`, and the billing agent's `data` payload carries the letter. That
 * log is the system of record for generated letters, so the review portal reads
 * from it directly and always reflects live output.
 *
 * Letters drafted from a visitor's own upload are excluded: they are returned to
 * them directly, and including them here would push the curated set off the page
 * after a few uploads.
 */
export async function listShowcaseAppeals(limit = 5): Promise<ShowcaseAppeal[]> {
  // Over-fetch: some BILLING/COMPLETE rows are post-payment or query intents
  // that carry no letter at all, and they get filtered out below.
  const rows = await prisma.agentLog.findMany({
    where: {
      agentName: 'BILLING',
      status: 'COMPLETE',
      NOT: { sessionId: { in: [PORTAL_SESSION, PUBLIC_DEMO_SESSION] } },
    },
    orderBy: { createdAt: 'desc' },
    take: 40,
  })

  const appeals: ShowcaseAppeal[] = []

  for (const row of rows) {
    const data = (row.data ?? {}) as Record<string, unknown>
    const letter = str(data.appealLetter)
    if (!letter || letter.length < MIN_LETTER_LENGTH) continue

    appeals.push({
      id: row.id,
      claimNumber:
        str(data.claimNumber) ??
        parseFromLetter(letter, /Claim Number:\s*(.+)/i) ??
        parseFromLetter(row.message, /drafted for\s+([A-Z0-9-]+)/i),
      patientName:
        str(data.patientName) ?? parseFromLetter(letter, /Patient(?: Name)?:\s*(.+)/i),
      payerName: str(data.payerName),
      serviceDate:
        str(data.serviceDate) ?? parseFromLetter(letter, /Date of Service:\s*(.+)/i),
      denialReason: str(data.denialReason),
      denialCode: str(data.denialCode),
      billedAmount: num(data.billedAmount),
      appealDeadline: str(data.appealDeadline),
      daysRemaining: daysUntil(str(data.appealDeadline)) ?? num(data.daysRemaining),
      deadlineGovernedBy: str(data.deadlineGovernedBy),
      procedureCode: str(data.procedureCode),
      artifactLabel: str(data.artifactLabel) ?? 'Appeal letter',
      letter,
      createdAt: row.createdAt,
    })

    if (appeals.length >= limit) break
  }

  return appeals
}

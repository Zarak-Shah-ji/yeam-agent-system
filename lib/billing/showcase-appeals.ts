import { prisma } from '@/lib/db'

export interface ShowcaseAppeal {
  id: string
  claimNumber: string | null
  patientName: string | null
  payerName: string | null
  serviceDate: string | null
  denialReason: string | null
  denialCode: string | null
  letter: string
  createdAt: Date
  /** Where it came from: the in-app billing screen, or this review portal. */
  source: 'dashboard' | 'portal'
}

/** Minimum length that distinguishes a real drafted letter from a stub/error blurb. */
const MIN_LETTER_LENGTH = 200

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

/**
 * Read the appeal letters the system has actually generated.
 *
 * There is no Appeal table — BaseAgent persists every completed agent event to
 * `AgentLog`, and the billing agent's `data` payload carries the letter. That
 * log is the system of record for generated letters, so the review portal reads
 * from it directly and always reflects live output.
 */
export async function listShowcaseAppeals(limit = 5): Promise<ShowcaseAppeal[]> {
  // Over-fetch: some BILLING/COMPLETE rows are post-payment or query intents
  // that carry no letter at all, and they get filtered out below.
  const rows = await prisma.agentLog.findMany({
    where: { agentName: 'BILLING', status: 'COMPLETE' },
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
      letter,
      createdAt: row.createdAt,
      source: row.sessionId === 'appeals-portal' ? 'portal' : 'dashboard',
    })

    if (appeals.length >= limit) break
  }

  return appeals
}

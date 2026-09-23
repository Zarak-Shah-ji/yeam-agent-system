import type { PrismaClient } from '@prisma/client'
import { payerTurnaround } from '@/lib/insights/aggregate'
import { FACT_ROW_CAP } from '@/lib/insights/facts'
import type { PracticeWhere } from '@/lib/practices/scope'

/**
 * Each payer's median days to settle, from the most recent A/R snapshot.
 *
 * The only consumer is callGuidance() in score.ts, which decides whether a sent
 * claim is still in process or late. That makes this the one number a worklist
 * row needs that does not come from the row.
 *
 * It lives here rather than inside the worklist router because there are now two
 * readers — the `rows` procedure and app/api/worklist/export/route.ts — and the
 * rule they have to agree on is not the median itself but *which snapshot* it
 * comes from: the most recent CLAIMS batch, and only that one. A monthly A/R
 * export re-states the same claims, so a loader that unioned two batches would
 * measure every payer twice (the reasoning in lib/insights/facts.ts). Two copies
 * of that rule would drift, and the symptom would be the table calling a payer
 * late while the file the biller exported two seconds earlier calls it on time.
 *
 * Selects the five columns the median actually needs. A worklist request has no
 * business loading every dollar column of an A/R snapshot.
 *
 * `practiceWhere` narrows it to one clinic, and both readers pass the same one
 * for the same reason the paragraph above gives: a table and an export that
 * disagree about which snapshot a payer was measured from will disagree about
 * whether that payer is late. A clinic that bills a payer under its own contract
 * genuinely gets paid on a different schedule, so the median is per-practice
 * whenever the view is.
 */
export async function loadPayerMedians(
  prisma: PrismaClient,
  orgId: string,
  practiceWhere: PracticeWhere = {},
): Promise<Map<string, number>> {
  const batch = await prisma.importBatch.findFirst({
    where: { orgId, ...practiceWhere, kind: 'CLAIMS' },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  })
  if (!batch) return new Map<string, number>()

  const claims = await prisma.orgClaim.findMany({
    where: { orgId, ...practiceWhere, batchId: batch.id },
    select: {
      payer: true,
      status: true,
      serviceDate: true,
      submittedDate: true,
      remitDate: true,
    },
    take: FACT_ROW_CAP,
  })

  return payerTurnaround(claims)
}

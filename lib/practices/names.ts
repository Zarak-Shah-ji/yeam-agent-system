import type { PrismaClient } from '@prisma/client'

/**
 * Practice id to display label, for one workspace.
 *
 * Loaded once per request and handed to buildWorklistRow for every row. The
 * alternative — a join on the rows query — is paid on up to 50,000 records to
 * resolve a handful of distinct names, which is the same reason practiceId is
 * denormalised onto DenialRow in the first place (see schema.prisma).
 *
 * Archived practices are INCLUDED. Their rows still exist and still have to
 * render a name; leaving them out would turn a year of a departed clinic's
 * history into a column of blanks. Archiving hides a practice from the places
 * you can CHOOSE one, not from the places its work is shown.
 */
export async function loadPracticeNames(
  prisma: PrismaClient,
  orgId: string,
): Promise<Map<string, string>> {
  const practices = await prisma.practice.findMany({
    where: { orgId },
    select: { id: true, name: true },
    // A workspace with more than this has a different problem than a truncated
    // map, but the query is still bounded rather than trusting.
    take: 500,
  })
  return new Map(practices.map(p => [p.id, p.name]))
}

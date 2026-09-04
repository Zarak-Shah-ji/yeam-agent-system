/**
 * Is this workspace looking at its own data, or at the sample practice?
 *
 * Resolved server-side in the dashboard layout so the banner is right on the
 * first paint. A client-side query would tell a paying customer their real
 * denials were sample data for a frame, which is the exact confusion worth
 * spending a server round-trip to avoid.
 *
 * There is no longer a separate sample *section* to route to — the sample
 * arrives as an ImportBatch in the workspace's own tables and is read through
 * the same queries as a real upload. All that is left to decide is what the
 * banner says. See lib/sample-practice.ts.
 */

import { prisma } from '@/lib/db'

export type WorkspaceState =
  /** Signed in with no organization at all. Should not happen for new accounts. */
  | { kind: 'none' }
  /** Has an org, but everything in it is seeded. Sections render, bannered. */
  | { kind: 'sample'; orgId: string }
  /** Has imported at least one real file. Nothing is bannered. */
  | { kind: 'live'; orgId: string }

export async function getWorkspaceState(userId: string | undefined): Promise<WorkspaceState> {
  if (!userId) return { kind: 'none' }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { orgId: true },
  })
  if (!user?.orgId) return { kind: 'none' }

  // One query, not two: the newest batch settles it either way.
  const real = await prisma.importBatch.findFirst({
    where: { orgId: user.orgId, isSample: false },
    select: { id: true },
  })

  return real ? { kind: 'live', orgId: user.orgId } : { kind: 'sample', orgId: user.orgId }
}

/** True once the workspace holds a file the customer imported themselves. */
export async function hasWorkspaceData(userId: string | undefined): Promise<boolean> {
  return (await getWorkspaceState(userId)).kind === 'live'
}

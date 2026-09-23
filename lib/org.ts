import { prisma } from '@/lib/db'
import { practiceScope, type PracticeWhere } from '@/lib/practices/scope'

/**
 * Workspace naming and provisioning.
 *
 * Every account that can hold customer data belongs to exactly one organization,
 * created at signup. The alternative — provisioning lazily on first upload —
 * leaves a window where a signed-in user has no org, and every org-scoped query
 * has to decide what to do about it. Creating it with the account closes that.
 */

/** What every route handler gets: the tenant, and which clinic is in view. */
export interface RequiredOrg {
  userId: string
  orgId: string
  practiceId: string | null
  practiceWhere: PracticeWhere
  practiceStale: boolean
}

/** Mailbox providers that say nothing about who someone works for. */
const GENERIC_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'yahoo.com',
  'ymail.com',
  'icloud.com',
  'me.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'pm.me',
  'zoho.com',
  'gmx.com',
  'mail.com',
  'fastmail.com',
])

/**
 * A first guess at what to call the workspace, good enough to never block
 * signup on a form field. A billing company signing up as billing@acmermc.com
 * gets "Acmermc"; someone on Gmail gets their own name. Renameable in settings.
 */
export function deriveOrgName(email: string, personName?: string | null): string {
  const domain = email.split('@')[1]?.toLowerCase().trim()

  if (domain && !GENERIC_DOMAINS.has(domain)) {
    const label = domain.split('.')[0]
    if (label) return label.charAt(0).toUpperCase() + label.slice(1)
  }

  const person = personName?.trim()
  if (person) return `${person}'s workspace`

  const mailbox = email.split('@')[0]?.trim()
  return mailbox ? `${mailbox}'s workspace` : 'My workspace'
}

/**
 * Give a user an organization if they do not already have one.
 *
 * Idempotent, because it runs from two different places: the credentials signup
 * mutation and the OAuth createUser event. Returns the org id either way.
 */
export async function ensureOrgForUser(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, orgId: true },
  })

  if (!user) return null
  if (user.orgId) return user.orgId

  const org = await prisma.organization.create({
    data: { name: deriveOrgName(user.email, user.name) },
  })

  await prisma.user.update({
    where: { id: user.id },
    // The person who creates the workspace administers it. Roles are enforced
    // from here on, so this cannot stay the FRONT_DESK default.
    data: { orgId: org.id, role: 'ADMIN' },
  })

  // A new workspace opens empty, on the import screen. It used to open on a
  // seeded sample practice; that put example denials and example revenue in
  // front of someone whose first question is what the product does with THEIR
  // file, and every section then had to caveat itself. The sections already
  // render an honest "nothing imported yet" that points at /connect, which is
  // the screen the customer wants anyway. See lib/sample-practice.ts, still
  // used by prisma/seed.ts for local development.

  return org.id
}

/**
 * Resolve the caller's workspace inside a route handler.
 *
 * The tRPC equivalent is orgProcedure. Route handlers take uploads, so they
 * cannot go through tRPC, but they must apply the same rule: no org, no access
 * to customer data — never a fallback that reads everything.
 *
 * It resolves the active practice too, the way practiceProcedure does. Note the
 * asymmetry that mirrors the tRPC side: a missing org REFUSES the request, a
 * missing or stale practice WIDENS it. One is a tenant boundary and the other
 * is a view.
 */
export async function requireOrg(): Promise<RequiredOrg | null> {
  const { auth } = await import('@/lib/auth')
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return null

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { orgId: true, activePracticeId: true },
  })
  if (!user?.orgId) return null

  // The same resolution practiceProcedure does, for the handlers that cannot
  // go through tRPC. Kept identical on purpose: an export route that read a
  // practice the worklist beside it was not showing would hand someone a file
  // that disagrees with their screen.
  const lookup = user.activePracticeId
    ? await prisma.practice.findUnique({
        where: { id: user.activePracticeId },
        select: { id: true, orgId: true, archivedAt: true },
      })
    : null
  const scope = practiceScope(user.activePracticeId, lookup, user.orgId)

  return {
    userId,
    orgId: user.orgId,
    practiceId: scope.practiceId,
    practiceWhere: scope.practiceWhere,
    practiceStale: scope.reason === 'stale',
  }
}

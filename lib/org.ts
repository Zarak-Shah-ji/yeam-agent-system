import { prisma } from '@/lib/db'
import { seedSamplePractice } from '@/lib/sample-practice'

/**
 * Workspace naming and provisioning.
 *
 * Every account that can hold customer data belongs to exactly one organization,
 * created at signup. The alternative — provisioning lazily on first upload —
 * leaves a window where a signed-in user has no org, and every org-scoped query
 * has to decide what to do about it. Creating it with the account closes that.
 */

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

  // Same as the credentials path: a new workspace opens on the sample practice.
  try {
    await seedSamplePractice(prisma, org.id)
  } catch (err) {
    console.error('sample practice seed failed for org', org.id, err)
  }

  return org.id
}

/**
 * Resolve the caller's workspace inside a route handler.
 *
 * The tRPC equivalent is orgProcedure. Route handlers take uploads, so they
 * cannot go through tRPC, but they must apply the same rule: no org, no access
 * to customer data — never a fallback that reads everything.
 */
export async function requireOrg(): Promise<{ userId: string; orgId: string } | null> {
  const { auth } = await import('@/lib/auth')
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return null

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { orgId: true },
  })
  if (!user?.orgId) return null

  return { userId, orgId: user.orgId }
}

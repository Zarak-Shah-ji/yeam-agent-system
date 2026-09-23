import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

/**
 * Give every workspace one default practice, and file its existing work under it.
 *
 * NOT a migration, deliberately. Prisma runs a migration file in a transaction,
 * and a transaction that rewrites every denial row in a large workspace holds
 * locks for as long as it takes. This is a standalone script so it can be run
 * outside a deploy, in its own time, and resumed if it stops.
 *
 * Safe to run against a live database. Every column it writes is nullable and,
 * at the time this ships, nothing reads them yet — a workspace with no
 * practiceId anywhere behaves exactly as it did before. The switcher and the
 * filter are the release that starts reading them.
 *
 * Idempotent and resumable. Re-running it creates no second practice (it looks
 * for the existing default first) and rewrites no row that already has one (the
 * updates are all filtered on `practiceId: null`). It can be killed at any point
 * and restarted.
 *
 *   npx tsx prisma/scripts/backfill-practices.ts          # do it
 *   npx tsx prisma/scripts/backfill-practices.ts --dry-run # say what it would do
 *
 * Modelled on prisma/seed.ts.
 */

const DRY_RUN = process.argv.includes('--dry-run')

/** How many rows to move per statement, so no single write runs long. */
const CHUNK = 5_000

const IDENTITY_FIELDS = [
  'practiceName',
  'npi',
  'tin',
  'addressLine1',
  'addressLine2',
  'city',
  'state',
  'postalCode',
  'contactName',
  'contactPhone',
  'contactFax',
  'contactEmail',
] as const

/**
 * What to call the clinic in the switcher.
 *
 * The practice's own name if the workspace filled one in, the workspace name
 * otherwise. Never blank: this is the label a biller clicks, and an empty
 * entry in a menu is unusable.
 */
function defaultLabel(org: { name: string; practiceName: string | null }): string {
  return org.practiceName?.trim() || org.name.trim() || 'Main practice'
}

async function backfillOrg(org: {
  id: string
  name: string
  practiceName: string | null
} & Record<string, unknown>) {
  // Resumable: an interrupted run already created this.
  let practice = await prisma.practice.findFirst({
    where: { orgId: org.id, isDefault: true, archivedAt: null },
    select: { id: true, name: true },
  })

  if (!practice) {
    const identity = Object.fromEntries(
      IDENTITY_FIELDS.map(f => [f, (org[f] as string | null) ?? null]),
    )
    if (DRY_RUN) {
      console.log(`  would create default practice "${defaultLabel(org)}"`)
      // No practice id to point at, but the counts below are the whole reason
      // to dry-run, so they are still taken. moveAll only counts in this mode
      // and never reads the id it is handed.
      return { created: true, ...(await moveCounts(org.id)) }
    }
    practice = await prisma.practice.create({
      data: {
        orgId: org.id,
        name: defaultLabel(org),
        isDefault: true,
        // Copied, not moved. The twelve stay on Organization as a fallback for
        // one release — see lib/practices/identity.ts.
        ...identity,
      },
      select: { id: true, name: true },
    })
    console.log(`  created default practice "${practice.name}"`)
  }

  const practiceId = practice.id

  // Batches first, then rows and claims. The order matters only if this is
  // interrupted: a batch pointing at a practice whose rows do not yet is a
  // state the app reads correctly, because the row's own column is what every
  // query filters on.
  const batches = await moveAll('importBatch', org.id, practiceId)
  const rows = await moveAll('denialRow', org.id, practiceId)
  const claims = await moveAll('orgClaim', org.id, practiceId)

  return { created: false, batches, rows, claims }
}

/** What a run would file, for the workspace that has no practice yet. */
async function moveCounts(orgId: string) {
  return {
    batches: await moveAll('importBatch', orgId, ''),
    rows: await moveAll('denialRow', orgId, ''),
    claims: await moveAll('orgClaim', orgId, ''),
  }
}

/**
 * Point every unfiled record at the practice, a chunk at a time.
 *
 * `practiceId: null` in the filter is what makes this resumable AND makes it
 * safe against a workspace that has already started filing imports under a
 * second practice: a row someone deliberately assigned is never reassigned here.
 */
async function moveAll(
  model: 'importBatch' | 'denialRow' | 'orgClaim',
  orgId: string,
  practiceId: string,
): Promise<number> {
  const where = { orgId, practiceId: null }

  if (DRY_RUN) {
    // @ts-expect-error - three models, one shape; narrowing each is noise.
    return prisma[model].count({ where })
  }

  let moved = 0
  for (;;) {
    // @ts-expect-error - see above.
    const batch: Array<{ id: string }> = await prisma[model].findMany({
      where,
      select: { id: true },
      take: CHUNK,
    })
    if (batch.length === 0) break

    // @ts-expect-error - see above.
    const result = await prisma[model].updateMany({
      // Re-filtered on practiceId: null, not just on the ids. Two copies of
      // this script running at once then cannot double-count, and neither can
      // overwrite an assignment the other just made.
      where: { ...where, id: { in: batch.map(r => r.id) } },
      data: { practiceId },
    })
    moved += result.count

    // A page that moved nothing means every id in it was claimed by something
    // else between the read and the write. Without this the loop would spin.
    if (result.count === 0) break
  }
  return moved
}

async function main() {
  if (DRY_RUN) console.log('DRY RUN — nothing will be written\n')

  const orgs = await prisma.organization.findMany({
    select: {
      id: true,
      name: true,
      ...Object.fromEntries(IDENTITY_FIELDS.map(f => [f, true])),
    },
    orderBy: { createdAt: 'asc' },
  })

  console.log(`${orgs.length} workspace(s)\n`)

  const totals = { batches: 0, rows: 0, claims: 0 }
  for (const org of orgs) {
    console.log(`${org.name} (${org.id})`)
    const r = await backfillOrg(org as never)
    totals.batches += r.batches
    totals.rows += r.rows
    totals.claims += r.claims
    console.log(`  ${r.batches} batches · ${r.rows} denial rows · ${r.claims} claims`)
  }

  console.log(
    `\n${DRY_RUN ? 'Would file' : 'Filed'}: ` +
      `${totals.batches} batches, ${totals.rows} rows, ${totals.claims} claims.`,
  )
}

main()
  .catch(e => {
    // Loud and non-zero: this runs by hand, and a half-finished backfill that
    // reported success is one nobody re-runs.
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())

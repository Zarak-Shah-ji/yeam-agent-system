/**
 * Pull a pool of denied encounters into a recent date window.
 *
 * The imported Medicaid dataset is dated 2024, which reads as stale on the
 * shared /appeals review portal — every letter cited a date of service nearly
 * two years old. This moves a working pool of denied encounters into the last
 * 90 days so seeded letters reference current dates.
 *
 * Only `encounterDate` on denied encounters is touched, and only for the pool
 * the showcase seed draws from. Deterministic per row id, so re-running is
 * stable and idempotent.
 *
 *   pnpm db:refresh-dates            # default pool of 40
 *   pnpm db:refresh-dates --pool 80
 */
import { createHash } from 'node:crypto'
import { prisma } from '../lib/db'

/** Keep every date of service inside this many days of today. */
const WINDOW_DAYS = 90

/**
 * Denial codes that contradict a recent date of service. A timely-filing denial
 * on a two-week-old claim is not credible, so those encounters stay out of the
 * recent pool rather than surfacing in the showcase.
 */
const TIME_DEPENDENT_CODES = new Set(['CO-29'])
/** Leave a few days of margin so nothing lands in the future. */
const MIN_AGE_DAYS = 4

const DAY_MS = 24 * 60 * 60 * 1000

function poolSize(): number {
  const i = process.argv.indexOf('--pool')
  const n = i === -1 ? NaN : Number(process.argv[i + 1])
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 40
}

/** Stable offset in [MIN_AGE_DAYS, WINDOW_DAYS] derived from the row id. */
function daysAgoFor(id: string): number {
  const digest = createHash('sha256').update(id).digest()
  const span = WINDOW_DAYS - MIN_AGE_DAYS
  return MIN_AGE_DAYS + (digest.readUInt32BE(0) % span)
}

async function main() {
  const size = poolSize()
  const cutoff = new Date(Date.now() - WINDOW_DAYS * DAY_MS)

  // Prefer encounters that are complete enough to produce a good letter.
  const candidates = await prisma.medicaidEncounter.findMany({
    where: { claimStatus: 'denied', denialReason: { not: null }, procCode: { not: '' } },
    select: { id: true, encounterDate: true, denialCode: true, diagnosisCodes: true },
    orderBy: { encounterDate: 'desc' },
    take: size * 6,
  })

  // Spread across denial codes so the showcase shows varied reasons.
  const seen = new Map<string, number>()
  const pool: typeof candidates = []
  for (const enc of candidates) {
    if (pool.length >= size) break
    if (enc.diagnosisCodes.length === 0) continue
    if (enc.denialCode && TIME_DEPENDENT_CODES.has(enc.denialCode)) continue
    const code = enc.denialCode ?? 'unknown'
    const used = seen.get(code) ?? 0
    if (used >= Math.ceil(size / 8)) continue
    seen.set(code, used + 1)
    pool.push(enc)
  }

  const stale = pool.filter(e => e.encounterDate < cutoff)
  if (stale.length === 0) {
    console.log(`All ${pool.length} pooled encounters are already within ${WINDOW_DAYS} days. Nothing to do.`)
    return
  }

  console.log(`Moving ${stale.length} of ${pool.length} pooled encounter(s) into the last ${WINDOW_DAYS} days...`)

  let updated = 0
  for (const enc of stale) {
    const daysAgo = daysAgoFor(enc.id)
    const next = new Date(Date.now() - daysAgo * DAY_MS)
    // Preserve the original time of day so dates don't all share a timestamp.
    next.setHours(enc.encounterDate.getHours(), enc.encounterDate.getMinutes(), 0, 0)
    await prisma.medicaidEncounter.update({
      where: { id: enc.id },
      data: { encounterDate: next },
    })
    updated++
  }

  const fresh = await prisma.medicaidEncounter.findMany({
    where: { claimStatus: 'denied', encounterDate: { gte: cutoff } },
    select: { encounterDate: true },
    orderBy: { encounterDate: 'desc' },
    take: 1,
  })

  console.log(`\nDone. ${updated} encounter(s) updated.`)
  console.log(`Newest denied date of service is now ${fresh[0]?.encounterDate.toDateString() ?? 'n/a'}.`)
}

main()
  .catch(err => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())

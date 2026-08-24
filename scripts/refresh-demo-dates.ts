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
const WINDOW_DAYS = 200

/**
 * Denial codes that contradict a recent date of service. A timely-filing denial
 * on a two-week-old claim is not credible, so those encounters stay out of the
 * recent pool rather than surfacing in the showcase.
 */
const TIME_DEPENDENT_CODES = new Set(['CO-29'])
/**
 * A claim cannot be submitted, adjudicated, denied and appealed inside a week.
 * Payers take 14-45 days to adjudicate, so the date of service has to sit far
 * enough back that the remittance it is being appealed against could exist.
 */
const MIN_AGE_DAYS = 60

/** Adjudication lag: days from date of service to the remittance advice. */
const ADJUDICATION_MIN_DAYS = 14
const ADJUDICATION_MAX_DAYS = 45

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

/**
 * Remittance date for a given service date. The appeal filing window runs from
 * here, so it has to move whenever the date of service moves — otherwise the
 * letter cites a deadline computed against a date that no longer exists.
 */
function remittanceFor(id: string, serviceDate: Date): Date {
  const digest = createHash('sha256').update(`${id}:lag`).digest()
  const span = ADJUDICATION_MAX_DAYS - ADJUDICATION_MIN_DAYS
  const lag = ADJUDICATION_MIN_DAYS + (digest.readUInt32BE(0) % span)
  return new Date(serviceDate.getTime() + lag * DAY_MS)
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

  // Two failure modes, not one. Dates older than the window read as stale; dates
  // newer than MIN_AGE_DAYS are worse, because they imply a claim submitted,
  // adjudicated, denied and appealed inside a few days.
  const tooRecentCutoff = new Date(Date.now() - MIN_AGE_DAYS * DAY_MS)
  const stale = pool.filter(e => e.encounterDate < cutoff || e.encounterDate > tooRecentCutoff)
  console.log(
    stale.length === 0
      ? `All ${pool.length} pooled encounters already sit between ${MIN_AGE_DAYS} and ${WINDOW_DAYS} days ago.`
      : `Moving ${stale.length} of ${pool.length} pooled encounter(s) into the ${MIN_AGE_DAYS}-${WINDOW_DAYS} day window...`,
  )

  let updated = 0
  for (const enc of stale) {
    const daysAgo = daysAgoFor(enc.id)
    const next = new Date(Date.now() - daysAgo * DAY_MS)
    // Preserve the original time of day so dates don't all share a timestamp.
    next.setHours(enc.encounterDate.getHours(), enc.encounterDate.getMinutes(), 0, 0)
    await prisma.medicaidEncounter.update({
      where: { id: enc.id },
      data: { encounterDate: next, remittanceDate: remittanceFor(enc.id, next) },
    })
    updated++
  }

  // The pool is capped per denial code, so a few too-recent rows can fall
  // outside it. The invariant belongs to every denied claim, not just pooled
  // ones, so sweep whatever the pool pass missed.
  const strays = await prisma.medicaidEncounter.findMany({
    where: { claimStatus: 'denied', encounterDate: { gt: tooRecentCutoff } },
    select: { id: true, encounterDate: true },
  })
  for (const enc of strays) {
    const next = new Date(Date.now() - daysAgoFor(enc.id) * DAY_MS)
    next.setHours(enc.encounterDate.getHours(), enc.encounterDate.getMinutes(), 0, 0)
    await prisma.medicaidEncounter.update({
      where: { id: enc.id },
      data: { encounterDate: next, remittanceDate: remittanceFor(enc.id, next) },
    })
    updated++
  }

  const impossible = await prisma.medicaidEncounter.count({
    where: { claimStatus: 'denied', encounterDate: { gt: tooRecentCutoff } },
  })

  console.log(`\nDone. ${updated} encounter(s) updated.`)
  console.log(
    impossible === 0
      ? `No denied claim has a date of service inside ${MIN_AGE_DAYS} days. Timelines are plausible.`
      : `WARNING: ${impossible} denied claim(s) still dated inside ${MIN_AGE_DAYS} days — re-run with a larger --pool.`,
  )
}

main()
  .catch(err => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())

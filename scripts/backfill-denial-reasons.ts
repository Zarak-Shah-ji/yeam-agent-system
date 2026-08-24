/**
 * Backfill realistic CARC/RARC denial reasons onto denied MedicaidEncounter rows.
 *
 * The Medicaid dataset carries `claimStatus = 'denied'` but no reason, so every
 * appeal letter used to render the "[DENIAL REASON — SEE ATTACHED EOB/ERA]"
 * placeholder. Assignment is deterministic (hash of the encounter id), so
 * re-running produces identical results and the script is safe to repeat.
 *
 *   pnpm db:backfill-denials          # only rows missing a denial reason
 *   pnpm db:backfill-denials --force  # rewrite every denied row
 */
import { createHash } from 'node:crypto'
import { prisma } from '../lib/db'

interface DenialReason {
  code: string
  reason: string
}

/** Real CARC/RARC pairs, weighted toward what actually shows up on Medicaid EOBs. */
const DENIAL_REASONS: DenialReason[] = [
  { code: 'CO-16', reason: 'Claim/service lacks information or has submission/billing error(s). Missing or invalid referring provider NPI.' },
  { code: 'CO-50', reason: 'These are non-covered services because this is not deemed a medical necessity by the payer.' },
  { code: 'CO-97', reason: 'The benefit for this service is included in the payment/allowance for another service already adjudicated.' },
  { code: 'CO-11', reason: 'The diagnosis is inconsistent with the procedure code billed.' },
  { code: 'CO-197', reason: 'Precertification/authorization/notification absent for this service.' },
  { code: 'CO-29', reason: 'The time limit for filing has expired.' },
  { code: 'CO-18', reason: 'Exact duplicate claim/service.' },
  { code: 'CO-151', reason: 'Payment adjusted because the payer deems the information submitted does not support this many/frequency of services.' },
  { code: 'PR-204', reason: 'This service/equipment/drug is not covered under the patient’s current benefit plan.' },
  { code: 'CO-45', reason: 'Charge exceeds fee schedule/maximum allowable or contracted/legislated fee arrangement.' },
]

/** Stable index in [0, len) derived from the row id — same input, same reason, always. */
function pickFor(id: string): DenialReason {
  const digest = createHash('sha256').update(id).digest()
  return DENIAL_REASONS[digest.readUInt32BE(0) % DENIAL_REASONS.length]
}

async function main() {
  const force = process.argv.includes('--force')

  const targets = await prisma.medicaidEncounter.findMany({
    where: {
      claimStatus: 'denied',
      ...(force ? {} : { denialReason: null }),
    },
    select: { id: true },
  })

  if (targets.length === 0) {
    console.log('Nothing to backfill — every denied encounter already has a denial reason.')
    console.log('Re-run with --force to rewrite them.')
    return
  }

  console.log(`Backfilling ${targets.length} denied encounter(s)${force ? ' (forced)' : ''}...`)

  // Group by assigned reason so this is ~10 updateMany calls instead of thousands
  // of individual updates — the dataset has a few thousand denied rows.
  const buckets = new Map<string, { reason: DenialReason; ids: string[] }>()
  for (const { id } of targets) {
    const reason = pickFor(id)
    const bucket = buckets.get(reason.code)
    if (bucket) bucket.ids.push(id)
    else buckets.set(reason.code, { reason, ids: [id] })
  }

  let updated = 0
  for (const { reason, ids } of buckets.values()) {
    const result = await prisma.medicaidEncounter.updateMany({
      where: { id: { in: ids } },
      data: { denialCode: reason.code, denialReason: reason.reason },
    })
    updated += result.count
    console.log(`  ${reason.code.padEnd(7)} → ${result.count} encounter(s)`)
  }

  console.log(`\nDone. ${updated} encounter(s) updated.`)
}

main()
  .catch(err => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())

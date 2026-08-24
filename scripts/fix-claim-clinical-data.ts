/**
 * Repair the clinical and financial data behind appeal letters.
 *
 * The imported dataset carries procedure codes but no diagnoses, no payer, and
 * no submitted charge, so earlier loaders filled those gaps with defaults that
 * do not survive expert review:
 *
 *   - Diagnoses fell back to Z00.00 ("Encounter for general adult medical
 *     examination") for any procedure outside a 60-code map — which meant 85%
 *     of denied claims cited a routine physical against attendant care,
 *     personal care and retroperitoneal ultrasound.
 *   - Every patient carried insuranceType 'Medicaid' and every appeal letter
 *     was addressed to the same payer.
 *   - There was no billed amount at all, so no letter could state the sum in
 *     dispute.
 *   - Dates of service sat days before the letter date, implying a claim
 *     submitted, adjudicated, denied and appealed inside a week.
 *
 * Every write is deterministic in the row id, so re-running is idempotent and
 * produces identical data across environments.
 *
 *   pnpm db:fix-clinical             # denied claims only (what the portal shows)
 *   pnpm db:fix-clinical --all       # every encounter
 *   pnpm db:fix-clinical --dry-run
 */
import { createHash } from 'node:crypto'
import { prisma } from '../lib/db'
import { diagnosesFor, PROCEDURES } from '../lib/billing/procedure-codes'
import { memberIdFor, payerForSeed } from '../lib/billing/payers'

const DAY_MS = 86_400_000
const BATCH = 500

/** Stable pseudo-random float in [0,1) from any seed. */
function rand(seed: string): number {
  return createHash('sha256').update(seed).digest().readUInt32BE(0) / 0x1_0000_0000
}

/**
 * Payers adjudicate in 14–45 days. The remittance date has to sit that far
 * after the service date, and the appeal is written after the remittance —
 * otherwise the timeline on the letter is impossible.
 */
function remittanceDateFor(id: string, serviceDate: Date): Date {
  const lagDays = 14 + Math.floor(rand(`${id}:lag`) * 32)
  return new Date(serviceDate.getTime() + lagDays * DAY_MS)
}

/**
 * Submitted charge. Providers bill above the Medicaid allowable, typically
 * 1.5–2.6x, and the dataset's avgCostTx is a reasonable proxy for the allowable.
 */
function billedAmountFor(id: string, allowable: number, units: number): number {
  const markup = 1.5 + rand(`${id}:markup`) * 1.1
  return Math.round(allowable * units * markup * 100) / 100
}

/** LTSS codes bill in 15-minute units; most everything else is a single unit. */
function unitsFor(id: string, procCode: string): number {
  if (!/^[ST]\d{4}$/.test(procCode)) return 1
  return 4 + Math.floor(rand(`${id}:units`) * 13) // 1–4 hours of care
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const all = process.argv.includes('--all')

  console.log(`Repairing ${all ? 'ALL' : 'denied'} encounters${dryRun ? ' (dry run)' : ''}\n`)

  // ── 1. Procedure descriptions ─────────────────────────────────────────────
  // hcpcs_codes.description is null for all 4,588 rows, so letters could not
  // name the service they were appealing.
  let described = 0
  for (const [code, profile] of Object.entries(PROCEDURES)) {
    if (dryRun) { described++; continue }
    const res = await prisma.hcpcsCode.updateMany({
      where: { code, description: null },
      data: { description: profile.description },
    })
    described += res.count
  }
  console.log(`  procedure descriptions filled: ${described}`)

  // ── 2. Payer assignment ───────────────────────────────────────────────────
  // A patient has one plan, and their claims inherit it — so the payer lives on
  // the patient, keyed into the directory in lib/billing/payers.ts.
  const patients = await prisma.medicaidPatient.findMany({ select: { id: true, mrn: true } })
  let assigned = 0
  for (let i = 0; i < patients.length; i += BATCH) {
    const slice = patients.slice(i, i + BATCH)
    if (dryRun) { assigned += slice.length; continue }
    await prisma.$transaction(
      slice.map(p => {
        const payer = payerForSeed(p.id)
        return prisma.medicaidPatient.update({
          where: { id: p.id },
          data: {
            payerKey: payer.key,
            insuranceType: payer.name,
            insuranceId: memberIdFor(payer, p.id),
          },
        })
      }),
    )
    assigned += slice.length
    process.stdout.write(`\r  payers assigned: ${assigned}/${patients.length}`)
  }
  console.log(`\r  payers assigned: ${assigned}/${patients.length}          `)

  // ── 3. Diagnoses, charges and remittance dates ────────────────────────────
  const where = all ? {} : { claimStatus: 'denied' }
  const encounters = await prisma.medicaidEncounter.findMany({
    where,
    select: { id: true, procCode: true, encounterDate: true },
  })

  // One lookup for every allowable we need, rather than a query per encounter.
  const codes = [...new Set(encounters.map(e => e.procCode))]
  const costs = new Map<string, number>()
  for (const row of await prisma.hcpcsCode.findMany({
    where: { code: { in: codes } },
    select: { code: true, avgCostTx: true },
  })) {
    costs.set(row.code, row.avgCostTx?.toNumber() ?? 45)
  }

  let fixed = 0
  let stillRoutine = 0
  for (let i = 0; i < encounters.length; i += BATCH) {
    const slice = encounters.slice(i, i + BATCH)
    const updates = slice.map(e => {
      const diagnosisCodes = diagnosesFor(e.procCode, e.id)
      const units = unitsFor(e.id, e.procCode)
      const allowable = costs.get(e.procCode) ?? 45
      if (diagnosisCodes.some(d => d.startsWith('Z00.'))) stillRoutine++
      return {
        id: e.id,
        diagnosisCodes,
        billedAmount: billedAmountFor(e.id, allowable, units),
        remittanceDate: remittanceDateFor(e.id, e.encounterDate),
      }
    })

    if (!dryRun) {
      await prisma.$transaction(
        updates.map(u =>
          prisma.medicaidEncounter.update({
            where: { id: u.id },
            data: {
              diagnosisCodes: u.diagnosisCodes,
              billedAmount: u.billedAmount,
              remittanceDate: u.remittanceDate,
            },
          }),
        ),
      )
    }
    fixed += slice.length
    process.stdout.write(`\r  encounters repaired: ${fixed}/${encounters.length}`)
  }
  console.log(`\r  encounters repaired: ${fixed}/${encounters.length}          `)
  console.log(
    `  citing a Z00.* routine-exam code: ${stillRoutine}` +
      ` (expected only against preventive procedures)`,
  )

  if (dryRun) console.log('\nDry run — nothing written.')
}

main()
  .catch(err => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())

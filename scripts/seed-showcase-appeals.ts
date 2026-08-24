/**
 * Generate a handful of real appeal letters so the /appeals review portal has
 * something to show.
 *
 * Letters live in `agent_logs` (BaseAgent persists every completed agent event
 * there), which is what the portal reads. A fresh database — production, for
 * instance — has none, so this drafts a few genuine ones through the same
 * BillingAgent path the in-app "AI Appeal" button uses.
 *
 *   pnpm db:seed-appeals            # no-op if enough letters already exist
 *   pnpm db:seed-appeals --force    # draft another batch regardless
 *   pnpm db:seed-appeals --replace  # delete prior showcase letters, then redraft
 *
 * This step depends on the claim data being repaired first — letters are only as
 * credible as the codes, payers and amounts behind them. Run the whole pipeline
 * with `pnpm db:rebuild-appeals`, which chains:
 *
 *   db:backfill-denials → db:fix-clinical → db:refresh-dates → db:seed-appeals
 */
import { prisma } from '../lib/db'
import { GEMINI_AVAILABLE } from '../lib/agents/gemini-client'
import { dispatch } from '../lib/agents/orchestrator'
import { listShowcaseAppeals, PORTAL_SESSION } from '../lib/billing/showcase-appeals'
import { getPayer, resolveAppealWindow } from '../lib/billing/payers'

const TARGET_COUNT = 8

/**
 * Claims below this are not worth a billing manager's time to appeal, and a
 * showcase letter arguing over $1.03 of venipuncture undercuts the whole demo.
 */
const MIN_BILLED_AMOUNT = 60

/** A timely-filing denial contradicts a recent date of service — skip it. */
const SKIP_CODES = new Set(['CO-29'])
/** Gemini returns transient 503s under load; a couple of backed-off retries clears them. */
async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 4): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      const message = err instanceof Error ? err.message : String(err)
      const transient = /503|429|high demand|overloaded|timeout|ECONNRESET/i.test(message)
      if (!transient || i === attempts - 1) throw err
      const delay = 2000 * 2 ** i
      process.stdout.write(`retry ${i + 1}/${attempts - 1} in ${delay / 1000}s ... `)
      await new Promise(r => setTimeout(r, delay))
    }
  }
  throw lastErr
}


async function main() {
  const replace = process.argv.includes('--replace')
  const force = replace || process.argv.includes('--force')

  // Letters drafted before a prompt or data fix stay visible on the portal and
  // sit alongside the corrected ones, so a rebuild has to clear them out.
  if (replace) {
    const { count } = await prisma.agentLog.deleteMany({
      where: { agentName: 'BILLING', status: 'COMPLETE', NOT: { sessionId: PORTAL_SESSION } },
    })
    console.log(`Removed ${count} previously seeded billing log(s).\n`)
  }

  if (!GEMINI_AVAILABLE) {
    console.error('GEMINI_API_KEY is not set — letters would be stub text. Aborting.')
    process.exitCode = 1
    return
  }

  const existing = await listShowcaseAppeals(TARGET_COUNT)
  if (existing.length >= TARGET_COUNT && !force) {
    console.log(`${existing.length} showcase appeal letter(s) already present. Nothing to do.`)
    console.log('Re-run with --force to draft another batch.')
    return
  }

  const needed = force ? TARGET_COUNT : TARGET_COUNT - existing.length

  // Pick denied encounters that carry everything a good letter needs. Spreading
  // across distinct denial codes makes the showcase read as a varied set rather
  // than six near-identical letters.
  const candidates = await prisma.medicaidEncounter.findMany({
    where: {
      claimStatus: 'denied',
      denialReason: { not: null },
      procCode: { not: '' },
      remittanceDate: { not: null },
      billedAmount: { gte: MIN_BILLED_AMOUNT },
    },
    include: { patient: true },
    orderBy: { encounterDate: 'desc' },
    take: 400,
  })

  /**
   * Still inside the filing window — an expired appeal is not a demo. Checks
   * both clocks: the window from the remittance AND the Medicaid 24-month
   * ceiling from the date of service, whichever binds first.
   */
  const filable = candidates.filter(enc => {
    const payer = getPayer(enc.patient.payerKey)
    if (!payer || !enc.remittanceDate) return false
    const w = resolveAppealWindow(payer, enc.remittanceDate, enc.encounterDate)
    return w.deadline.getTime() > Date.now()
  })

  // Spread across BOTH denial code and payer. Varying only the denial code
  // still produced eight letters addressed to the same payer, which is what
  // made the set read as one template with the details swapped.
  const seenCodes = new Set<string>()
  const payerCounts = new Map<string, number>()
  const maxPerPayer = Math.max(1, Math.ceil(needed / 3))
  const picked: typeof candidates = []

  for (const enc of filable) {
    if (picked.length >= needed) break
    const code = enc.denialCode ?? 'unknown'
    const payerKey = enc.patient.payerKey ?? 'unknown'
    if (seenCodes.has(code)) continue
    if (SKIP_CODES.has(code)) continue
    if (enc.diagnosisCodes.length === 0) continue
    if ((payerCounts.get(payerKey) ?? 0) >= maxPerPayer) continue
    seenCodes.add(code)
    payerCounts.set(payerKey, (payerCounts.get(payerKey) ?? 0) + 1)
    picked.push(enc)
  }
  // If distinct codes ran out, top up with whatever else qualifies.
  for (const enc of filable) {
    if (picked.length >= needed) break
    if (picked.some(p => p.id === enc.id)) continue
    if (enc.denialCode && SKIP_CODES.has(enc.denialCode)) continue
    if (enc.diagnosisCodes.length === 0) continue
    picked.push(enc)
  }

  if (picked.length === 0) {
    console.error('No filable denied encounters found.')
    console.error('Run `pnpm db:backfill-denials`, `pnpm db:fix-clinical`, then `pnpm db:refresh-dates`.')
    process.exitCode = 1
    return
  }

  console.log(`Drafting ${picked.length} appeal letter(s)...\n`)

  let ok = 0
  for (const enc of picked) {
    const claimNumber = 'ENC-' + enc.id.slice(0, 8).toUpperCase()
    const patientName = [enc.patient.firstName, enc.patient.lastName].filter(Boolean).join(' ')
    const payer = getPayer(enc.patient.payerKey)
    process.stdout.write(
      `  ${claimNumber} ${(enc.denialCode ?? '?').padEnd(7)} ${(payer?.shortName ?? '?').padEnd(12)} $${String(enc.billedAmount ?? 0).padStart(8)}  ${patientName} ... `,
    )

    try {
      // Go through the orchestrator so BaseAgent's logging writes the AgentLog
      // row exactly as a dashboard-initiated appeal would.
      const letter = await withRetry(claimNumber, async () => {
        const events = await dispatch(
          'draft-appeal',
          { claimId: enc.id },
          '',
          'appeals-showcase-seed',
        )

        let drafted: string | null = null
        for await (const event of events) {
          const data = event.data as { appealLetter?: string } | undefined
          if (event.status === 'complete' && typeof data?.appealLetter === 'string') {
            drafted = data.appealLetter
          }
          if (event.status === 'error') throw new Error(event.message)
        }

        if (!drafted) throw new Error('no letter returned')
        return drafted
      })
      console.log(`ok (${letter.length} chars)`)
      ok++
    } catch (err) {
      console.log(`FAILED — ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // AgentLog writes are fire-and-forget inside BaseAgent; give them a moment
  // to land before the process disconnects the Prisma client.
  await new Promise(r => setTimeout(r, 1500))

  const total = await listShowcaseAppeals(20)
  console.log(`\nDrafted ${ok}/${picked.length}. The portal now has ${total.length} letter(s) available.`)
}

main()
  .catch(err => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())

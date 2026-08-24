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
 */
import { prisma } from '../lib/db'
import { GEMINI_AVAILABLE } from '../lib/agents/gemini-client'
import { dispatch } from '../lib/agents/orchestrator'
import { listShowcaseAppeals } from '../lib/billing/showcase-appeals'

const TARGET_COUNT = 6
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
  const force = process.argv.includes('--force')

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
    },
    include: { patient: true },
    orderBy: { encounterDate: 'desc' },
    take: 200,
  })

  const seenCodes = new Set<string>()
  const picked: typeof candidates = []
  for (const enc of candidates) {
    if (picked.length >= needed) break
    const code = enc.denialCode ?? 'unknown'
    if (seenCodes.has(code)) continue
    if (enc.diagnosisCodes.length === 0) continue
    seenCodes.add(code)
    picked.push(enc)
  }
  // If distinct codes ran out, top up with whatever else qualifies.
  for (const enc of candidates) {
    if (picked.length >= needed) break
    if (picked.some(p => p.id === enc.id)) continue
    if (enc.diagnosisCodes.length === 0) continue
    picked.push(enc)
  }

  if (picked.length === 0) {
    console.error('No denied encounters with a denial reason found.')
    console.error('Run `pnpm db:backfill-denials` first.')
    process.exitCode = 1
    return
  }

  console.log(`Drafting ${picked.length} appeal letter(s)...\n`)

  let ok = 0
  for (const enc of picked) {
    const claimNumber = 'ENC-' + enc.id.slice(0, 8).toUpperCase()
    const patientName = [enc.patient.firstName, enc.patient.lastName].filter(Boolean).join(' ')
    process.stdout.write(`  ${claimNumber} (${enc.denialCode}) ${patientName} ... `)

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

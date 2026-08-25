import Image from 'next/image'
import Link from 'next/link'
import { hasAppealsAccess, isAppealsPortalConfigured } from '@/lib/appeals/access'
import { PasscodeGate } from '@/components/appeals/PasscodeGate'

/**
 * The integration architecture, as a diagram rather than prose.
 *
 * Shares the /appeals passcode. Status colours are load-bearing: a reader who
 * works denials will click anything marked live, so nothing is marked live
 * unless it works today.
 *
 * Columns are vertically centred against each other — the stages hold 4, 1, 1,
 * 2 and 3 nodes, and top-aligning them reads as ragged rather than as a flow.
 */

type Status = 'live' | 'building' | 'roadmap'

const DOT: Record<Status, string> = {
  live: 'bg-emerald-500',
  building: 'bg-amber-500',
  roadmap: 'bg-slate-400',
}

const RING: Record<Status, string> = {
  live: 'border-emerald-200 bg-emerald-50',
  building: 'border-amber-200 bg-amber-50',
  roadmap: 'border-slate-200 bg-slate-50',
}

const SOURCES: { label: string; sub: string; status: Status }[] = [
  { label: 'Denial letter / EOB', sub: 'PDF · image · Word', status: 'live' },
  { label: 'Claims export', sub: 'CSV · XLSX', status: 'live' },
  { label: '835 ERA', sub: 'clearinghouse', status: 'building' },
  { label: 'Chart notes', sub: 'EHR · FHIR R4', status: 'roadmap' },
]

const ENGINE: { label: string; sub: string; status: Status }[] = [
  { label: 'Denial playbook', sub: 'picks the remedy', status: 'live' },
  { label: 'Payer profile', sub: 'window · channel · form', status: 'live' },
]

const OUTPUTS: { label: string; sub: string; status: Status }[] = [
  { label: 'Corrected claim', sub: 'CO-11 · CO-16 · CO-18', status: 'live' },
  { label: 'Appeal letter', sub: 'CO-50 · CO-97 · CO-151 · CO-197 · CO-29', status: 'live' },
  { label: 'Reprocessing request', sub: 'CO-45 · PR-204', status: 'live' },
]

function Node({ label, sub, status }: { label: string; sub: string; status: Status }) {
  return (
    <div className={`rounded-lg border px-4 py-3 shadow-sm ${RING[status]}`}>
      <div className="flex items-start gap-2">
        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[status]}`} />
        <span className="text-[15px] font-semibold leading-snug text-gray-900">{label}</span>
      </div>
      <p className="mt-1 pl-4 text-xs leading-relaxed text-gray-600">{sub}</p>
    </div>
  )
}

function Arrow() {
  return (
    <div
      aria-hidden
      className="flex shrink-0 items-center justify-center py-1 text-2xl leading-none text-gray-300 md:py-0"
    >
      <span className="md:hidden">↓</span>
      <span className="hidden md:inline">→</span>
    </div>
  )
}

function Stage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 flex-1">
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400">
        {title}
      </p>
      <div className="space-y-2.5">{children}</div>
    </div>
  )
}

export default async function HowWeConnectPage() {
  if (!(await hasAppealsAccess())) {
    return <PasscodeGate configured={isAppealsPortalConfigured()} />
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-[linear-gradient(165deg,#143A66_0%,#0E2748_58%,#091B34_100%)]">
        <div className="mx-auto max-w-[1400px] px-6 py-10 sm:px-10">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white shadow-lg shadow-black/20 ring-1 ring-white/10">
              <Image src="/logo.png" alt="Yeam" width={30} height={30} className="h-8 w-8 object-contain" />
            </div>
            <div>
              <p className="text-lg font-semibold tracking-tight text-white">Yeam</p>
              <p className="text-sm text-slate-300">Architecture</p>
            </div>
          </div>
          <h1 className="mt-6 text-3xl font-semibold tracking-tight text-white">How Yeam connects</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-300">
            Denials arrive as 835s from the clearinghouse, not from the EHR. One connection
            there covers every practice, whatever each one runs.
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-6 py-10 sm:px-10">
        <section className="overflow-x-auto rounded-xl border border-gray-200 bg-white px-6 py-8 shadow-sm sm:px-8">
          <div className="flex min-w-[280px] flex-col gap-3 md:flex-row md:items-center md:gap-5">
            <Stage title="Source">
              {SOURCES.map(s => (
                <Node key={s.label} {...s} />
              ))}
            </Stage>

            <Arrow />

            <Stage title="Adapter">
              <Node label="Field mapping" sub="one config per source — a new EHR is a mapping file, not a new integration" status="building" />
            </Stage>

            <Arrow />

            <Stage title="Normalized claim">
              <Node label="Claim record" sub="payer · CARC · amounts · dates — everything downstream reads this shape only" status="building" />
            </Stage>

            <Arrow />

            <Stage title="Engine">
              {ENGINE.map(e => (
                <Node key={e.label} {...e} />
              ))}
            </Stage>

            <Arrow />

            <Stage title="Output">
              {OUTPUTS.map(o => (
                <Node key={o.label} {...o} />
              ))}
            </Stage>
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-gray-100 pt-5 text-xs text-gray-600">
            {(['live', 'building', 'roadmap'] as Status[]).map(s => (
              <span key={s} className="flex items-center gap-1.5">
                <span className={`h-2 w-2 rounded-full ${DOT[s]}`} />
                {s === 'live' ? 'Live today' : s === 'building' ? 'Building' : 'Roadmap'}
              </span>
            ))}
          </div>
        </section>

        <section className="mt-6 grid gap-4 sm:grid-cols-3">
          {[
            ['Not multi-tenant yet', 'One practice per deployment. First thing to change for a billing company.'],
            ['No BAA', 'Synthetic data only. Real PHI needs BAAs signed first.'],
            ['Engine is the mature part', 'Payer rules and playbooks are worked over. Ingestion is younger.'],
          ].map(([title, body]) => (
            <div key={title} className="rounded-xl border border-gray-200 bg-white px-5 py-4 shadow-sm">
              <p className="text-sm font-semibold text-gray-900">{title}</p>
              <p className="mt-1 text-xs leading-relaxed text-gray-600">{body}</p>
            </div>
          ))}
        </section>

        <p className="mt-8 text-sm text-gray-600">
          The output routing above is live — see it on the{' '}
          <Link href="/appeals" className="font-medium text-blue-600 underline hover:text-blue-700">
            appeal review page
          </Link>
          .
        </p>

        <footer className="mt-8 border-t border-gray-200 pt-5 text-xs text-gray-500">
          Demonstration environment. Synthetic data only, no BAA in place.
        </footer>
      </main>
    </div>
  )
}

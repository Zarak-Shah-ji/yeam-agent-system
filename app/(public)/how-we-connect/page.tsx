import Image from 'next/image'
import Link from 'next/link'
import { hasAppealsAccess, isAppealsPortalConfigured } from '@/lib/appeals/access'
import { PasscodeGate } from '@/components/appeals/PasscodeGate'

/**
 * The integration story, written for a billing company evaluating Yeam.
 *
 * Shares the /appeals passcode so one code covers both pages. Every status
 * label on this page is deliberate: a reader who works denials for a living
 * will test anything marked "live", so nothing is marked live unless they can
 * click it today.
 */

type Status = 'live' | 'building' | 'roadmap'

const STATUS_STYLES: Record<Status, { label: string; className: string }> = {
  live: { label: 'Live today', className: 'bg-emerald-100 text-emerald-800 ring-emerald-200' },
  building: { label: 'Building now', className: 'bg-amber-100 text-amber-900 ring-amber-200' },
  roadmap: { label: 'Roadmap', className: 'bg-slate-100 text-slate-700 ring-slate-200' },
}

const TIERS: {
  tier: string
  name: string
  status: Status
  summary: string
  detail: string
  needs: string
}[] = [
  {
    tier: '0',
    name: 'Documents',
    status: 'live',
    summary: 'Send us the denial in whatever form you already have it.',
    detail:
      'An EOB, an ERA, a payer denial letter, a claims export, a photo of a page — PDF, image, Excel, CSV or Word. Yeam reads it and drafts the right response. This is EHR-agnostic by construction: it never touches the EHR, so it works identically whether the practice runs eClinicalWorks, Athena, Tebra or paper.',
    needs: 'Nothing. No integration, no IT project, no access to the practice system.',
  },
  {
    tier: '1',
    name: 'File and export feed',
    status: 'building',
    summary: 'A recurring drop instead of a manual upload.',
    detail:
      'A normalised claim schema behind a per-source adapter. You drop a nightly claims export or an 835 file; we map it once per source and it keeps working. Adding a new practice on a new system becomes a mapping configuration, not an engineering project. This is how billing companies already move data between a practice and their own system, so it fits the workflow rather than replacing it.',
    needs: 'A scheduled export or SFTP drop from the PM system. Most can do this already.',
  },
  {
    tier: '2',
    name: 'Clearinghouse API',
    status: 'roadmap',
    summary: 'One integration that covers every payer and every practice.',
    detail:
      'Denials arrive as 835 remittance advice from a clearinghouse, not from an EHR. Integrating there means one connection serves your whole book regardless of what each practice runs. Modern clearinghouses expose 837 submission, 835 remits and 276/277 status as ordinary JSON APIs with webhooks, so claim status and denial reasons land in Yeam automatically as they post.',
    needs: 'Credentials for the clearinghouse you already use.',
  },
  {
    tier: '3',
    name: 'EHR FHIR APIs',
    status: 'roadmap',
    summary: 'Only when an appeal needs the chart.',
    detail:
      'A medical-necessity appeal needs the progress note; a coding or duplicate denial does not. Under the Cures Act every ONC-certified EHR is required to expose a standardised FHIR R4 API, which is the legal lever that makes this possible at all. Epic, Oracle Health and athenahealth each run a free developer sandbox; production access means registering with each vendor and having the practice authorise us. Aggregators collapse many integrations into one at meaningful cost.',
    needs: 'Per-practice authorisation. This is the slowest path, which is why it is last.',
  },
]

const GAPS = [
  {
    title: 'No multi-tenancy yet',
    body: 'Today every authenticated user in a deployment sees all of its data. For a billing company serving many practices that is the first thing that has to change, and it is a schema change rather than a setting. It is the top of the build list ahead of any EHR connector.',
  },
  {
    title: 'No BAA in place',
    body: 'This deployment is not covered by a business associate agreement, so it cannot hold real PHI. Anything you try here should be de-identified or synthetic. A pilot on real data means signing BAAs first — that is a known, priced step, not an open question.',
  },
  {
    title: 'The letters are the mature part',
    body: 'The payer rules, appeal windows and denial playbooks have been worked over carefully and reviewed by a working billing manager. The ingestion side is younger. We would rather say which is which than let you find out.',
  },
]

export default async function HowWeConnectPage() {
  if (!(await hasAppealsAccess())) {
    return <PasscodeGate configured={isAppealsPortalConfigured()} />
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-[linear-gradient(165deg,#143A66_0%,#0E2748_58%,#091B34_100%)]">
        <div className="mx-auto max-w-3xl px-5 py-10 sm:px-8 sm:py-14">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white shadow-lg shadow-black/20 ring-1 ring-white/10">
              <Image src="/logo.png" alt="Yeam" width={36} height={36} className="h-9 w-9 object-contain" />
            </div>
            <div>
              <p className="text-lg font-semibold tracking-tight text-white">Yeam</p>
              <p className="text-sm text-slate-300">Connecting your data</p>
            </div>
          </div>
          <h1 className="mt-8 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            How Yeam connects
          </h1>
          <p className="mt-3 max-w-xl text-base text-slate-300">
            Written for a billing company, not a hospital IT department. Everything below is
            marked with where it actually stands.
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-10 sm:px-8 sm:py-14">
        <section className="rounded-lg border border-blue-200 bg-blue-50 px-5 py-5">
          <h2 className="text-lg font-semibold tracking-tight text-gray-900">The short answer</h2>
          <p className="mt-2 text-sm leading-relaxed text-gray-700">
            For a billing company, the EHR is usually the wrong place to integrate. Denials do not
            come from the EHR — they arrive as <strong>835 remittance advice from a
            clearinghouse</strong>, already carrying the CARC codes, the adjustment amounts and the
            payer&rsquo;s reason. One clearinghouse connection covers every payer and every practice
            on your book, whatever each practice happens to run.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-gray-700">
            So the honest answer to &ldquo;how do you handle the different EHRs?&rdquo; is that for
            most of the work, we try not to have to. Where the chart genuinely matters — a
            medical-necessity appeal that needs the progress note — there is a real path to the EHR,
            and it is the last tier below rather than the first.
          </p>
        </section>

        <section className="mt-12">
          <h2 className="text-xl font-semibold tracking-tight text-gray-900">Four ways in</h2>
          <p className="mt-1 text-sm text-gray-600">
            Ordered by how little they ask of the practice.
          </p>

          <div className="mt-6 space-y-5">
            {TIERS.map(tier => {
              const status = STATUS_STYLES[tier.status]
              return (
                <article
                  key={tier.tier}
                  className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm"
                >
                  <div className="border-b border-gray-100 px-5 py-4">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                      <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-800 text-xs font-semibold text-white">
                        {tier.tier}
                      </span>
                      <h3 className="font-semibold text-gray-900">{tier.name}</h3>
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${status.className}`}
                      >
                        {status.label}
                      </span>
                    </div>
                    <p className="mt-2 text-sm font-medium text-gray-700">{tier.summary}</p>
                  </div>
                  <div className="px-5 py-4">
                    <p className="text-sm leading-relaxed text-gray-700">{tier.detail}</p>
                    <p className="mt-3 text-sm text-gray-600">
                      <span className="font-medium text-gray-900">What it needs: </span>
                      {tier.needs}
                    </p>
                  </div>
                </article>
              )
            })}
          </div>
        </section>

        <section className="mt-14">
          <h2 className="text-xl font-semibold tracking-tight text-gray-900">
            What we don&rsquo;t have yet
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            The part most vendor pages leave out.
          </p>
          <div className="mt-6 space-y-4">
            {GAPS.map(gap => (
              <div key={gap.title} className="rounded-lg border border-gray-200 bg-white px-5 py-4">
                <h3 className="text-sm font-semibold text-gray-900">{gap.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-gray-700">{gap.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-14 rounded-lg border border-gray-200 bg-white px-5 py-5">
          <h2 className="text-lg font-semibold tracking-tight text-gray-900">
            What a design partner would get
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-gray-700">
            We are early enough that the order of the build list is still an open question, and a
            shop working real denials every day is a better guide to it than we are. The last round
            of feedback from a working billing manager changed how the product behaves: it now
            sends a corrected claim where it used to send an appeal, because he pointed out that
            arguing a CO-11 concedes the payer&rsquo;s point. You can see the result on the{' '}
            <Link href="/appeals" className="font-medium text-blue-600 underline hover:text-blue-700">
              appeal review page
            </Link>
            .
          </p>
          <p className="mt-3 text-sm leading-relaxed text-gray-700">
            The useful next step is a short call about which denial types eat the most of your
            team&rsquo;s week, and one de-identified export to run against.
          </p>
        </section>

        <footer className="mt-14 border-t border-gray-200 pt-6 text-xs text-gray-500">
          <p>
            Demonstration environment. Status labels on this page describe the product as it stands
            today. This deployment holds only synthetic data and is not covered by a BAA, so please
            do not send documents containing real patient information.
          </p>
        </footer>
      </main>
    </div>
  )
}

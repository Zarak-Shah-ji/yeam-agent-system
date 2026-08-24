import Image from 'next/image'
import { hasAppealsAccess, isAppealsPortalConfigured } from '@/lib/appeals/access'
import { listShowcaseAppeals } from '@/lib/billing/showcase-appeals'
import { AppealShowcaseCard } from '@/components/appeals/AppealShowcaseCard'
import { AppealUploader } from '@/components/appeals/AppealUploader'
import { PasscodeGate } from '@/components/appeals/PasscodeGate'

// Letters are written to the log as they're generated, so never serve a cached page.
export const dynamic = 'force-dynamic'

export default async function AppealsPage() {
  if (!(await hasAppealsAccess())) {
    return <PasscodeGate configured={isAppealsPortalConfigured()} />
  }

  const appeals = await listShowcaseAppeals(5)

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-[linear-gradient(165deg,#143A66_0%,#0E2748_58%,#091B34_100%)]">
        <div className="mx-auto max-w-3xl px-5 py-10 sm:px-8 sm:py-14">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white shadow-lg shadow-black/20 ring-1 ring-white/10">
              <Image src="/logo.png" alt="Yeam" width={36} height={36} className="h-9 w-9 object-contain" />
            </div>
            <div>
              <p className="text-lg font-semibold tracking-tight text-white">
                Yeam
              </p>
              <p className="text-sm text-slate-300">Appeal Letter Review</p>
            </div>
          </div>
          <h1 className="mt-8 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Insurance appeals
          </h1>
          <p className="mt-3 max-w-xl text-base text-slate-300">
            Below are appeal letters Yeam produced from denied claims. You can also upload one
            of your own denial documents and get a letter back in seconds.
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-10 sm:px-8 sm:py-14">
        <section>
          <h2 className="text-xl font-semibold tracking-tight text-gray-900">
            Recent appeals
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            Drafted from live claim data — patient details are synthetic.
          </p>

          {appeals.length === 0 ? (
            <p className="mt-6 rounded-lg border border-dashed border-gray-300 bg-white px-5 py-10 text-center text-sm text-gray-500">
              No appeal letters have been generated yet. Draft one below and it will appear here.
            </p>
          ) : (
            <div className="mt-6 space-y-5">
              {appeals.map((appeal, i) => (
                <AppealShowcaseCard key={appeal.id} appeal={appeal} index={i} />
              ))}
            </div>
          )}
        </section>

        <section className="mt-14">
          <h2 className="text-xl font-semibold tracking-tight text-gray-900">
            Draft a new appeal
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            Upload a denial letter, EOB, ERA, or claims export in any common format — or just
            paste the details. Yeam reads it and writes the appeal.
          </p>
          <div className="mt-6">
            <AppealUploader />
          </div>
        </section>

        <footer className="mt-14 border-t border-gray-200 pt-6 text-xs text-gray-500">
          <p>
            Demonstration environment. All patient names, member IDs, and claim numbers shown are
            synthetic test data. Uploaded files are processed in memory and are not stored.
          </p>
        </footer>
      </main>
    </div>
  )
}

import { FlaskConical } from 'lucide-react'

/**
 * Everything under /demo runs on the seeded Texas Medicaid dataset: real
 * provider NPIs from the DOGE/HHS open-data release, with faker-generated
 * patients and encounters layered on top.
 *
 * The banner is not decoration. These pages are indistinguishable from a real
 * EHR at a glance, and a customer who mistakes this data for their own — or
 * worse, acts on it — is a serious failure. It says so on every page, not just
 * the first.
 */
export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2.5 rounded-md border border-amber-200 bg-amber-50 px-3.5 py-2.5">
        <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
        <p className="text-sm text-amber-900">
          <span className="font-semibold">Sample practice — synthetic data.</span>{' '}
          Patients, encounters and claims on these pages are generated for demonstration. Nothing
          here is your data, and nothing you change here affects your worklist.
        </p>
      </div>
      {children}
    </div>
  )
}

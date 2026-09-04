import Link from 'next/link'
import { FlaskConical } from 'lucide-react'

/**
 * Says, once and in one place, that the numbers on screen are the sample
 * practice.
 *
 * One banner above the content rather than a badge on every card: the sample is
 * either all of what the workspace holds or none of it, so repeating it per
 * section is noise. It disappears by itself the first time a real file commits —
 * nothing to dismiss, because a dismissed banner over seeded revenue figures is
 * how someone ends up quoting sample numbers in a meeting.
 */
export function SampleBanner() {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
      <FlaskConical className="h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
      <p className="text-sm text-amber-900">
        <span className="font-medium">This is a sample practice.</span>{' '}
        Everything here is example data so the app has something to show.
      </p>
      <Link
        href="/connect"
        className="text-sm font-medium text-amber-900 underline underline-offset-2 hover:text-amber-950"
      >
        Import your own file
      </Link>
      <span className="text-sm text-amber-700">— it replaces all of this.</span>
    </div>
  )
}

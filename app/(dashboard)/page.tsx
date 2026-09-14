import { redirect } from 'next/navigation'

/**
 * The workspace landing.
 *
 * This used to be the EHR dashboard over the seeded Texas Medicaid data, which
 * meant a paying customer's first screen after login was somebody else's
 * synthetic patients. That dashboard is gone — /demo went with it — and the
 * first thing a customer sees is their own denials, or the box to upload them.
 */
export default function DashboardPage() {
  redirect('/worklist')
}

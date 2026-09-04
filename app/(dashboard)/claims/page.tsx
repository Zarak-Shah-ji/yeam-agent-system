import { OrgClaimsView } from '@/components/claims/OrgClaimsView'

export default function ClaimsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Claims</h1>
        <p className="text-sm text-gray-500">Every claim in your latest export, paid and unpaid</p>
      </div>
      <OrgClaimsView />
    </div>
  )
}

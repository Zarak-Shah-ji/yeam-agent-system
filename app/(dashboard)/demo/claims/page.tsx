import { ClaimsView } from '@/components/claims/ClaimsView'

export default function ClaimsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Claims</h1>
        <p className="text-sm text-gray-500 mt-0.5">Insurance claim management and tracking</p>
      </div>
      <ClaimsView />
    </div>
  )
}

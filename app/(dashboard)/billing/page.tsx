import { BillingView } from '@/components/billing/BillingView'

export default function BillingPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Billing</h1>
        <p className="text-sm text-gray-500 mt-0.5">Denied claims, appeals, and pending submission</p>
      </div>
      <BillingView />
    </div>
  )
}

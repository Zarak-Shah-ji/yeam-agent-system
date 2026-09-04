import { PayerScorecard } from '@/components/insights/PayerScorecard'

export default function PayersPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Payers</h1>
        <p className="text-sm text-gray-500">
          Who denies what, how long they take to pay, and how long you have to argue
        </p>
      </div>
      <PayerScorecard />
    </div>
  )
}

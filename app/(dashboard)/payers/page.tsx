import { Suspense } from 'react'
import { PayerScorecard } from '@/components/insights/PayerScorecard'
import { Skeleton } from '@/components/ui/skeleton'

export default function PayersPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Payers</h1>
        <p className="text-sm text-gray-500">
          Who denies what, how long they take to pay, and how long you have to argue
        </p>
      </div>
      {/*
        The scorecard reads the open payer from the URL, which opts this tree
        into client rendering — Next needs the boundary to prerender the shell
        around it, as it does on /claims.
      */}
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <PayerScorecard />
      </Suspense>
    </div>
  )
}

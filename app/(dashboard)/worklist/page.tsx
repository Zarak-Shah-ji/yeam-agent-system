import { Suspense } from 'react'
import { WorklistView } from '@/components/worklist/WorklistView'
import { Skeleton } from '@/components/ui/skeleton'

export default function WorklistPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Worklist</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          Your denials, sorted by what you&apos;re about to lose
        </p>
      </div>
      {/* The view reads ?row= so a claim can link straight to the row working it. */}
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <WorklistView />
      </Suspense>
    </div>
  )
}

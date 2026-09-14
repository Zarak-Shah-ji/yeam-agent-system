import { Suspense } from 'react'
import { OrgClaimsView } from '@/components/claims/OrgClaimsView'
import { Skeleton } from '@/components/ui/skeleton'

export default function ClaimsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Claims</h1>
        <p className="text-sm text-gray-500">Every claim in your latest export, paid and unpaid</p>
      </div>
      {/*
        The view reads its filters and the open claim from the URL, which opts
        this tree into client rendering — Next needs the boundary to prerender
        the shell around it.
      */}
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <OrgClaimsView />
      </Suspense>
    </div>
  )
}

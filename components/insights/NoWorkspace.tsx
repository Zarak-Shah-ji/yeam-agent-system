'use client'

import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

/**
 * What a signed-in account with no workspace sees.
 *
 * orgProcedure returns FORBIDDEN rather than falling back to reading everything,
 * which is correct and means every org-scoped page needs to handle it. The
 * seeded demo logins land here. Saying so plainly beats an empty table that
 * looks like the customer has no data.
 */
export function NoWorkspace() {
  return (
    <Card>
      <CardContent className="p-8 text-center">
        <p className="text-sm text-gray-600">
          This account predates workspaces and has no data of its own. Sign up for a new account to
          import your claims and denials.
        </p>
        <p className="mt-3 text-sm text-gray-500">
          The sample practice is still browsable in the meantime.
        </p>
        <Button asChild variant="outline" className="mt-4">
          <Link href="/demo">View the sample practice</Link>
        </Button>
      </CardContent>
    </Card>
  )
}

/** True when a tRPC error is orgProcedure refusing an account with no workspace. */
export function isNoWorkspace(error: { data?: { code?: string } | null } | null | undefined): boolean {
  return error?.data?.code === 'FORBIDDEN'
}

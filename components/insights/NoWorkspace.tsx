'use client'

import Link from 'next/link'
import { Upload } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

/**
 * What a signed-in account with no workspace sees.
 *
 * orgProcedure returns FORBIDDEN rather than falling back to reading
 * everything, which is correct and means every org-scoped page needs to handle
 * it. This is now a genuine last resort: lib/auth.ts provisions a workspace on
 * sign-in for any account that lacks one, so reaching this card means that
 * backfill itself failed.
 *
 * It used to say "sign up for a new account" and link to /demo. Both were wrong
 * by the time anyone read them. The reader is signed in, so telling them to
 * register is advice they cannot act on and reads as a broken session; and
 * /demo stopped existing when the sample practice became data inside a
 * workspace rather than a section of its own, so the one button on the card was
 * a 404. Say what is true — the workspace is not ready — and point at the
 * screen that matters either way.
 */
export function NoWorkspace() {
  return (
    <Card>
      <CardContent className="p-8 text-center">
        <Upload className="mx-auto h-6 w-6 text-gray-300" aria-hidden="true" />
        <p className="mt-2 text-sm font-medium text-gray-900">
          This workspace is still being set up
        </p>
        <p className="mx-auto mt-1 max-w-md text-sm text-gray-500">
          You are signed in, but the account has no workspace yet, so there is nothing to read.
          Signing out and back in usually finishes setting one up. If this card is still here after
          that, send us the email address you signed in with.
        </p>
        <Button asChild variant="outline" size="sm" className="mt-4">
          <Link href="/connect">Import your file</Link>
        </Button>
      </CardContent>
    </Card>
  )
}

/** True when a tRPC error is orgProcedure refusing an account with no workspace. */
export function isNoWorkspace(error: { data?: { code?: string } | null } | null | undefined): boolean {
  return error?.data?.code === 'FORBIDDEN'
}

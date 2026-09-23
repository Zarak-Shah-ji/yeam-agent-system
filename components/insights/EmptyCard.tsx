'use client'

import Link from 'next/link'
import { Upload } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

/**
 * What a card shows when the data behind it has not been uploaded.
 *
 * Never zeroes. A revenue chart flat at $0 reads as "this practice collected
 * nothing", not as "you have not given us an A/R export" — and the first is a
 * number a customer might act on.
 */
export function EmptyCard({
  title,
  need,
  children,
  action,
}: {
  title: string
  need: string
  children?: React.ReactNode
  /**
   * Replaces the import button.
   *
   * Not everything empty here is waiting on a file. Appeal outcomes are
   * assembled from what this workspace sent and what came back, and there is
   * no export that fills them — pointing that reader at the import page sends
   * them somewhere that cannot help.
   */
  action?: React.ReactNode
}) {
  return (
    <Card>
      <CardContent className="p-6 text-center">
        <Upload className="mx-auto h-6 w-6 text-gray-300" aria-hidden="true" />
        <p className="mt-2 text-sm font-medium text-gray-900">{title}</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-gray-500">{need}</p>
        {children}
        {action ?? (
          <Button asChild variant="outline" size="sm" className="mt-4">
            <Link href="/connect">Import a file</Link>
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

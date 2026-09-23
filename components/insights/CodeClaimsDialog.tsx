'use client'

import { useRouter } from 'next/navigation'
import { format } from 'date-fns'
import { trpc } from '@/lib/trpc/client'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { PROCEDURES } from '@/lib/billing/procedure-codes'
import { usd } from '@/lib/charts/format'

/** As many as anyone reads standing at a chart. The rest are one link away. */
const PREVIEW = 25

/**
 * The claims behind one procedure code.
 *
 * "Procedures losing the most money" used to be a dead end: it named 97110 and
 * $38,400 and then stopped, leaving the reader to go to the claims table and
 * reconstruct the filter by hand. An aggregate that cannot be opened is a
 * finding nobody can act on.
 *
 * Deliberately a preview rather than a second claims table. The real one is one
 * click away with every filter, sort and page control already built; duplicating
 * it here would mean two tables that drift. What this owes the reader is proof
 * that the number is real and a way through to the individual claim.
 *
 * No status column: the list is filtered to denied claims, so it would say
 * "Denied" on every row — a column that can only ever say one thing is not
 * information.
 *
 * Rows navigate rather than opening a nested dialog. ClaimDetailDialog is driven
 * by the URL on /claims and needs an OrgClaim id, so sending the reader there
 * lands them on the genuine detail view instead of a second, lesser copy of it.
 */
export function CodeClaimsDialog({
  code,
  open,
  onOpenChange,
}: {
  code: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()

  // Denied only, matching the column the reader clicked: the card ranks by
  // money lost, so opening it on every claim for the code — paid ones included
  // — would answer a question nobody asked.
  const filters = { cpt: code ?? '', status: 'DENIED' as const }
  const enabled = open && Boolean(code)

  const claims = trpc.insights.claimList.useQuery(
    { ...filters, limit: PREVIEW, sort: 'billed' as const },
    { enabled },
  )
  const summary = trpc.insights.claimSummary.useQuery(filters, { enabled })

  const description = code ? (PROCEDURES[code.toUpperCase()]?.description ?? null) : null
  const items = claims.data?.items ?? []
  const total = summary.data?.count ?? 0

  function openClaim(id: string) {
    router.push(`/claims?cpt=${encodeURIComponent(code ?? '')}&status=DENIED&claim=${id}`)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-mono">
            {code}
            {description && (
              <span className="ml-2 font-sans font-normal text-gray-600">{description}</span>
            )}
          </DialogTitle>
          <DialogDescription>
            {summary.isLoading ? (
              'Counting…'
            ) : total > 0 ? (
              <>
                {usd(summary.data?.deniedBilled ?? 0)} denied across {total}{' '}
                {total === 1 ? 'claim' : 'claims'}
              </>
            ) : (
              'No denied claims carry this code in the current snapshot.'
            )}
          </DialogDescription>
        </DialogHeader>

        {claims.isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2, 3].map(i => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : claims.error ? (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
            These claims could not be loaded. {claims.error.message}
          </p>
        ) : items.length === 0 ? (
          /*
            Reachable even when the card counted rows: the card is built from
            the denial worklist as well as the claims snapshot, so a code can be
            costing money on the worklist while no claim in the latest A/R
            export carries it. Saying so beats an empty table.
          */
          <p className="py-6 text-center text-sm text-gray-500">
            Nothing to show. This code is costing money on the denial worklist, but no claim in
            the current A/R snapshot carries it.
          </p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Claim</TableHead>
                  <TableHead>Payer</TableHead>
                  <TableHead className="text-right">Billed</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead className="text-right">Service date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map(row => (
                  <TableRow
                    key={row.id}
                    tabIndex={0}
                    role="button"
                    aria-label={`Open claim ${row.claimNumber ?? row.id}`}
                    className="cursor-pointer hover:bg-gray-50"
                    onClick={() => openClaim(row.id)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        openClaim(row.id)
                      }
                    }}
                  >
                    <TableCell className="font-mono text-xs">
                      {row.claimNumber ?? <span className="text-gray-400">—</span>}
                    </TableCell>
                    <TableCell className="text-sm">
                      {row.payer ?? <span className="text-gray-400">—</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{usd(row.billed)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.balance > 0 ? usd(row.balance) : <span className="text-gray-400">—</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.serviceDate ? (
                        format(new Date(row.serviceDate), 'MM/dd/yyyy')
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <div className="flex items-center justify-between gap-3 pt-1">
              <p className="text-xs text-gray-500">
                {total > items.length
                  ? `Showing the ${items.length} largest of ${total}.`
                  : 'Every claim for this code.'}
              </p>
              {/* A button, not a Link: it closes the dialog on the way out, so
                  the reader does not come back to a stale overlay. */}
              <button
                type="button"
                onClick={() => {
                  onOpenChange(false)
                  router.push(`/claims?cpt=${encodeURIComponent(code ?? '')}&status=DENIED`)
                }}
                className="text-sm font-medium text-blue-600 underline underline-offset-2 hover:text-blue-700"
              >
                See all {total} in Claims →
              </button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

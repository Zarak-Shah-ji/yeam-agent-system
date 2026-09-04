'use client'

import { useState } from 'react'
import Link from 'next/link'
import { format } from 'date-fns'
import { trpc } from '@/lib/trpc/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { EmptyCard } from '@/components/insights/EmptyCard'
import { NoWorkspace, isNoWorkspace } from '@/components/insights/NoWorkspace'

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

const STATUS_VARIANT: Record<string, 'default' | 'success' | 'warning' | 'secondary' | 'destructive' | 'outline'> = {
  PAID: 'success',
  PARTIAL: 'warning',
  DENIED: 'destructive',
  PENDING: 'default',
  REJECTED: 'destructive',
  WRITTEN_OFF: 'secondary',
  UNKNOWN: 'secondary',
}

const STATUS_LABEL: Record<string, string> = {
  PAID: 'Paid',
  PARTIAL: 'Partial',
  DENIED: 'Denied',
  PENDING: 'Pending',
  REJECTED: 'Rejected',
  WRITTEN_OFF: 'Written off',
  UNKNOWN: 'Unknown',
}

const ALL = '__all__'

/**
 * The customer's own claims, from their most recent A/R snapshot.
 *
 * A denied row that is already on the worklist links straight into the drafter
 * rather than being a dead end — the whole point of having both files is that
 * the denial you are looking at is one click from the letter that answers it.
 */
export function OrgClaimsView() {
  const [status, setStatus] = useState(ALL)
  const [payer, setPayer] = useState(ALL)
  const [search, setSearch] = useState('')

  const state = trpc.insights.workspaceState.useQuery()
  const payerNames = trpc.insights.payerNames.useQuery()
  const unworked = trpc.insights.unworkedDenials.useQuery()
  const utils = trpc.useUtils()

  const claims = trpc.insights.claimList.useQuery({
    ...(status === ALL ? {} : { status: status as 'PAID' }),
    ...(payer === ALL ? {} : { payer }),
    ...(search.trim() ? { search: search.trim() } : {}),
    limit: 100,
  })

  const addToWorklist = trpc.imports.addDeniedToWorklist.useMutation({
    onSuccess: () => {
      void utils.insights.invalidate()
      void utils.worklist.invalidate()
    },
  })

  if (isNoWorkspace(state.error)) return <NoWorkspace />

  if (!state.isLoading && !state.data?.hasClaims) {
    return (
      <EmptyCard
        title="No claims imported"
        need="An A/R or all-claims export fills this table, and gives every rate in Analytics a denominator. A denials export alone only covers the denied ones."
      />
    )
  }

  const items = claims.data?.items ?? []

  return (
    <div className="space-y-4">
      {state.data?.claimsSnapshotAt && (
        <p className="text-sm text-gray-500">
          From <span className="font-medium text-gray-700">{state.data.claimsSnapshotFilename}</span>
          , imported {format(new Date(state.data.claimsSnapshotAt), 'MMM d, yyyy')}. Only your most
          recent claims export is read, so two monthly snapshots never double-count.
        </p>
      )}

      {(unworked.data?.count ?? 0) > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5">
          <p className="text-sm text-amber-900">
            <span className="font-semibold">{unworked.data!.count} denied claims</span> in this
            export aren&rsquo;t on your worklist — {usd.format(unworked.data!.billed)} not being
            worked.
          </p>
          <Button
            size="sm"
            disabled={addToWorklist.isPending}
            onClick={() => addToWorklist.mutate()}
          >
            {addToWorklist.isPending ? 'Adding…' : 'Add them to the worklist'}
          </Button>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Input
          placeholder="Search claim number, CPT or ICD-10…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            {Object.entries(STATUS_LABEL).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={payer} onValueChange={setPayer}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder="All payers" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All payers</SelectItem>
            {(payerNames.data ?? []).map(name => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Claim</TableHead>
                <TableHead>Payer</TableHead>
                <TableHead>Service date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>CPT</TableHead>
                <TableHead className="text-right">Billed</TableHead>
                <TableHead className="text-right">Paid</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {claims.isLoading &&
                [0, 1, 2, 3, 4].map(i => (
                  <TableRow key={i}>
                    <TableCell colSpan={9}>
                      <Skeleton className="h-6 w-full" />
                    </TableCell>
                  </TableRow>
                ))}

              {!claims.isLoading && items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="py-8 text-center text-sm text-gray-500">
                    No claims match those filters.
                  </TableCell>
                </TableRow>
              )}

              {items.map(row => (
                <TableRow key={row.id}>
                  <TableCell className="font-mono text-xs">{row.claimNumber ?? '—'}</TableCell>
                  <TableCell className="text-sm">{row.payer ?? '—'}</TableCell>
                  <TableCell className="text-sm">
                    {row.serviceDate ? format(new Date(row.serviceDate), 'MM/dd/yyyy') : '—'}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[row.status] ?? 'secondary'}>
                      {STATUS_LABEL[row.status] ?? row.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{row.cpt ?? '—'}</TableCell>
                  <TableCell className="text-right">{usd.format(row.billed)}</TableCell>
                  <TableCell className="text-right text-gray-600">
                    {row.paid === null ? '—' : usd.format(row.paid)}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {row.balance > 0 ? usd.format(row.balance) : '—'}
                  </TableCell>
                  <TableCell>
                    {row.worklistRowId ? (
                      <Button asChild size="sm" variant="outline">
                        <Link href="/worklist">Work it</Link>
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {claims.data?.nextCursor && (
        <p className="text-center text-sm text-gray-500">
          Showing the first {items.length}. Narrow the filters to see more.
        </p>
      )}
    </div>
  )
}

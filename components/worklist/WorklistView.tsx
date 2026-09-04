'use client'

import { useState } from 'react'
import { AlertTriangle, PhoneOff, ShieldCheck } from 'lucide-react'
import { trpc } from '@/lib/trpc/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ImportBox, type ImportResult } from '@/components/imports/ImportBox'
import { NoWorkspace, isNoWorkspace } from '@/components/insights/NoWorkspace'
import { DraftDialog } from './DraftDialog'
import { STATUS_LABEL } from './RowDetail'
import type { WorklistRow } from './types'

const money = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

const REMEDY_VARIANT: Record<string, 'default' | 'success' | 'warning' | 'secondary' | 'destructive' | 'outline'> = {
  corrected_claim: 'warning',
  reprocess: 'default',
  appeal: 'outline',
  not_recoverable: 'secondary',
  unknown: 'secondary',
}

const BAND_STYLE: Record<string, string> = {
  now: 'bg-red-600 text-white',
  soon: 'bg-amber-500 text-white',
  later: 'bg-gray-200 text-gray-700',
  parked: 'bg-gray-100 text-gray-400',
}

const BAND_LABEL: Record<string, string> = {
  now: 'Work now',
  soon: 'This week',
  later: 'Can wait',
  parked: 'Parked',
}

const STATUS_FILTERS = ['ALL', 'TO_WORK', 'DRAFTED', 'SENT', 'PAID', 'DEAD'] as const

/**
 * The score, and the reason for it.
 *
 * The factor breakdown is on the badge as a title so it is one hover away in the
 * table, and repeated in full inside the dialog. A ranking a biller cannot
 * interrogate is one they will override with a sort-by-dollars, so the
 * explanation travels with the number everywhere it appears.
 */
function Priority({ row }: { row: WorklistRow }) {
  const why = row.factors.map(f => `${f.label} +${f.points} — ${f.detail}`).join('\n')
  return (
    <div className="flex items-center gap-2" title={why}>
      <span
        className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums ${
          BAND_STYLE[row.band] ?? BAND_STYLE.later
        }`}
      >
        {row.score}
      </span>
      <span className="hidden text-xs text-gray-500 lg:inline">
        {BAND_LABEL[row.band] ?? ''}
      </span>
    </div>
  )
}

/** Days left, coloured by how much trouble the row is in. */
function Deadline({ daysLeft, expired }: { daysLeft: number | null; expired: boolean }) {
  if (daysLeft === null) return <span className="text-gray-400">No date</span>
  if (expired) {
    return <span className="font-medium text-gray-400 line-through">{daysLeft}d</span>
  }
  const urgent = daysLeft <= 14
  return (
    <span className={urgent ? 'font-semibold text-red-600' : 'font-medium text-gray-900'}>
      {daysLeft}d
    </span>
  )
}

export function WorklistView() {
  const [imported, setImported] = useState<ImportResult | null>(null)
  const [activeRowId, setActiveRowId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]>('ALL')

  const summary = trpc.worklist.summary.useQuery()
  const rows = trpc.worklist.rows.useQuery({
    limit: 200,
    ...(statusFilter === 'ALL' ? {} : { status: statusFilter }),
  })
  const batches = trpc.worklist.batches.useQuery()

  function refreshAll() {
    void summary.refetch()
    void rows.refetch()
    void batches.refetch()
  }

  function handleImported(result: ImportResult) {
    setImported(result)
    refreshAll()
  }

  // A workspace with no org is a 403 from orgProcedure — the seeded demo
  // logins hit this. Say so plainly rather than rendering an empty worklist.
  if (isNoWorkspace(summary.error)) return <NoWorkspace />

  const isEmpty = !batches.isLoading && (batches.data?.length ?? 0) === 0

  if (isEmpty) {
    return (
      <div className="mx-auto max-w-2xl">
        <ImportBox onImported={handleImported} />
      </div>
    )
  }

  const tiles = summary.data
  const list = (rows.data ?? []) as unknown as WorklistRow[]
  const activeRow = list.find(r => r.id === activeRowId) ?? null

  return (
    <div className="space-y-5">
      {imported && (
        <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm">
          <p className="font-medium text-green-900">
            Imported {imported.imported} denials
            {imported.skipped > 0 && ` · ${imported.skipped} rows had no reason code and were skipped`}
          </p>
          {imported.refusedColumns.length > 0 && (
            <p className="mt-1 flex items-start gap-1.5 text-green-800">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>Not read or stored: {imported.refusedColumns.join(', ')}</span>
            </p>
          )}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-gray-500">Needs attention</p>
            <div className="mt-1 text-2xl font-bold text-gray-900">
              {tiles ? tiles.needsAttention : <Skeleton className="h-8 w-16" />}
            </div>
            <p className="mt-0.5 text-xs text-gray-500">
              {tiles
                ? tiles.workNow > 0
                  ? `${tiles.workNow} urgent · ${money.format(tiles.needsAttentionBilled)}`
                  : `${money.format(tiles.needsAttentionBilled)}, none inside 14 days`
                : '—'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-gray-500">At stake</p>
            <div className="mt-1 text-2xl font-bold text-gray-900">
              {tiles ? money.format(tiles.atStake) : <Skeleton className="h-8 w-24" />}
            </div>
            <p className="mt-0.5 text-xs text-gray-500">
              across {tiles?.actionable ?? 0} workable denials
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-gray-500">Follow-ups due</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">{tiles?.followUpsDue ?? 0}</p>
            <p className="mt-0.5 text-xs text-gray-500">
              {tiles?.expiringSoon ?? 0} expiring within 14 days
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-gray-500">Recovered</p>
            <div className="mt-1 text-2xl font-bold text-green-700">
              {tiles ? money.format(tiles.recovered) : <Skeleton className="h-8 w-24" />}
            </div>
            <p className="mt-0.5 text-xs text-gray-500">
              {tiles?.recoveredCount ?? 0} denials marked paid
            </p>
          </CardContent>
        </Card>
      </div>

      <ImportBox onImported={handleImported} compact />

      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-gray-500">
          Ranked by deadline, dollars, how long it has sat and what it costs to fix.
        </p>
        <Select
          value={statusFilter}
          onValueChange={v => setStatusFilter(v as (typeof STATUS_FILTERS)[number])}
        >
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_FILTERS.map(s => (
              <SelectItem key={s} value={s}>
                {s === 'ALL' ? 'All statuses' : STATUS_LABEL[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28">Priority</TableHead>
                  <TableHead className="w-20">Days left</TableHead>
                  <TableHead>Claim</TableHead>
                  <TableHead>Payer</TableHead>
                  <TableHead>Denial</TableHead>
                  <TableHead>What it needs</TableHead>
                  <TableHead className="text-right">Billed</TableHead>
                  <TableHead className="w-28" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.isLoading &&
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={8}>
                        <Skeleton className="h-5 w-full" />
                      </TableCell>
                    </TableRow>
                  ))}

                {!rows.isLoading && list.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="py-8 text-center text-sm text-gray-500">
                      Nothing in this status.
                    </TableCell>
                  </TableRow>
                )}

                {list.map(row => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <Priority row={row} />
                    </TableCell>
                    <TableCell>
                      <Deadline daysLeft={row.daysLeft} expired={row.expired} />
                      {row.windowSource === 'default' && !row.expired && (
                        <span
                          className="ml-1 text-gray-400"
                          title="Filing window estimated — this payer is not in the rule set"
                        >
                          ~
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="font-medium">
                      {row.claimNumber ?? '—'}
                      {row.status !== 'TO_WORK' && (
                        <p className="mt-0.5 text-xs font-normal text-gray-500">
                          {STATUS_LABEL[row.status] ?? row.status}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="text-gray-600">
                      {row.payer ?? '—'}
                      {row.call.verdict !== 'not-sent' && (
                        <p
                          className="mt-0.5 flex items-center gap-1 text-xs text-gray-500"
                          title={row.call.detail}
                        >
                          <PhoneOff className="h-3 w-3" aria-hidden="true" />
                          {row.call.label}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="font-mono text-xs">{row.carc}</span>
                      {/* The refinement replaces the vague label when we have one:
                          "N290 — rendering NPI missing" beats "lacks information". */}
                      {row.refinement ? (
                        <p
                          className="mt-0.5 max-w-xs truncate text-xs text-blue-700"
                          title={`${row.refinement.cause} — ${row.refinement.action}`}
                        >
                          {row.refinement.rarc ? `${row.refinement.rarc} · ` : ''}
                          {row.refinement.cause}
                        </p>
                      ) : (
                        <p
                          className="mt-0.5 max-w-xs truncate text-xs text-gray-500"
                          title={row.carcLabel}
                        >
                          {row.carcLabel}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={REMEDY_VARIANT[row.remedy] ?? 'secondary'}>
                        {row.remedyLabel}
                      </Badge>
                      {row.remedy === 'unknown' && (
                        <AlertTriangle
                          className="ml-1 inline h-3.5 w-3.5 text-amber-500"
                          aria-label="Needs review"
                        />
                      )}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {money.format(row.billed)}
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant={row.actionable && row.draftCount === 0 ? 'default' : 'outline'}
                        onClick={() => setActiveRowId(row.id)}
                      >
                        {row.draftCount > 0 ? 'Open' : row.actionable ? 'Work' : 'Review'}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <DraftDialog
        row={activeRow}
        claimLabel={
          activeRow ? `${activeRow.claimNumber ?? 'Denial'} · ${activeRow.carc}` : ''
        }
        open={Boolean(activeRow)}
        onOpenChange={open => !open && setActiveRowId(null)}
        onDrafted={refreshAll}
      />
    </div>
  )
}

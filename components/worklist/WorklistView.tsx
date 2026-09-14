'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { AlertTriangle, PhoneOff } from 'lucide-react'
import { trpc } from '@/lib/trpc/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ViewToggle, useAnalyticsView } from '@/components/charts/ViewToggle'
import { BAND_LABEL, type PriorityBand } from '@/lib/denials/score'
import { ImportBox, type ImportResult } from '@/components/imports/ImportBox'
import { ImportSummary } from '@/components/imports/ImportSummary'
import { NoWorkspace, isNoWorkspace } from '@/components/insights/NoWorkspace'
import { UsageBanner } from '@/components/subscription/Upgrade'
import { DraftDialog } from './DraftDialog'
import { QueueChart } from './QueueChart'
import { SearchBar } from './SearchBar'
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

/**
 * The same urgency, written across the whole row instead of into the badge.
 *
 * A 28px circle at the far left is a legible ranking and a poor scan: to find
 * what needs working today the eye has to travel down one narrow column and
 * hold each colour in memory against the claim thirty pixels to its right. A
 * wash on the row itself groups the queue at a glance, which is the way a
 * biller actually reads it — top of the screen down, in blocks.
 *
 * Tuned as an alpha over the surface rather than a fixed shade, for two reasons.
 * Red is the loudest hue on screen and a saturated fill across a full-width row
 * shouts at somebody who is going to be looking at this all day, so it sits at
 * 6% — enough to read as red beside an untinted row and not enough to fight the
 * text on top of it. And an alpha composites over whatever the surface is, so
 * these hold up under the dark theme without a second palette: the shades below
 * lift a little there, because a wash over a near-black card needs more to be
 * visible than the same wash over white.
 *
 * Hover deepens the row's own colour. The table's default hover fill is grey,
 * which on a tinted row would read as the colour dropping out on mouseover.
 */
const BAND_ROW: Record<string, string> = {
  now: 'bg-red-500/[0.06] hover:bg-red-500/[0.11] dark:bg-red-500/[0.10] dark:hover:bg-red-500/[0.16]',
  soon: 'bg-amber-500/[0.08] hover:bg-amber-500/[0.14] dark:bg-amber-500/[0.11] dark:hover:bg-amber-500/[0.17]',
  // Left plain on purpose. If everything is tinted, nothing is — "can wait" is
  // the resting state of the queue and earns no ink.
  later: '',
  parked: 'bg-gray-500/[0.04] text-gray-400 hover:bg-gray-500/[0.08]',
}

/** Recovered money, in the same green the tile above the table uses. */
const SETTLED_ROW = 'bg-green-500/[0.06] text-gray-500 hover:bg-green-500/[0.10] dark:bg-green-500/[0.09] dark:hover:bg-green-500/[0.14]'

/**
 * What colour this row is, which is not always what the score says.
 *
 * The band is derived from the deadline and the dollars and knows nothing about
 * what a human has since done — so a denial that was worked, appealed and PAID
 * still scores into `now` and would light the row red for money already in the
 * bank. Harmless when it was a badge; actively misleading across a whole row.
 * A settled row is settled, whatever it would otherwise rank.
 */
function rowTint(row: WorklistRow): string {
  if (row.status === 'PAID') return SETTLED_ROW
  if (row.status === 'DEAD') return BAND_ROW.parked
  return BAND_ROW[row.band] ?? ''
}

const STATUS_FILTERS = ['ALL', 'TO_WORK', 'DRAFTED', 'SENT', 'PAID', 'DEAD'] as const

/**
 * Appeals sent long enough ago that the payer has almost certainly answered.
 *
 * The outcome ledger is the one asset in this product that cannot be rebuilt
 * from an export, and it is only worth what gets written into it. Left to
 * memory, the wins get recorded — money arriving is memorable — and the losses
 * do not, which produces a dataset that is not thin but confidently wrong in
 * the one direction that costs money to believe.
 *
 * So the gap is shown where the work already happens rather than in a report
 * nobody runs. Sixty days because that is past most payers' own appeal
 * turnaround: before then, silence is normal and nagging about it trains people
 * to ignore the banner.
 */
const STALE_APPEAL_DAYS = 60

function OpenLoopBanner({ onShowSent }: { onShowSent: () => void }) {
  const awaiting = trpc.worklist.awaitingOutcome.useQuery({ limit: 100 })
  const stale = (awaiting.data ?? []).filter(s => s.daysOut >= STALE_APPEAL_DAYS)
  if (stale.length === 0) return null

  const oldest = stale[0]
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
      <p className="text-amber-900">
        <span className="font-semibold">{stale.length}</span>{' '}
        {stale.length === 1 ? 'appeal has' : 'appeals have'} been out over {STALE_APPEAL_DAYS} days
        with no outcome recorded — the oldest for {oldest.daysOut} days. Open the row and record
        what came back, even if the answer was no.
      </p>
      <Button size="sm" variant="outline" onClick={onShowSent}>
        Show sent
      </Button>
    </div>
  )
}

/** How many ranked rows the table will render. Past this it says so. */
const ROW_CAP = 200

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
        {BAND_LABEL[row.band as PriorityBand] ?? ''}
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
  // A claim on /claims links straight to the row that is working it. Read once
  // into local state rather than driving the dialog from the URL, so closing it
  // does not need a navigation and the back button still leaves the page.
  const requestedRow = useSearchParams().get('row')
  const [consumedRow, setConsumedRow] = useState<string | null>(null)
  if (requestedRow && requestedRow !== consumedRow) {
    setConsumedRow(requestedRow)
    setActiveRowId(requestedRow)
  }
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]>('ALL')
  const [search, setSearch] = useState('')
  // The same preference Analytics and Payers read. Someone who wants figures
  // rather than pictures wants them on every page, and having to say so three
  // times is the sort of thing that makes a toggle feel broken.
  const [view, setView] = useAnalyticsView()

  const summary = trpc.worklist.summary.useQuery()
  const rows = trpc.worklist.rows.useQuery(
    {
      limit: ROW_CAP,
      ...(statusFilter === 'ALL' ? {} : { status: statusFilter }),
      ...(search ? { q: search } : {}),
    },
    // Keep the last result on screen while the next one is in flight, so typing
    // into the search box does not strobe the table through a skeleton on every
    // keystroke. The spinner in the field is the honest signal that it is stale.
    { placeholderData: prev => prev },
  )
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

  // Summed from the bands rather than read off `atStake`, so the headline and
  // the bars under it are the same arithmetic. `atStake` counts workable rows
  // only, which is the right number for the tile that says so and the wrong one
  // to print above a chart that plots every open row.
  const openBilled = (tiles?.byBand ?? []).reduce((sum, b) => sum + b.billed, 0)
  const openCount = (tiles?.byBand ?? []).reduce((sum, b) => sum + b.count, 0)

  return (
    <div className="space-y-5">
      {imported && <ImportSummary result={imported} />}

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-gray-700">Where the queue stands</h2>
          <ViewToggle value={view} onChange={setView} />
        </div>

        {view === 'chart' ? (
          <Card>
            <CardContent className="p-4">
              <p className="text-xs uppercase tracking-wide text-gray-500">Open, by urgency</p>
              <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
                <span className="text-2xl font-bold text-gray-900">
                  {tiles ? money.format(openBilled) : <Skeleton className="inline-block h-8 w-24" />}
                </span>
                <span className="text-sm text-gray-500">
                  across {openCount} {openCount === 1 ? 'denial' : 'denials'} still open
                </span>
              </div>

              <div className="mt-2">
                {summary.isLoading ? (
                  <Skeleton className="h-40 w-full" />
                ) : (
                  <QueueChart byBand={tiles?.byBand ?? []} />
                )}
              </div>

              {/* The three figures the bars do not encode. The chart is a
                  different cut of the queue, not a smaller one — a reader who
                  prefers it should not have to switch back to learn what came
                  in this month. */}
              <p className="mt-1 border-t border-gray-200 pt-2.5 text-xs text-gray-500">
                {money.format(tiles?.atStake ?? 0)} at stake on the {tiles?.actionable ?? 0}{' '}
                workable · {tiles?.followUpsDue ?? 0} follow-ups due ·{' '}
                <span className="font-medium text-green-700">
                  {money.format(tiles?.recovered ?? 0)} recovered
                </span>{' '}
                across {tiles?.recoveredCount ?? 0} marked paid
              </p>
            </CardContent>
          </Card>
        ) : (
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
        )}
      </div>

      <UsageBanner />

      <OpenLoopBanner onShowSent={() => setStatusFilter('SENT')} />

      <ImportBox onImported={handleImported} compact />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <SearchBar
          value={search}
          onChange={setSearch}
          matches={rows.data ? list.length : null}
          isSearching={rows.isFetching}
        />
        <div className="flex items-center gap-3 sm:pt-0.5">
          <p className="hidden text-sm text-gray-500 lg:block">
            Ranked by deadline, dollars, time sat and cost to fix.
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
                      {search
                        ? `No row matches “${search}”${statusFilter === 'ALL' ? '' : ' in this status'}.`
                        : 'Nothing in this status.'}
                    </TableCell>
                  </TableRow>
                )}

                {list.map(row => (
                  <TableRow key={row.id} className={rowTint(row)}>
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

      {/* Say when the table is a slice rather than the whole answer. A count
          that silently stops at the cap reads as "that is all of them", and a
          biller reconciling a payer's list against this one deserves better. */}
      {list.length >= ROW_CAP && (
        <p className="text-xs text-gray-500">
          Showing the top {ROW_CAP} by priority
          {search ? ` of the rows matching “${search}”` : ''} — there are more below the cut.
        </p>
      )}

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

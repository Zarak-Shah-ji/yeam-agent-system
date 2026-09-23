'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
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
import { useUsage } from '@/components/shared/use-usage'
import type { AgingBucket } from '@/lib/insights/aggregate'
import { NoWorkspace, isNoWorkspace } from '@/components/insights/NoWorkspace'
import { ClaimsSummary } from './ClaimsSummary'
import { ClaimDetailDialog } from './ClaimDetailDialog'
import { SlidersHorizontal, X } from 'lucide-react'
import { STATUS_LABEL, STATUS_VARIANT } from './status'
import Link from 'next/link'

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

/** Radix Select forbids value="", so the "no filter" option needs a sentinel. */
const ALL = '__all__'

const AGING_LABEL: Record<string, string> = {
  '0-30': '0–30 days',
  '31-60': '31–60 days',
  '61-90': '61–90 days',
  '91-120': '91–120 days',
  '120+': '120+ days',
}

const SORT_LABEL: Record<string, string> = {
  newest: 'Newest first',
  oldest: 'Oldest first',
  billed: 'Largest billed',
}

const PAGE = 100

/**
 * The customer's own claims, from their most recent A/R snapshot.
 *
 * Every filter and the open claim live in the URL. Nothing in the dashboard used
 * to, so a biller who refreshed — or wanted to send a colleague the claim they
 * were looking at — lost the lot. It is also what lets a denied row link into
 * the drafter at the right row rather than at the top of the worklist.
 */
export function OrgClaimsView() {
  const router = useRouter()
  const params = useSearchParams()

  const status = params.get('status') ?? ALL
  const payer = params.get('payer') ?? ALL
  const carc = params.get('carc') ?? ALL
  /**
   * Set by the drill-in from the Analytics procedure card.
   *
   * There is no dropdown for it — the snapshot can carry hundreds of distinct
   * CPTs, which is a list nobody scrolls. It arrives from a link and leaves
   * through its chip, which is the whole lifecycle it needs.
   */
  const cpt = params.get('cpt') ?? ALL
  const aging = params.get('aging') ?? ALL
  const sort = params.get('sort') ?? 'newest'
  const unsettled = params.get('unsettled') === '1'
  const search = params.get('q') ?? ''
  const openClaim = params.get('claim')
  const openSection = params.get('open')

  /** Typing is local; the query only moves once typing stops. */
  const [draftSearch, setDraftSearch] = useState(search)
  const [pages, setPages] = useState(1)
  /** Local, not in the URL: whether the refining controls are on screen is a
   *  property of this reader's session, not of the view being shared. A link
   *  carries which filters are ON — the chips render those either way. */
  const [showFilters, setShowFilters] = useState(false)

  function setParam(next: Record<string, string | null>) {
    const q = new URLSearchParams(params.toString())
    for (const [key, value] of Object.entries(next)) {
      if (value === null || value === ALL || value === '') q.delete(key)
      else q.set(key, value)
    }
    // A filter change invalidates the page count — the cursor it was built from
    // belongs to the old result set. Opening a claim or a section inside one is
    // not a filter change, and resetting a biller's loaded pages because they
    // expanded a panel would be its own small betrayal.
    if (!('claim' in next) && !('open' in next)) setPages(1)
    router.replace(q.toString() ? `/claims?${q}` : '/claims', { scroll: false })
  }

  // Debounced: the search box used to fire a query on every keystroke.
  useEffect(() => {
    if (draftSearch === search) return
    const timer = setTimeout(() => setParam({ q: draftSearch || null }), 300)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftSearch])

  // Someone else changed the URL (back button, a shared link).
  useEffect(() => {
    setDraftSearch(search)
  }, [search])

  const state = trpc.insights.workspaceState.useQuery()
  const payerNames = trpc.insights.payerNames.useQuery()
  const carcNames = trpc.claims.carcNames.useQuery()
  const unworked = trpc.insights.unworkedDenials.useQuery()
  const utils = trpc.useUtils()
  const usage = useUsage()

  /**
   * Where a row goes when it is clicked.
   *
   * A claim that already has a row in the drafter is a claim somebody decided
   * to work. Sending it to the record dialog first put a summary of that
   * decision in front of the work it led to — and the dialog's own most likely
   * next click was the button back out to the drafter. So the row goes where
   * the work is, and the record is the secondary link beside it. That is a
   * straight inversion of what was here: the tiny "in the drafter" link that
   * used to sit in the status cell was the surface admitting which destination
   * it had backwards.
   *
   * ON WHAT AUTHORITY, given the events above exist precisely because nobody
   * knows. This one does not need them: a row with a worklistRowId is not a
   * guess about intent, it is a decision a colleague already recorded. The
   * events are here to say whether the dialog should shrink further for every
   * OTHER row — and CLAIM_TO_DRAFTER's two origins are what would show this
   * change was wrong, by counting the people who come straight back.
   */
  const openRow = (row: { id: string; worklistRowId?: string | null }) => {
    if (row.worklistRowId) {
      usage.track('CLAIM_TO_DRAFTER', 'list')
      router.push(`/worklist?row=${row.worklistRowId}`)
      return
    }
    setParam({ claim: row.id, open: null })
  }

  const filters = {
    ...(status === ALL ? {} : { status: status as 'PAID' }),
    ...(payer === ALL ? {} : { payer }),
    ...(carc === ALL ? {} : { carc }),
    ...(cpt === ALL ? {} : { cpt }),
    ...(aging === ALL ? {} : { aging: aging as '0-30' }),
    ...(search.trim() ? { search: search.trim() } : {}),
    ...(unsettled ? { unsettled: true } : {}),
  }

  const claims = trpc.insights.claimList.useQuery({
    ...filters,
    sort: sort as 'newest',
    limit: PAGE * pages,
  })

  // Keeps the previous totals on screen while the next ones load, for the same
  // reason the worklist search does: a strip that blinks through a skeleton on
  // every keystroke is harder to read than one that is briefly a moment stale.
  const summary = trpc.insights.claimSummary.useQuery(filters, {
    placeholderData: prev => prev,
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
      >
        {/*
          The specific dead end this answers: an A/R export imported through the
          denials box lands as worklist rows, and this page then correctly reports
          that no claims exist — which is almost impossible to diagnose from here.
          The upload box now catches that at preview time, but a workspace that
          hit it before still needs telling where its file went.
        */}
        {state.data?.hasDenials && (
          <p className="mx-auto mt-3 max-w-md rounded-md bg-amber-50 px-3 py-2 text-left text-sm text-amber-900">
            You have denials imported but no A/R snapshot. If the file you uploaded was an A/R
            export, it went onto the worklist instead of here — delete that import on{' '}
            <Link href="/connect" className="font-medium underline">
              Connect
            </Link>{' '}
            and upload it again.
          </p>
        )}
      </EmptyCard>
    )
  }

  const items = claims.data?.items ?? []

  // One chip per active filter, so a narrowed table can never read as the whole
  // snapshot. Keyed by the URL param, so removing one is setParam({ key: null }).
  const chips = [
    status === ALL ? null : { key: 'status', label: STATUS_LABEL[status] ?? status },
    payer === ALL ? null : { key: 'payer', label: payer },
    carc === ALL ? null : { key: 'carc', label: carc },
    cpt === ALL ? null : { key: 'cpt', label: `CPT ${cpt}` },
    aging === ALL ? null : { key: 'aging', label: AGING_LABEL[aging] ?? aging },
    unsettled ? { key: 'unsettled', label: 'Unsettled only' } : null,
  ].filter((c): c is { key: string; label: string } => c !== null)

  const filtered =
    status !== ALL ||
    payer !== ALL ||
    carc !== ALL ||
    cpt !== ALL ||
    aging !== ALL ||
    unsettled ||
    search.trim()

  return (
    <div className="space-y-4">
      <ClaimsSummary
        data={summary.data}
        isLoading={summary.isLoading}
        filtered={Boolean(filtered)}
        activeBucket={aging === ALL ? null : aging}
        onPickBucket={(bucket: AgingBucket | null) => setParam({ aging: bucket })}
        snapshot={
          state.data?.claimsSnapshotAt
            ? {
                filename: state.data.claimsSnapshotFilename ?? null,
                at: state.data.claimsSnapshotAt,
              }
            : null
        }
        unworked={unworked.data?.count ? { count: unworked.data.count } : null}
        onWorkDenied={() => addToWorklist.mutate()}
        working={addToWorklist.isPending}
      />

      {/*
        Search and the one cut a biller reaches for most stay on the page; the
        other five controls are behind a disclosure. The rule is what a control
        is FOR: finding a specific claim (search) or the single most common
        narrowing (unsettled) stays out; everything that refines a view you are
        already looking at folds away.

        An active filter ALWAYS shows as a removable chip. A filtered view that
        can look unfiltered is the one way hiding these controls could mislead
        somebody, so the chips are not optional dressing.
      */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="Search claim number, CPT or ICD-10…"
            value={draftSearch}
            onChange={e => setDraftSearch(e.target.value)}
            className="max-w-xs"
          />
          {/*
            "Unsettled", not "has a balance": this is a status test, because
            billed-minus-paid is column arithmetic a where clause cannot do. The
            label says what it actually filters on.
          */}
          <Button
            type="button"
            size="sm"
            variant={unsettled ? 'default' : 'outline'}
            onClick={() => setParam({ unsettled: unsettled ? null : '1' })}
            aria-pressed={unsettled}
          >
            Unsettled only
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-expanded={showFilters}
            onClick={() => setShowFilters(v => !v)}
          >
            <SlidersHorizontal className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            Filters
          </Button>

          {chips.map(chip => (
            <button
              key={chip.key}
              type="button"
              onClick={() => setParam({ [chip.key]: null })}
              className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-800 hover:bg-blue-100"
            >
              {chip.label}
              <X className="h-3 w-3" aria-hidden="true" />
              <span className="sr-only">Remove this filter</span>
            </button>
          ))}

          {filtered && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() =>
                setParam({ status: null, payer: null, carc: null, aging: null, unsettled: null, q: null })
              }
            >
              Clear
            </Button>
          )}
        </div>

        {showFilters && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-gray-200 bg-gray-50 p-2">
            <Select value={status} onValueChange={v => setParam({ status: v })}>
              <SelectTrigger className="w-40">
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
            <Select value={payer} onValueChange={v => setParam({ payer: v })}>
              <SelectTrigger className="w-52">
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
            <Select value={carc} onValueChange={v => setParam({ carc: v })}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="All reasons" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All reason codes</SelectItem>
                {(carcNames.data ?? []).map(code => (
                  <SelectItem key={code} value={code}>
                    {code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={aging} onValueChange={v => setParam({ aging: v })}>
              <SelectTrigger className="w-36">
                <SelectValue placeholder="Any age" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Any age</SelectItem>
                {Object.entries(AGING_LABEL).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={sort} onValueChange={v => setParam({ sort: v === 'newest' ? null : v })}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(SORT_LABEL).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
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
                <TableHead className="text-right">Billed</TableHead>
                <TableHead className="text-right">Balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {claims.isLoading &&
                [0, 1, 2, 3, 4].map(i => (
                  <TableRow key={i}>
                    <TableCell colSpan={6}>
                      <Skeleton className="h-6 w-full" />
                    </TableCell>
                  </TableRow>
                ))}

              {!claims.isLoading && items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-sm text-gray-500">
                    No claims match those filters.
                  </TableCell>
                </TableRow>
              )}

              {items.map(row => (
                <TableRow
                  key={row.id}
                  tabIndex={0}
                  role="button"
                  aria-label={
                    row.worklistRowId
                      ? `Open claim ${row.claimNumber ?? row.id} in the drafter`
                      : `Open claim ${row.claimNumber ?? row.id}`
                  }
                  className="cursor-pointer hover:bg-gray-50"
                  onClick={() => openRow(row)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      openRow(row)
                    }
                  }}
                >
                  {/* Three weights, not nine. The claim number is what someone
                      scans for and the balance is what they are scanning for it
                      about, so those two carry the ink; payer and status place
                      the row; the date confirms it once found and recedes until
                      then. Every money column is tabular so the digits stack
                      into a column the eye can run down.

                      CPT and Paid used to have columns of their own. CPT is
                      confirmation-after-finding, which is the detail's job, and
                      it is already searchable; Paid sat between Billed and
                      Balance, which bracket it, and was the one of the three
                      that stopped being read. */}
                  <TableCell className="font-mono text-sm font-medium text-gray-900">
                    {row.claimNumber ?? '—'}
                  </TableCell>
                  <TableCell className="text-sm text-gray-700">{row.payer ?? '—'}</TableCell>
                  <TableCell className="text-xs tabular-nums text-gray-500">
                    {row.serviceDate ? format(new Date(row.serviceDate), 'MM/dd/yyyy') : '—'}
                  </TableCell>
                  {/* Status and reason are two halves of one fact — a denial is
                      never read without asking what for — so they share a cell
                      rather than a column each. */}
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[row.status] ?? 'secondary'}>
                      {STATUS_LABEL[row.status] ?? row.status}
                    </Badge>
                    {row.carc && (
                      <span className="mt-0.5 block font-mono text-[11px] text-gray-500">
                        {row.carc}
                      </span>
                    )}
                    {/* Already being worked, so the row itself now leads to the
                        drafter and this is the way to the record instead. The
                        reconciliation question — the payer portal says $340,
                        what do we have — still needs somewhere to go, and it is
                        the rarer of the two. The row is a button, so this has
                        to stop the click reaching it. */}
                    {row.worklistRowId && (
                      <button
                        type="button"
                        onClick={e => {
                          e.stopPropagation()
                          setParam({ claim: row.id, open: null })
                        }}
                        className="mt-0.5 block text-[11px] font-medium text-blue-600 underline"
                      >
                        claim record
                      </button>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums text-gray-600">
                    {usd.format(row.billed)}
                  </TableCell>
                  <TableCell className="text-right text-sm font-semibold tabular-nums text-gray-900">
                    {row.balance > 0 ? (
                      usd.format(row.balance)
                    ) : (
                      <span className="font-normal text-gray-400">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {claims.data?.nextCursor && (
        <div className="text-center">
          <Button
            variant="outline"
            size="sm"
            disabled={claims.isFetching}
            onClick={() => setPages(p => p + 1)}
          >
            {claims.isFetching ? 'Loading…' : `Load more — showing ${items.length}`}
          </Button>
        </div>
      )}

      <ClaimDetailDialog
        claimId={openClaim}
        open={Boolean(openClaim)}
        // Both, always: a stale ?open= outliving the claim it belonged to would
        // greet the next reader with a section expanded on a record they have
        // not looked at yet.
        onOpenChange={open => !open && setParam({ claim: null, open: null })}
        section={
          openSection === 'denial' || openSection === 'codes' || openSection === 'work'
            ? openSection
            : null
        }
        onSection={id => setParam({ open: id })}
      />
    </div>
  )
}

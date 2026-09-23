'use client'

import { useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { trpc } from '@/lib/trpc/client'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ViewToggle, useAnalyticsView } from '@/components/charts/ViewToggle'
import { payerKey } from '@/lib/billing/payer-key'
import { pct, usd } from '@/lib/charts/format'
import { MIN_SAMPLE } from '@/lib/stats/min-sample'
import type { OutcomeGroup } from '@/lib/denials/outcomes'
import type { PayerRow } from '@/lib/insights/aggregate'
import { EmptyCard } from './EmptyCard'
import { NoWorkspace, isNoWorkspace } from './NoWorkspace'
import { PayerCharts } from './PayerCharts'
import { PAYER_SECTIONS, PayerDetailDialog, type PayerSectionId } from './PayerDetailDialog'

/**
 * One row per payer, joining the claims snapshot to the denial worklist.
 *
 * The sharpest thing a spreadsheet sort cannot give you: not "here are your
 * denials" but "Aetna denies 22% of what you send them, mostly CO-97, pays the
 * rest in 34 days, and you have 180 days to argue".
 *
 * The two halves come from different files and are kept in different columns.
 * Denial rate is of the snapshot; at-stake is of the worklist. They are never
 * added together.
 *
 * ── What the table is for, now that every row opens ──────────────────────
 *
 * Comparing payers against each other. Anything that describes one payer in
 * depth — collected and net collection, every reason they deny on, the appeal
 * record, where a response goes — lives in PayerDetailDialog, one click on.
 * So the cells carry one figure each: the grey suffixes that used to trail
 * most of them ("×3 +7", "13 open", "20.3%") are gone, except where the suffix
 * is the point — money about to expire, and the rulings behind a win rate.
 *
 * "Collected" came off entirely. Its percentage was paid over billed, which
 * reads as "we collect a fifth of what we bill" for any payer with a fee
 * schedule, and is the number a practice owner is most likely to screenshot
 * and most likely to misread. The panel shows it beside the net rate, where
 * the two can be read together.
 *
 * ── Why the open payer is in the URL ──────────────────────────────────────
 *
 * The same reason the open claim is: a biller sends a colleague "look at
 * Superior's appeals" as a link, and the link has to land there. It also means
 * coming back from the worklist returns to the panel that was open.
 */
export function PayerScorecard() {
  const payers = trpc.insights.payers.useQuery()
  const outcomes = trpc.insights.appealOutcomes.useQuery()
  const [view, setView] = useAnalyticsView()

  const router = useRouter()
  const params = useSearchParams()
  const openPayer = params.get('payer')
  const requested = params.get('open')
  const openSection = PAYER_SECTIONS.includes(requested as PayerSectionId)
    ? (requested as PayerSectionId)
    : null

  function setParam(next: Record<string, string | null>) {
    const q = new URLSearchParams(params.toString())
    for (const [key, value] of Object.entries(next)) {
      if (value === null || value === '') q.delete(key)
      else q.set(key, value)
    }
    router.replace(q.toString() ? `/payers?${q}` : '/payers', { scroll: false })
  }

  // Opening a payer always starts collapsed: a section left open from the last
  // payer is a section this one may not even have.
  const openRow = (payer: string) => setParam({ payer, open: null })

  const rows = useMemo(() => payers.data ?? [], [payers.data])

  /**
   * This payer's appeal history, looked up the way the ledger groups it.
   *
   * byPayer() keys on payerKey(), so matching on the display name would miss
   * "Aetna" against "AETNA " and quietly report a payer as never appealed.
   */
  const outcomeByPayer = useMemo(() => {
    const map = new Map<string, OutcomeGroup>()
    for (const group of outcomes.data?.byPayer ?? []) map.set(group.key, group)
    return map
  }, [outcomes.data])

  function outcomeFor(row: PayerRow): OutcomeGroup | null {
    const key = payerKey(row.payer)
    return key ? (outcomeByPayer.get(key) ?? null) : null
  }

  if (isNoWorkspace(payers.error)) return <NoWorkspace />

  if (payers.isLoading) {
    return (
      <Card>
        <CardContent className="space-y-3 p-4">
          {[0, 1, 2, 3].map(i => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </CardContent>
      </Card>
    )
  }

  if (rows.length === 0) {
    return (
      <EmptyCard
        title="No payers yet"
        need="Import a denials or A/R export and every payer in it gets a scorecard here."
      />
    )
  }

  const hasSnapshot = rows.some(r => r.claims > 0)
  const active = rows.find(r => r.payer === openPayer) ?? null

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <ViewToggle value={view} onChange={setView} />
      </div>

      {!hasSnapshot && (
        <p className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
          These rows come from your denials only. Import an A/R export to add denial rates and
          days to pay — those need every claim, not just the denied ones.
        </p>
      )}

      {view === 'chart' ? (
        <PayerCharts
          rows={rows}
          outcomes={outcomeByPayer}
          outcomesLoading={outcomes.isLoading}
          onSelect={openRow}
        />
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Payer</TableHead>
                  <TableHead className="text-right">Claims</TableHead>
                  <TableHead className="text-right">Billed</TableHead>
                  <TableHead className="text-right">Denial rate</TableHead>
                  <TableHead className="text-right">Days to pay</TableHead>
                  <TableHead>Top reason</TableHead>
                  <TableHead className="text-right">At stake</TableHead>
                  <TableHead className="text-right">Appeals won</TableHead>
                  <TableHead className="text-right">Window</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => (
                  <PayerTableRow
                    key={row.payer}
                    row={row}
                    won={outcomeFor(row)}
                    onOpen={() => openRow(row.payer)}
                  />
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Numbers only: the charts carry their own sources in their subtitles
          and their own footnote, and two footnotes read as one too many. */}
      {view === 'numbers' && (
        <p className="text-xs text-gray-400">
          Open a payer for the full picture. Rates come from your A/R export, at-stake from the
          worklist, appeals from outcomes you recorded — never added together.
        </p>
      )}

      <PayerDetailDialog
        row={active}
        outcomes={active ? outcomeFor(active) : null}
        open={Boolean(active)}
        onOpenChange={next => {
          // Both, always: a stale ?open= outliving the payer it belonged to
          // would open that section on whichever payer came next.
          if (!next) setParam({ payer: null, open: null })
        }}
        section={openSection}
        onSection={id => setParam({ open: id })}
      />
    </div>
  )
}

function PayerTableRow({
  row,
  won,
  onOpen,
}: {
  row: PayerRow
  won: OutcomeGroup | null
  onOpen: () => void
}) {
  const none = <span className="text-gray-400">—</span>
  return (
    <TableRow
      tabIndex={0}
      role="button"
      aria-label={`Open ${row.payer}`}
      className="cursor-pointer hover:bg-gray-50"
      onClick={onOpen}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
    >
      <TableCell className="font-medium text-gray-900">
        {row.payer}
        {/* The affordance a row cannot otherwise carry: a line of numbers
            gives hover nothing to underline. */}
        <span className="ml-1 text-gray-300" aria-hidden="true">
          ›
        </span>
      </TableCell>
      <TableCell className="text-right tabular-nums">{row.claims || none}</TableCell>
      <TableCell className="text-right tabular-nums">{row.claims ? usd(row.billed) : none}</TableCell>
      <TableCell
        className={`text-right tabular-nums ${(row.denialRate ?? 0) > 10 ? 'font-semibold text-red-600' : ''}`}
      >
        {row.denialRate === null ? none : pct(row.denialRate)}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {row.medianDaysToPay === null ? none : `${row.medianDaysToPay}d`}
      </TableCell>
      <TableCell>
        {row.topCarc ? (
          <span className="font-mono text-xs text-gray-700" title={row.topCarc.label}>
            {row.topCarc.carc}
          </span>
        ) : (
          none
        )}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {row.atStake > 0 ? <span className="font-medium">{usd(row.atStake)}</span> : none}
        {/*
          The one suffix that earns its place: the deadline half of the same
          money, not a second total. The same figure with three months to run
          and with nine days to run are different mornings.
        */}
        {row.expiringSoon > 0 && (
          <span
            className="ml-1.5 text-xs text-red-600"
            title={`${usd(row.expiringSoon)} of this closes within 14 days`}
          >
            {usd(row.expiringSoon)} in 14d
          </span>
        )}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        <WinCell won={won} />
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {row.filingWindowSource === 'payer' ? (
          `${row.filingWindowDays}d`
        ) : (
          <span
            className="text-gray-500"
            title="Estimated — this payer is not in the filing-window rule set"
          >
            ~{row.filingWindowDays}d
          </span>
        )}
      </TableCell>
    </TableRow>
  )
}

/**
 * Counts before rates, the same rule the panel's summary follows: "3 of 4"
 * until there are MIN_SAMPLE rulings, a percentage after. A dash, not 0%, when
 * they have never ruled — "0%" reads as "appealing them never works".
 */
function WinCell({ won }: { won: OutcomeGroup | null }) {
  if (!won || won.decided === 0) return <span className="text-gray-400">—</span>
  if (won.decided < MIN_SAMPLE || won.winRate === null) {
    return (
      <span className="text-gray-500" title="Too few rulings to quote a rate">
        {won.won} of {won.decided}
      </span>
    )
  }
  return (
    <>
      {Math.round(won.winRate)}%
      <span className="ml-1 text-xs text-gray-400">of {won.decided}</span>
    </>
  )
}

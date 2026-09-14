'use client'

import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
import { trpc } from '@/lib/trpc/client'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { pct, usd } from '@/lib/charts/format'
import { EmptyCard } from './EmptyCard'
import type { OutcomeGroup } from '@/lib/denials/outcomes'

/**
 * Which arguments actually get paid.
 *
 * Every other card on this page is a fact about the practice that a fresh
 * export would rebuild tomorrow. This one is a fact about the payers, assembled
 * only from what this workspace sent and what came back, and there is no file
 * to restore it from.
 *
 * ── Why the thin rows are labelled rather than hidden ─────────────────────
 *
 * A 100% win rate on two appeals is not a finding, and a biller who reads it as
 * one stops appealing things they should. But dropping thin rows entirely is
 * worse: the table then silently omits the payer someone is asking about, and
 * absence reads as "no denials from them". So every row shows its denominator
 * and anything under the threshold is marked as too thin to act on.
 *
 * ── Why coverage is at the top ────────────────────────────────────────────
 *
 * A win rate drawn from the 12 submissions somebody closed out, of 300 sent, is
 * a number about those 12 — and wins get closed out more reliably than losses,
 * so a half-filled ledger reads high. The caveat travels with the number rather
 * than sitting in a footnote.
 */

/** Under this many rulings, a rate is noise. Shown, but never as a finding. */
const THIN = 5

function RateCell({ g }: { g: OutcomeGroup }) {
  if (g.winRate === null) {
    return <span className="text-gray-400">—</span>
  }
  const thin = g.decided < THIN
  return (
    <span className={thin ? 'text-gray-500' : 'font-medium text-gray-900'}>
      {pct(g.winRate)}
      {thin && <span className="ml-1 text-xs font-normal text-gray-400">thin</span>}
    </span>
  )
}

function OutcomeTable({ groups, header }: { groups: OutcomeGroup[]; header: string }) {
  if (groups.length === 0) {
    return <EmptyCard title="Nothing decided yet" need="Record an outcome on a sent appeal." />
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{header}</TableHead>
          <TableHead className="text-right">Decided</TableHead>
          <TableHead className="text-right">Won</TableHead>
          <TableHead className="text-right">Win rate</TableHead>
          <TableHead className="text-right">Recovered</TableHead>
          <TableHead className="text-right">Median days</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {groups.map(g => (
          <TableRow key={g.key}>
            <TableCell className="max-w-[18rem] truncate" title={g.label}>
              {g.label}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {g.decided}
              {g.pending > 0 && (
                <span className="ml-1 text-xs text-gray-400">+{g.pending} open</span>
              )}
            </TableCell>
            <TableCell className="text-right tabular-nums">{g.won}</TableCell>
            <TableCell className="text-right tabular-nums">
              <RateCell g={g} />
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {g.recovered > 0 ? usd(g.recovered) : <span className="text-gray-400">—</span>}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {g.medianDays ?? <span className="text-gray-400">—</span>}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export function AppealOutcomes() {
  const outcomes = trpc.insights.appealOutcomes.useQuery()
  const awaiting = trpc.worklist.awaitingOutcome.useQuery({ limit: 100 })

  if (outcomes.isLoading) return <Skeleton className="h-64 w-full" />
  if (!outcomes.data) return null

  const { coverage, overall, byPayerAndCode, byPayer, byArtifact } = outcomes.data
  const open = awaiting.data ?? []

  if (coverage.total === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>What actually gets paid</CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyCard
            title="No appeals sent yet"
            need="Draft a response on the worklist, send it, and record what comes back. This table is built from those answers and cannot be imported from anywhere."
          />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-2">
          <span>What actually gets paid</span>
          <Badge variant={coverage.rate !== null && coverage.rate >= 60 ? 'success' : 'warning'}>
            {coverage.resolved} of {coverage.total} closed out
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/*
          The caveat before the numbers, not after them. Wins get recorded more
          reliably than losses, so a half-filled ledger reads optimistically —
          and that is exactly the direction that costs money to believe.
        */}
        {coverage.rate !== null && coverage.rate < 60 && (
          <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
            <AlertTriangle
              className="mt-0.5 h-4 w-4 shrink-0 text-amber-700"
              aria-hidden="true"
            />
            <div>
              <p className="font-medium text-amber-900">
                {coverage.pending} sent appeals have no outcome recorded.
              </p>
              <p className="text-amber-800">
                Every rate below is drawn from the {coverage.resolved} that do. A payer that
                denied an appeal is easy to forget and a payment is not, so a partly-filled
                ledger reads better than reality.{' '}
                {open.length > 0 && (
                  <Link href="/worklist" className="font-medium underline">
                    Close them out on the worklist
                  </Link>
                )}
              </p>
            </div>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500">Win rate</p>
            <p className="text-2xl font-semibold tabular-nums">
              {overall.winRate === null ? '—' : pct(overall.winRate)}
            </p>
            <p className="text-xs text-gray-500">{overall.decided} decided</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500">Recovered</p>
            <p className="text-2xl font-semibold tabular-nums">{usd(overall.recovered)}</p>
            <p className="text-xs text-gray-500">of {usd(overall.atStake)} decided</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500">Median turnaround</p>
            <p className="text-2xl font-semibold tabular-nums">
              {overall.medianDays === null ? '—' : `${overall.medianDays}d`}
            </p>
            <p className="text-xs text-gray-500">send to determination</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500">Still open</p>
            <p className="text-2xl font-semibold tabular-nums">{overall.pending}</p>
            <p className="text-xs text-gray-500">
              {overall.noResponse > 0 ? `${overall.noResponse} never answered` : 'awaiting a ruling'}
            </p>
          </div>
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-gray-900">
            By payer and reason code
          </p>
          <p className="mb-2 text-xs text-gray-500">
            The row that decides whether an appeal is worth writing. Sorted by how many have
            actually been decided, because that is what makes a rate mean anything.
          </p>
          <OutcomeTable groups={byPayerAndCode} header="Payer · code" />
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <div>
            <p className="mb-2 text-sm font-medium text-gray-900">By payer</p>
            <OutcomeTable groups={byPayer} header="Payer" />
          </div>
          <div>
            <p className="mb-2 text-sm font-medium text-gray-900">
              By instrument
            </p>
            <p className="mb-2 text-xs text-gray-500">
              Which document works. If a reconsideration beats an appeal letter here, the
              playbook that picks between them is wrong — and this is the only place that
              would show it.
            </p>
            <OutcomeTable groups={byArtifact} header="Document" />
          </div>
        </div>

        {outcomes.data.truncated && (
          <p className="text-xs text-gray-500">
            Drawn from the most recent submissions only; older attempts are not counted.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

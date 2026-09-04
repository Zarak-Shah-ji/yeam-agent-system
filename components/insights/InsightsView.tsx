'use client'

import Link from 'next/link'
import { AlertTriangle, ShieldCheck } from 'lucide-react'
import { trpc } from '@/lib/trpc/client'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { RevenueChart } from '@/components/analytics/RevenueChart'
import { DenialRateChart } from '@/components/analytics/DenialRateChart'
import { AgingChart } from './AgingChart'
import { EmptyCard } from './EmptyCard'
import { NoWorkspace, isNoWorkspace } from './NoWorkspace'

const usd = new Intl.NumberFormat('en-US', {
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

/** A percentage, or a dash. 0/0 is not zero and must not render as 0%. */
function pct(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : `${value.toFixed(1)}%`
}

function monthLabel(month: string): string {
  const [year, m] = month.split('-')
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m) - 1]} ${year.slice(2)}`
}

function Tile({
  label,
  value,
  sub,
  tone = 'default',
  loading,
}: {
  label: string
  value: string
  sub?: string
  tone?: 'default' | 'danger' | 'good'
  loading?: boolean
}) {
  const colour =
    tone === 'danger' ? 'text-red-600' : tone === 'good' ? 'text-green-700' : 'text-gray-900'
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
        {loading ? (
          <Skeleton className="mt-1 h-8 w-24" />
        ) : (
          <p className={`mt-1 text-2xl font-bold ${colour}`}>{value}</p>
        )}
        {sub && <p className="mt-0.5 text-xs text-gray-500">{sub}</p>}
      </CardContent>
    </Card>
  )
}

/**
 * The customer's own numbers.
 *
 * Two independent sources feed this page and they are never mixed: the claims
 * snapshot supplies every rate and the aging report, and the denial worklist
 * supplies what is still recoverable. A customer who uploaded both files has the
 * same denial in each, so adding them would inflate everything.
 *
 * Where a source is missing the card says which file would fill it, rather than
 * rendering zeroes that read as a real measurement.
 */
export function InsightsView() {
  const overview = trpc.insights.overview.useQuery()
  const aging = trpc.insights.aging.useQuery()
  const revenue = trpc.insights.revenue.useQuery()
  const denials = trpc.insights.denials.useQuery()
  const carcs = trpc.insights.carcs.useQuery()
  const codes = trpc.insights.codes.useQuery()
  const recovery = trpc.insights.recovery.useQuery()

  if (isNoWorkspace(overview.error)) return <NoWorkspace />

  const data = overview.data
  const loading = overview.isLoading
  const claims = data?.claims ?? null
  const denialSide = data?.denials ?? null

  if (!loading && !data?.hasClaims && !data?.hasDenials) {
    return (
      <EmptyCard
        title="Nothing imported yet"
        need="Import a denials export to see what is recoverable, or an A/R export to see collection rates and aging."
      />
    )
  }

  const revenueData = (revenue.data ?? []).map(r => ({
    date: monthLabel(r.month),
    billed: r.billed,
    collected: r.paid,
  }))

  const denialSeries = (denials.data?.months ?? [])
    .filter(m => m.denialRate !== null)
    .map(m => ({ date: monthLabel(m.month), rate: m.denialRate as number }))

  return (
    <div className="space-y-5">
      {data?.truncated && (
        <p className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            This workspace holds more rows than one view reads at once, so every total below is a
            floor rather than a total. Filter to a narrower date range, or get in touch and
            we&rsquo;ll raise the ceiling.
          </span>
        </p>
      )}

      {claims?.statusDerived && (
        <p className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            Your A/R export had no status column, so each claim&rsquo;s status was worked out from
            the amounts. Denial and collection rates below are estimates.
          </span>
        </p>
      )}

      {/* Snapshot side. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          label="Billed"
          value={claims ? usd.format(claims.billed) : '—'}
          sub={claims ? `${claims.total} claims` : 'Needs an A/R export'}
          loading={loading}
        />
        <Tile
          label="Collected"
          value={claims ? usd.format(claims.paid) : '—'}
          sub={claims ? `${pct(claims.grossCollectionRate)} of billed` : 'Needs an A/R export'}
          tone="good"
          loading={loading}
        />
        <Tile
          label="Outstanding A/R"
          value={claims ? usd.format(claims.outstanding) : '—'}
          sub={claims ? 'Still owed by payers' : 'Needs an A/R export'}
          loading={loading}
        />
        <Tile
          label="Denial rate"
          value={claims ? pct(claims.denialRate) : '—'}
          sub={claims ? `${claims.denied} of ${claims.total} claims` : 'Needs an A/R export'}
          tone={claims && (claims.denialRate ?? 0) > 10 ? 'danger' : 'default'}
          loading={loading}
        />
      </div>

      {/* Worklist side. Deliberately a separate row — different question. */}
      {denialSide && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Tile label="At stake" value={usd.format(denialSide.atStake)} sub={`${denialSide.open} open denials`} />
          <Tile
            label="Expiring in 14 days"
            value={String(denialSide.expiringSoon)}
            sub={`${usd.format(denialSide.expiringSoonBilled)} at risk`}
            tone={denialSide.expiringSoon > 0 ? 'danger' : 'default'}
          />
          <Tile label="Recovered" value={usd.format(denialSide.recovered)} sub="Marked paid on the worklist" tone="good" />
          <Tile
            label="Not worth working"
            value={String(denialSide.notRecoverable + denialSide.expired)}
            sub="Patient responsibility or past the window"
          />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Billed against collected</CardTitle>
          </CardHeader>
          <CardContent>
            {revenueData.length > 0 ? (
              <RevenueChart data={revenueData} />
            ) : (
              <EmptyCard
                title="No revenue history"
                need="An A/R export with service dates gives billed against collected by month."
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Outstanding A/R by age</CardTitle>
          </CardHeader>
          <CardContent>
            {aging.data && aging.data.total > 0 ? (
              <>
                <AgingChart data={aging.data.buckets} />
                {aging.data.undated.count > 0 && (
                  <p className="mt-2 text-xs text-amber-700">
                    {usd.format(aging.data.undated.amount)} across {aging.data.undated.count} claims
                    had no usable date and could not be aged.
                  </p>
                )}
              </>
            ) : (
              <EmptyCard
                title="No outstanding balance"
                need="An A/R export shows what each payer still owes, bucketed by age."
              />
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {denials.data?.basis === 'snapshot' ? 'Denial rate by month' : 'Denials by month'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {denials.data?.basis === 'snapshot' && denialSeries.length > 0 ? (
            <DenialRateChart data={denialSeries} />
          ) : (denials.data?.months.length ?? 0) > 0 ? (
            <div>
              {/* Without a claims snapshot there is no denominator. Counts are
                  the honest thing to show; a rate here would always be 100%. */}
              <p className="mb-3 text-sm text-gray-500">
                Counts, not a rate — a denial rate needs an A/R export to divide by.
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Month</TableHead>
                    <TableHead className="text-right">Denials</TableHead>
                    <TableHead className="text-right">Billed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {denials.data!.months.map(m => (
                    <TableRow key={m.month}>
                      <TableCell>{monthLabel(m.month)}</TableCell>
                      <TableCell className="text-right">{m.denied}</TableCell>
                      <TableCell className="text-right">{usd.format(m.deniedBilled)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <EmptyCard title="No denial history" need="Import a denials or A/R export to see this." />
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Why claims are being denied</CardTitle>
          </CardHeader>
          <CardContent>
            {(carcs.data?.length ?? 0) > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-20">Code</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Needs</TableHead>
                    <TableHead className="text-right">At stake</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {carcs.data!.map(row => (
                    <TableRow key={row.carc}>
                      <TableCell className="font-mono text-xs">{row.carc}</TableCell>
                      <TableCell className="max-w-[16rem] truncate text-sm" title={row.label}>
                        {row.label}
                        <span className="ml-1 text-gray-400">×{row.count}</span>
                      </TableCell>
                      <TableCell>
                        <Badge variant={REMEDY_VARIANT[row.remedy] ?? 'secondary'}>
                          {row.remedyLabel}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">{usd.format(row.atStake)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <EmptyCard title="No denials on the worklist" need="Import a denials export to see this." />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recovery</CardTitle>
          </CardHeader>
          <CardContent>
            {recovery.data && recovery.data.stages.some(s => s.count > 0) ? (
              <div className="space-y-2">
                {recovery.data.stages.map(stage => {
                  const total = recovery.data!.stages.reduce((n, s) => n + s.count, 0) || 1
                  return (
                    <div key={stage.status}>
                      <div className="flex items-baseline justify-between text-sm">
                        <span className="text-gray-700">{stage.label}</span>
                        <span className="text-gray-500">
                          {stage.count} · {usd.format(stage.billed)}
                        </span>
                      </div>
                      <div className="mt-1 h-2 rounded-full bg-gray-100">
                        <div
                          className={`h-2 rounded-full ${stage.status === 'PAID' ? 'bg-green-500' : stage.status === 'DEAD' ? 'bg-gray-300' : 'bg-blue-400'}`}
                          style={{ width: `${(stage.count / total) * 100}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
                <p className="pt-2 text-sm text-gray-600">
                  {usd.format(recovery.data.recovered)} recovered across{' '}
                  {recovery.data.recoveredCount} denials.
                </p>
              </div>
            ) : (
              <EmptyCard title="Nothing worked yet" need="Draft a response on the worklist and this fills in." />
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Procedures losing the most money</CardTitle>
          </CardHeader>
          <CardContent>
            {(codes.data?.cpt.length ?? 0) > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-24">CPT</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Denied</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {codes.data!.cpt.map(row => (
                    <TableRow key={row.code}>
                      <TableCell className="font-mono text-xs">{row.code}</TableCell>
                      <TableCell className="max-w-[18rem] truncate text-sm text-gray-600">
                        {/* Blank, not the code echoed back at itself. */}
                        {row.description ?? <span className="text-gray-400">—</span>}
                      </TableCell>
                      <TableCell className="text-right">
                        {usd.format(row.deniedBilled)}
                        <span className="ml-1 text-xs text-gray-400">×{row.deniedCount}</span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <EmptyCard title="No procedure data" need="Import a file with a CPT column to see this." />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Diagnoses on denied claims</CardTitle>
          </CardHeader>
          <CardContent>
            {(codes.data?.icd10.length ?? 0) > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-28">ICD-10</TableHead>
                    <TableHead className="text-right">Claims</TableHead>
                    <TableHead className="text-right">Denied</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {codes.data!.icd10.map(row => (
                    <TableRow key={row.code}>
                      <TableCell className="font-mono text-xs">{row.code}</TableCell>
                      <TableCell className="text-right">{row.count}</TableCell>
                      <TableCell className="text-right">{usd.format(row.deniedBilled)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <EmptyCard title="No diagnosis data" need="Import a file with an ICD-10 column to see this." />
            )}
          </CardContent>
        </Card>
      </div>

      <p className="flex items-center gap-1.5 text-xs text-gray-400">
        <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
        Everything here is computed from your imports. Patient names, member IDs and dates of birth
        were never read.{' '}
        <Link href="/connect" className="underline">
          Manage imports
        </Link>
      </p>
    </div>
  )
}

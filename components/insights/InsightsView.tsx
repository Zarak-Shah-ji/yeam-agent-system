'use client'

import { useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ShieldCheck } from 'lucide-react'
import { trpc } from '@/lib/trpc/client'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { RevenueChart } from '@/components/analytics/RevenueChart'
import { DenialCountChart, DenialRateChart } from '@/components/analytics/DenialRateChart'
import { RankedBar } from '@/components/charts/RankedBar'
import { ViewToggle, useAnalyticsView } from '@/components/charts/ViewToggle'
import { ordinalSteps, useChartTheme } from '@/lib/charts/theme'
import { monthLabel, pct, usd, usdCompact } from '@/lib/charts/format'
import { AgingChart } from './AgingChart'
import { CodeClaimsDialog } from './CodeClaimsDialog'
import { AppealOutcomes } from './AppealOutcomes'
import { EmptyCard } from './EmptyCard'
import { NoWorkspace, isNoWorkspace } from './NoWorkspace'

const REMEDY_VARIANT: Record<string, 'default' | 'success' | 'warning' | 'secondary' | 'destructive' | 'outline'> = {
  corrected_claim: 'warning',
  reprocess: 'default',
  appeal: 'outline',
  not_recoverable: 'secondary',
  unknown: 'secondary',
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
 *
 * Every card below has two renderings of exactly the same figures — a chart and
 * a table — behind the Charts/Numbers toggle. Charts lead because the first
 * question anyone brings here is "which way is this going". The table is the
 * other half of that bargain: a value that can only be got at by hovering a
 * chart is not a value the reader can actually use, so nothing is chart-only.
 *
 * The KPI tiles stay put in both views. A number is already the right form for
 * a single current value; a one-bar chart of it would be worse.
 */
export function InsightsView() {
  const overview = trpc.insights.overview.useQuery()
  const aging = trpc.insights.aging.useQuery()
  const revenue = trpc.insights.revenue.useQuery()
  const denials = trpc.insights.denials.useQuery()
  const carcs = trpc.insights.carcs.useQuery()
  const codes = trpc.insights.codes.useQuery()
  const recovery = trpc.insights.recovery.useQuery()

  const [view, setView] = useAnalyticsView()
  const theme = useChartTheme()
  /**
   * Which procedure code the reader has opened, if any.
   *
   * Local rather than in the URL, unlike the claims table: this is a glance at
   * an aggregate on the way to the claims page, not a view worth sharing a link
   * to. The link worth sharing is the one the dialog hands off to.
   */
  const [openCode, setOpenCode] = useState<string | null>(null)

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

  const revenueMonths = revenue.data ?? []
  const revenueData = revenueMonths.map(r => ({
    date: monthLabel(r.month),
    billed: r.billed,
    collected: r.paid,
  }))

  const denialMonths = denials.data?.months ?? []
  const denialSeries = denialMonths
    .filter(m => m.denialRate !== null)
    .map(m => ({ date: monthLabel(m.month), rate: m.denialRate as number }))
  const denialCounts = denialMonths.map(m => ({ date: monthLabel(m.month), denied: m.denied }))

  // Sorted here, once, so both renderings agree. topCarcs picks its top ten by
  // total billed but this card plots what is still at stake, and RankedBar
  // re-ranks by the value it is given — so the Numbers table used to list the
  // same ten rows in a visibly different order from the chart beside it.
  const rankedCarcs = [...(carcs.data ?? [])].sort((a, b) => b.atStake - a.atStake)

  const recoveryStages = recovery.data?.stages ?? []
  const stageFills = ordinalSteps(theme, recoveryStages.length)

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

      {/* One control, above everything it scopes — never a toggle per card. */}
      <div className="flex justify-end">
        <ViewToggle value={view} onChange={setView} />
      </div>

      {/* Snapshot side. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          label="Billed"
          value={claims ? usd(claims.billed) : '—'}
          sub={claims ? `${claims.total} claims` : 'Needs an A/R export'}
          loading={loading}
        />
        <Tile
          label="Collected"
          value={claims ? usd(claims.paid) : '—'}
          sub={claims ? `${pct(claims.grossCollectionRate)} of billed` : 'Needs an A/R export'}
          tone="good"
          loading={loading}
        />
        <Tile
          label="Outstanding A/R"
          value={claims ? usd(claims.outstanding) : '—'}
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
          <Tile label="At stake" value={usd(denialSide.atStake)} sub={`${denialSide.open} open denials`} />
          <Tile
            label="Expiring in 14 days"
            value={String(denialSide.expiringSoon)}
            sub={`${usd(denialSide.expiringSoonBilled)} at risk`}
            tone={denialSide.expiringSoon > 0 ? 'danger' : 'default'}
          />
          <Tile label="Recovered" value={usd(denialSide.recovered)} sub="Marked paid on the worklist" tone="good" />
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
              view === 'chart' ? (
                <RevenueChart data={revenueData} />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Month</TableHead>
                      <TableHead className="text-right">Billed</TableHead>
                      <TableHead className="text-right">Collected</TableHead>
                      <TableHead className="text-right">Rate</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {revenueMonths.map(row => (
                      <TableRow key={row.month}>
                        <TableCell>{monthLabel(row.month)}</TableCell>
                        <TableCell className="text-right tabular-nums">{usd(row.billed)}</TableCell>
                        <TableCell className="text-right tabular-nums">{usd(row.paid)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {/* Same guard as everywhere else: 0 billed has no rate. */}
                          {pct(row.billed > 0 ? (row.paid / row.billed) * 100 : null)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )
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
            {aging.isLoading ? (
              <Skeleton className="h-64 w-full" />
            ) : aging.data && aging.data.total > 0 ? (
              <>
                {view === 'chart' ? (
                  <AgingChart data={aging.data.buckets} />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Age</TableHead>
                        <TableHead className="text-right">Outstanding</TableHead>
                        <TableHead className="text-right">Claims</TableHead>
                        <TableHead className="text-right">Avg age</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {aging.data.buckets.map(bucket => (
                        <TableRow key={bucket.bucket}>
                          <TableCell>{bucket.bucket} days</TableCell>
                          <TableCell className="text-right tabular-nums">{usd(bucket.amount)}</TableCell>
                          <TableCell className="text-right tabular-nums">{bucket.count}</TableCell>
                          {/* The band says 91-120; this says the claims in it
                              average 104 days and the oldest is past a year.
                              An empty bucket shows a dash, never 0d. */}
                          <TableCell className="text-right tabular-nums">
                            {bucket.avgDays === null ? (
                              <span className="text-gray-400">—</span>
                            ) : (
                              <>
                                {bucket.avgDays}d
                                {bucket.oldestDays !== null &&
                                  bucket.oldestDays !== bucket.avgDays && (
                                    <span className="ml-1 text-xs text-gray-400">
                                      oldest {bucket.oldestDays}d
                                    </span>
                                  )}
                              </>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
                {aging.data.undated.count > 0 && (
                  <p className="mt-2 text-xs text-amber-700">
                    {usd(aging.data.undated.amount)} across {aging.data.undated.count} claims
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
            view === 'chart' ? (
              <DenialRateChart data={denialSeries} />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Month</TableHead>
                    <TableHead className="text-right">Claims</TableHead>
                    <TableHead className="text-right">Denied</TableHead>
                    <TableHead className="text-right">Denial rate</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {denialMonths.map(m => (
                    <TableRow key={m.month}>
                      <TableCell>{monthLabel(m.month)}</TableCell>
                      <TableCell className="text-right tabular-nums">{m.total}</TableCell>
                      <TableCell className="text-right tabular-nums">{m.denied}</TableCell>
                      <TableCell className="text-right tabular-nums">{pct(m.denialRate)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )
          ) : denialMonths.length > 0 ? (
            <div>
              {/* Without a claims snapshot there is no denominator. Counts are
                  the honest thing to show; a rate here would always be 100%.
                  The chart plots those counts and is labelled as counts. */}
              <p className="mb-3 text-sm text-gray-500">
                Counts, not a rate — a denial rate needs an A/R export to divide by.
              </p>
              {view === 'chart' ? (
                <DenialCountChart data={denialCounts} />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Month</TableHead>
                      <TableHead className="text-right">Denials</TableHead>
                      <TableHead className="text-right">Billed</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {denialMonths.map(m => (
                      <TableRow key={m.month}>
                        <TableCell>{monthLabel(m.month)}</TableCell>
                        <TableCell className="text-right tabular-nums">{m.denied}</TableCell>
                        <TableCell className="text-right tabular-nums">{usd(m.deniedBilled)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
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
            {carcs.isLoading ? (
              <Skeleton className="h-64 w-full" />
            ) : rankedCarcs.length > 0 ? (
              view === 'chart' ? (
                <RankedBar
                  // Ranked by money, not by count — ten cheap denials matter
                  // less than one expensive one, and the table sorts the same way.
                  //
                  // The axis carries the code alone. It used to carry
                  // "CO-97 · <the whole reason>" inside a 27-character budget,
                  // which meant every label read "CO-97 · Payment adjusted be…"
                  // and the reason was unreachable in this view. A code never
                  // truncates; the sentence goes in the tooltip, where there is
                  // room for it.
                  data={rankedCarcs.map(row => ({
                    key: row.carc,
                    label: row.carc,
                    value: row.atStake,
                    note: `${row.count} denials · ${row.remedyLabel}`,
                    detail: `${row.label}. ${row.note}`,
                  }))}
                  format={usdCompact}
                  labelWidth={72}
                />
              ) : (
                /* Fixed layout so the reason column keeps the width given to
                   it. Under auto layout a long sentence widens its own column
                   until the money is squeezed off the edge, and max-width on a
                   cell does not reliably stop it. */
                <Table className="table-fixed">
                  <TableHeader>
                    <TableRow>
                      {/* Wide enough for the longest value canonicalCarc can
                          emit, which is the literal "UNKNOWN", not a code. */}
                      <TableHead className="w-20">Code</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead className="w-28">Needs</TableHead>
                      <TableHead className="w-24 text-right">At stake</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rankedCarcs.map(row => (
                      <TableRow key={row.carc}>
                        <TableCell className="align-top font-mono text-xs">{row.carc}</TableCell>
                        {/* Wraps to as many lines as it needs. This used to be
                            truncated to one line with the full text hidden
                            behind a title attribute, which is not a place
                            anyone reads. */}
                        <TableCell className="align-top text-sm whitespace-normal">
                          <span className="text-gray-900">{row.label}</span>
                          <span className="ml-1 text-gray-400">×{row.count}</span>
                          {/* What to do about it — the half a biller acts on. */}
                          <span className="mt-0.5 block text-xs text-gray-500">{row.note}</span>
                        </TableCell>
                        <TableCell className="align-top">
                          <Badge variant={REMEDY_VARIANT[row.remedy] ?? 'secondary'}>
                            {row.remedyLabel}
                          </Badge>
                        </TableCell>
                        <TableCell className="align-top text-right tabular-nums">
                          {usd(row.atStake)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )
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
            {recovery.data && recoveryStages.some(s => s.count > 0) ? (
              <div className="space-y-2">
                {view === 'chart' ? (
                  <RankedBar
                    data={recoveryStages.map(stage => ({
                      key: stage.status,
                      label: stage.label,
                      value: stage.count,
                      note: usd(stage.billed),
                    }))}
                    format={v => String(Math.round(v))}
                    labelWidth={90}
                    // The pipeline runs To work → Drafted → Sent → Recovered,
                    // and that sequence is the chart. Ranking it by size would
                    // shuffle the stages out of the order the ramp encodes.
                    keepOrder
                    // Stages are an ordered sequence, so they take the one-hue
                    // ramp rather than a colour each: the reader should see how
                    // far along a stage is without reading the labels.
                    colors={stageFills}
                  />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Stage</TableHead>
                        <TableHead className="text-right">Denials</TableHead>
                        <TableHead className="text-right">Billed</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {recoveryStages.map(stage => (
                        <TableRow key={stage.status}>
                          <TableCell>{stage.label}</TableCell>
                          <TableCell className="text-right tabular-nums">{stage.count}</TableCell>
                          <TableCell className="text-right tabular-nums">{usd(stage.billed)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
                <p className="pt-2 text-sm text-gray-600">
                  {usd(recovery.data.recovered)} recovered across{' '}
                  {recovery.data.recoveredCount}{' '}
                  {recovery.data.recoveredCount === 1 ? 'denial' : 'denials'}.
                </p>
              </div>
            ) : (
              <EmptyCard title="Nothing worked yet" need="Draft a response on the worklist and this fills in." />
            )}
          </CardContent>
        </Card>
      </div>

      {/*
        Directly under the recovery funnel, which is the card it answers. The
        funnel says how many denials reached "Sent"; this says which of those
        the payer actually paid, and it is the only thing on this page built
        from the workspace's own history rather than from an export.
      */}
      <AppealOutcomes />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Procedures losing the most money</CardTitle>
          </CardHeader>
          <CardContent>
            {codes.isLoading ? (
              <Skeleton className="h-64 w-full" />
            ) : (codes.data?.cpt.length ?? 0) > 0 ? (
              view === 'chart' ? (
                <RankedBar
                  data={codes.data!.cpt.map(row => ({
                    key: row.code,
                    label: row.code,
                    value: row.deniedBilled,
                    // Never silently swaps meaning: the count rides along
                    // whether or not the code has a description.
                    note: `${row.deniedCount} denied`,
                    detail: row.description ?? undefined,
                  }))}
                  format={usdCompact}
                  labelWidth={72}
                  onSelect={setOpenCode}
                />
              ) : (
                <Table className="table-fixed">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-20">CPT</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="w-32 text-right">Denied</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {codes.data!.cpt.map(row => (
                      <TableRow
                        key={row.code}
                        tabIndex={0}
                        role="button"
                        aria-label={`Show denied claims for ${row.code}`}
                        className="cursor-pointer hover:bg-gray-50"
                        onClick={() => setOpenCode(row.code)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            setOpenCode(row.code)
                          }
                        }}
                      >
                        <TableCell className="align-top font-mono text-xs">{row.code}</TableCell>
                        {/* Wraps rather than truncating — and this cell did not
                            even carry a title attribute, so a clipped
                            description had no way to be read at all. */}
                        <TableCell className="align-top text-sm whitespace-normal text-gray-600">
                          {/* Blank, not the code echoed back at itself. */}
                          {row.description ?? <span className="text-gray-400">—</span>}
                        </TableCell>
                        <TableCell className="align-top text-right tabular-nums">
                          {usd(row.deniedBilled)}
                          <span className="ml-1 text-xs text-gray-400">×{row.deniedCount}</span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )
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
              view === 'chart' ? (
                <RankedBar
                  data={codes.data!.icd10.map(row => ({
                    key: row.code,
                    label: row.code,
                    value: row.deniedBilled,
                    note: `${row.count} claims`,
                  }))}
                  format={usdCompact}
                  labelWidth={72}
                />
              ) : (
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
                        <TableCell className="text-right tabular-nums">{row.count}</TableCell>
                        <TableCell className="text-right tabular-nums">{usd(row.deniedBilled)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )
            ) : (
              <EmptyCard title="No diagnosis data" need="Import a file with an ICD-10 column to see this." />
            )}
          </CardContent>
        </Card>
      </div>

      <CodeClaimsDialog
        code={openCode}
        open={openCode !== null}
        onOpenChange={open => !open && setOpenCode(null)}
      />

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

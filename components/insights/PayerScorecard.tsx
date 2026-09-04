'use client'

import { trpc } from '@/lib/trpc/client'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { EmptyCard } from './EmptyCard'
import { NoWorkspace, isNoWorkspace } from './NoWorkspace'

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

function pct(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1)}%`
}

/**
 * One row per payer, joining the claims snapshot to the denial worklist.
 *
 * The sharpest thing a spreadsheet sort cannot give you: not "here are your
 * denials" but "Aetna denies 22% of what you send them, mostly CO-97, pays the
 * rest in 34 days, and you have 180 days to argue".
 *
 * The two halves come from different files and are kept in different columns.
 * Denial rate and collection rate are of the snapshot; at-stake is of the
 * worklist. They are never added together.
 */
export function PayerScorecard() {
  const payers = trpc.insights.payers.useQuery()

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

  const rows = payers.data ?? []
  if (rows.length === 0) {
    return (
      <EmptyCard
        title="No payers yet"
        need="Import a denials or A/R export and every payer in it gets a scorecard here."
      />
    )
  }

  const hasSnapshot = rows.some(r => r.claims > 0)

  return (
    <div className="space-y-3">
      {!hasSnapshot && (
        <p className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
          These rows come from your denials only. Import an A/R export to add denial rates,
          collection rates and days to pay — those need every claim, not just the denied ones.
        </p>
      )}

      <Card>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Payer</TableHead>
                <TableHead className="text-right">Claims</TableHead>
                <TableHead className="text-right">Billed</TableHead>
                <TableHead className="text-right">Collected</TableHead>
                <TableHead className="text-right">Denial rate</TableHead>
                <TableHead className="text-right">Days to pay</TableHead>
                <TableHead>Top reason</TableHead>
                <TableHead className="text-right">At stake</TableHead>
                <TableHead className="text-right">Window</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(row => (
                <TableRow key={row.payer}>
                  <TableCell className="font-medium text-gray-900">{row.payer}</TableCell>
                  <TableCell className="text-right">{row.claims || '—'}</TableCell>
                  <TableCell className="text-right">
                    {row.claims ? usd.format(row.billed) : '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    {row.claims ? (
                      <>
                        {usd.format(row.paid)}
                        <span className="ml-1 text-xs text-gray-400">
                          {pct(row.grossCollectionRate)}
                        </span>
                      </>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell
                    className={`text-right ${(row.denialRate ?? 0) > 10 ? 'font-semibold text-red-600' : ''}`}
                  >
                    {pct(row.denialRate)}
                  </TableCell>
                  <TableCell className="text-right">
                    {row.medianDaysToPay === null ? '—' : `${row.medianDaysToPay}d`}
                  </TableCell>
                  <TableCell className="max-w-[14rem]">
                    {row.topCarc ? (
                      <span className="text-sm text-gray-600" title={row.topCarc.label}>
                        <span className="font-mono text-xs">{row.topCarc.carc}</span>{' '}
                        <span className="text-gray-400">×{row.topCarc.count}</span>
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {row.atStake > 0 ? usd.format(row.atStake) : '—'}
                    {row.openDenials > 0 && (
                      <span className="ml-1 text-xs text-gray-400">{row.openDenials} open</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge variant={row.filingWindowSource === 'payer' ? 'secondary' : 'outline'}>
                      {row.filingWindowDays}d
                      {row.filingWindowSource === 'default' && (
                        <span title="Filing window estimated — this payer is not in the rule set">
                          ~
                        </span>
                      )}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <p className="text-xs text-gray-400">
        Denial and collection rates come from your A/R snapshot. At-stake comes from the worklist.
        They describe the same claims from two angles and are never added together.
      </p>
    </div>
  )
}

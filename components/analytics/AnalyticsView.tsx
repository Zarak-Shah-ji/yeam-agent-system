'use client'

import { trpc } from '@/lib/trpc/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { RevenueChart } from './RevenueChart'
import { DenialRateChart } from './DenialRateChart'
import { NLQueryBox } from './NLQueryBox'

export function AnalyticsView() {
  const { data: metrics, isLoading: metricsLoading } = trpc.analytics.getSummaryMetrics.useQuery()
  const { data: revData, isLoading: revLoading } = trpc.analytics.getRevenueByDay.useQuery()
  const { data: denialData, isLoading: denialLoading } = trpc.analytics.getDenialTrend.useQuery()
  const { data: topDx, isLoading: dxLoading } = trpc.analytics.getTopDiagnoses.useQuery()

  return (
    <div className="space-y-6">
      {/* Summary metrics */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {metricsLoading
          ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-lg" />)
          : [
              { label: 'Encounters (30d)', value: metrics?.encounters ?? 0 },
              { label: 'Claims (30d)', value: metrics?.claims ?? 0 },
              { label: 'Denial Rate', value: `${(metrics?.denialRate ?? 0).toFixed(1)}%` },
              { label: 'Total Collected', value: `$${((metrics?.totalCollected ?? 0) / 1000).toFixed(1)}k` },
            ].map(({ label, value }) => (
              <Card key={label}>
                <CardContent className="p-4">
                  <p className="text-xs text-gray-500 uppercase tracking-wide">{label}</p>
                  <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
                </CardContent>
              </Card>
            ))
        }
      </div>

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-gray-700">Revenue (30 days)</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {revLoading
              ? <Skeleton className="h-64 w-full" />
              : <RevenueChart data={revData ?? []} />
            }
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-gray-700">Denial Rate Trend</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {denialLoading
              ? <Skeleton className="h-52 w-full" />
              : <DenialRateChart data={(denialData ?? []).map(d => ({ date: d.date, rate: d.denialRate }))} />
            }
          </CardContent>
        </Card>
      </div>

      {/* Top diagnoses + NL query */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-gray-700">Top Diagnoses (30d)</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {dxLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-5 w-full" />)}
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-500 border-b">
                    <th className="text-left pb-1 font-medium">ICD-10</th>
                    <th className="text-left pb-1 font-medium">Description</th>
                    <th className="text-right pb-1 font-medium">Count</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {(topDx ?? []).slice(0, 10).map((dx, i) => (
                    <tr key={`${dx.icdCode}-${i}`} className="py-1">
                      <td className="py-1 font-mono bg-gray-50 px-1 rounded mr-2">{dx.icdCode}</td>
                      <td className="py-1 text-gray-600 truncate max-w-[180px]">{dx.description}</td>
                      <td className="py-1 text-right font-medium">{dx.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-gray-700">Ask the Analytics Agent</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <NLQueryBox />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

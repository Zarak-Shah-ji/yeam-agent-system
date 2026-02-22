'use client'

import { Users, Clock, TrendingDown, DollarSign } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { trpc } from '@/lib/trpc/client'

export function MetricsCards() {
  const { data: metrics, isLoading } = trpc.dashboard.getMetrics.useQuery()

  const cards = [
    {
      label: 'Patients Today',
      value: metrics?.patientsToday ?? 0,
      icon: Users,
      color: 'text-blue-600',
      bg: 'bg-blue-50',
    },
    {
      label: 'Pending Claims',
      value: metrics?.claimsPending ?? 0,
      icon: Clock,
      color: 'text-orange-600',
      bg: 'bg-orange-50',
    },
    {
      label: 'Denial Rate',
      value: `${metrics?.denialRate ?? 0}%`,
      icon: TrendingDown,
      color: 'text-red-600',
      bg: 'bg-red-50',
    },
    {
      label: 'AR Balance',
      value: metrics?.arBalance
        ? `$${metrics.arBalance.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
        : '$0',
      icon: DollarSign,
      color: 'text-green-600',
      bg: 'bg-green-50',
    },
  ]

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="p-5">
              <div className="h-12 animate-pulse bg-gray-100 rounded" />
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {cards.map(({ label, value, icon: Icon, color, bg }) => (
        <Card key={label}>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">{label}</p>
                <p className="mt-1 text-2xl font-bold text-gray-900">{value}</p>
              </div>
              <div className={`rounded-lg p-2.5 ${bg}`}>
                <Icon className={`h-5 w-5 ${color}`} />
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

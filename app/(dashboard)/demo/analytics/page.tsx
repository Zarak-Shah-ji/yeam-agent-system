import { AnalyticsView } from '@/components/analytics/AnalyticsView'

export default function AnalyticsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Analytics</h1>
        <p className="text-sm text-gray-500 mt-0.5">Revenue cycle and clinical performance insights</p>
      </div>
      <AnalyticsView />
    </div>
  )
}

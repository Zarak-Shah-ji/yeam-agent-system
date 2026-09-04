import { InsightsView } from '@/components/insights/InsightsView'

export default function AnalyticsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Analytics</h1>
        <p className="text-sm text-gray-500">
          Your revenue cycle, computed from what you have imported
        </p>
      </div>
      <InsightsView />
    </div>
  )
}

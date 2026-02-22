import { format } from 'date-fns'
import { MetricsCards } from '@/components/dashboard/MetricsCards'
import { AppointmentList } from '@/components/dashboard/AppointmentList'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {format(new Date(), "EEEE, MMMM d, yyyy")} · Molina Family Health Clinic
        </p>
      </div>

      {/* Metric cards */}
      <MetricsCards />

      {/* Today's appointments */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Today&apos;s Appointments</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <AppointmentList />
        </CardContent>
      </Card>
    </div>
  )
}

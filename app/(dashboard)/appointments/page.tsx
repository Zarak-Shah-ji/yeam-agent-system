import { AppointmentsView } from '@/components/appointments/AppointmentsView'

export default function AppointmentsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Appointments</h1>
        <p className="text-sm text-gray-500 mt-0.5">View and manage daily appointment schedule</p>
      </div>
      <AppointmentsView />
    </div>
  )
}

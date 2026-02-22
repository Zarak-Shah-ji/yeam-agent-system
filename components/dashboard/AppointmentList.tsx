'use client'

import { format, differenceInYears } from 'date-fns'
import { Clock, UserCheck, Calendar } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { trpc } from '@/lib/trpc/client'

const STATUS_LABELS: Record<string, { label: string; variant: 'default' | 'success' | 'warning' | 'secondary' | 'info' | 'outline' | 'destructive' }> = {
  SCHEDULED: { label: 'Scheduled', variant: 'secondary' },
  CHECKED_IN: { label: 'Checked In', variant: 'info' },
  IN_PROGRESS: { label: 'In Progress', variant: 'warning' },
  COMPLETED: { label: 'Completed', variant: 'success' },
  CANCELLED: { label: 'Cancelled', variant: 'destructive' },
  NO_SHOW: { label: 'No Show', variant: 'outline' },
}

export function AppointmentList() {
  const { data, isLoading } = trpc.dashboard.getTodayAppointments.useQuery()

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-16 animate-pulse rounded-lg bg-gray-100" />
        ))}
      </div>
    )
  }

  if (!data || data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Calendar className="h-10 w-10 text-gray-300 mb-3" />
        <p className="text-sm text-gray-500">No appointments scheduled for today</p>
      </div>
    )
  }

  return (
    <div className="divide-y divide-gray-100">
      {data.map((appt) => {
        const age = differenceInYears(new Date(), new Date(appt.patient.dateOfBirth))
        const statusInfo = STATUS_LABELS[appt.status] ?? { label: appt.status, variant: 'secondary' as const }

        return (
          <div key={appt.id} className="flex items-center gap-4 py-3 hover:bg-gray-50 px-2 rounded-lg cursor-pointer">
            {/* Time */}
            <div className="flex w-16 flex-col items-center">
              <Clock className="h-3.5 w-3.5 text-gray-400 mb-0.5" />
              <span className="text-sm font-semibold text-gray-900">
                {format(new Date(appt.scheduledAt), 'h:mm')}
              </span>
              <span className="text-xs text-gray-400">
                {format(new Date(appt.scheduledAt), 'a')}
              </span>
            </div>

            {/* Patient info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-900 text-sm">
                  {appt.patient.firstName} {appt.patient.lastName}
                </span>
                <span className="text-xs text-gray-400">{age}y • {appt.patient.mrn}</span>
              </div>
              <div className="flex items-center gap-1.5 mt-0.5">
                <UserCheck className="h-3 w-3 text-gray-400" />
                <span className="text-xs text-gray-500">
                  {appt.provider.firstName} {appt.provider.lastName}, {appt.provider.credential}
                </span>
                {appt.chiefComplaint && (
                  <>
                    <span className="text-gray-300">·</span>
                    <span className="text-xs text-gray-500 truncate max-w-48">{appt.chiefComplaint}</span>
                  </>
                )}
              </div>
            </div>

            {/* Status + type */}
            <div className="flex flex-col items-end gap-1">
              <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
              {appt.appointmentType && (
                <span className="text-xs text-gray-400 capitalize">
                  {appt.appointmentType.replace('-', ' ')}
                </span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

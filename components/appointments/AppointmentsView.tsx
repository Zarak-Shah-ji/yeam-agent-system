'use client'

import { useState } from 'react'
import { format, differenceInYears } from 'date-fns'
import { Calendar, UserCheck, Loader2, X } from 'lucide-react'
import { trpc } from '@/lib/trpc/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { CancelAppointmentDialog } from './CancelAppointmentDialog'

const STATUS_LABELS: Record<string, { label: string; variant: 'default' | 'success' | 'warning' | 'info' | 'secondary' | 'destructive' | 'outline' }> = {
  SCHEDULED: { label: 'Scheduled', variant: 'secondary' },
  CHECKED_IN: { label: 'Checked In', variant: 'info' },
  IN_PROGRESS: { label: 'In Progress', variant: 'warning' },
  COMPLETED: { label: 'Completed', variant: 'success' },
  CANCELLED: { label: 'Cancelled', variant: 'destructive' },
  NO_SHOW: { label: 'No Show', variant: 'outline' },
  SUBMITTED: { label: 'Submitted', variant: 'info' },
  PAID: { label: 'Paid', variant: 'success' },
  DENIED: { label: 'Denied', variant: 'destructive' },
  SCRUBBING: { label: 'Scrubbing', variant: 'warning' },
  APPEALED: { label: 'Appealed', variant: 'secondary' },
}

export function AppointmentsView() {
  const [date, setDate] = useState('')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [cancellingId, setCancellingId] = useState<string | null>(null)

  const utils = trpc.useUtils()
  const { data, isLoading } = trpc.appointments.list.useQuery({
    date: date || undefined,
    status: statusFilter !== 'ALL' ? statusFilter : undefined,
    limit: 50,
  })

  const checkInMutation = trpc.appointments.checkIn.useMutation({
    onSuccess: () => utils.appointments.list.invalidate(),
  })

  const appointments = data?.appointments ?? []
  const cancellingAppt = appointments.find(a => a.id === cancellingId) ?? null

  return (
    <div className="space-y-4">
      {/* Filters */}
      <Card>
        <CardContent className="p-4 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-gray-400" />
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="h-9 rounded-md border border-gray-300 bg-white px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="w-44">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger>
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Statuses</SelectItem>
                <SelectItem value="SCHEDULED">Scheduled</SelectItem>
                <SelectItem value="CHECKED_IN">Checked In</SelectItem>
                <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
                <SelectItem value="COMPLETED">Completed</SelectItem>
                <SelectItem value="CANCELLED">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <span className="text-sm text-gray-500 ml-auto">{appointments.length} appointment{appointments.length !== 1 ? 's' : ''}</span>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Patient</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Chief Complaint</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading
                ? Array.from({ length: 6 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 7 }).map((_, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-20" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                : appointments.map(appt => {
                    const age = differenceInYears(new Date(), new Date(appt.patient.dateOfBirth))
                    const status = STATUS_LABELS[appt.status] ?? { label: appt.status, variant: 'secondary' as const }
                    const isChecking = checkInMutation.isPending && checkInMutation.variables?.id === appt.id

                    return (
                      <TableRow key={appt.id} className={appt.status === 'CANCELLED' ? 'opacity-50' : undefined}>
                        <TableCell>
                          <div className="font-semibold text-gray-900">{format(new Date(appt.scheduledAt), 'h:mm a')}</div>
                          <div className="text-xs text-gray-400">{appt.duration}min</div>
                        </TableCell>
                        <TableCell>
                          <div className={`font-medium${appt.status === 'CANCELLED' ? ' line-through text-gray-400' : ''}`}>
                            {appt.patient.firstName} {appt.patient.lastName}
                          </div>
                          <div className="text-xs text-gray-400">{appt.patient.mrn} · {age}y</div>
                        </TableCell>
                        <TableCell className="text-sm">
                          {appt.provider.firstName} {appt.provider.lastName}
                          {appt.provider.credential && <span className="text-gray-400">, {appt.provider.credential}</span>}
                        </TableCell>
                        <TableCell>
                          <span className="text-sm capitalize">{appt.appointmentType?.replace('-', ' ') ?? '—'}</span>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm text-gray-600 max-w-[180px] truncate block">{appt.chiefComplaint ?? '—'}</span>
                        </TableCell>
                        <TableCell>
                          <Badge variant={status.variant}>{status.label}</Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {appt.status === 'SCHEDULED' && (
                              <>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={isChecking}
                                  onClick={() => checkInMutation.mutate({ id: appt.id })}
                                >
                                  {isChecking ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserCheck className="h-3 w-3" />}
                                  <span className="ml-1">Check In</span>
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="text-red-500 hover:text-red-700 hover:bg-red-50"
                                  onClick={() => setCancellingId(appt.id)}
                                >
                                  <X className="h-3 w-3" />
                                  <span className="ml-1">Cancel</span>
                                </Button>
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })
              }
            </TableBody>
          </Table>

          {!isLoading && appointments.length === 0 && (
            <div className="py-12 text-center">
              <Calendar className="h-10 w-10 text-gray-300 mx-auto mb-3" />
              <p className="text-sm text-gray-500">No appointments found{date ? ` for ${format(new Date(date + 'T00:00:00'), 'MMMM d, yyyy')}` : ''}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {cancellingAppt && (
        <CancelAppointmentDialog
          open={!!cancellingId}
          appointmentId={cancellingAppt.id}
          patientName={`${cancellingAppt.patient.firstName} ${cancellingAppt.patient.lastName}`}
          onOpenChange={open => { if (!open) setCancellingId(null) }}
          onSuccess={() => { utils.appointments.list.invalidate(); setCancellingId(null) }}
        />
      )}
    </div>
  )
}

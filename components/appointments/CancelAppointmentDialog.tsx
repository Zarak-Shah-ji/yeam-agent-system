'use client'

import { useState } from 'react'
import { trpc } from '@/lib/trpc/client'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
type ReasonType = 'PATIENT_REQUEST' | 'NO_SHOW' | 'PROVIDER_UNAVAILABLE' | 'INSURANCE_ISSUE' | 'OTHER'

interface CancelAppointmentDialogProps {
  open: boolean
  appointmentId: string
  patientName: string
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

export function CancelAppointmentDialog({
  open,
  appointmentId,
  patientName,
  onOpenChange,
  onSuccess,
}: CancelAppointmentDialogProps) {
  const [reasonType, setReasonType] = useState<ReasonType | ''>('')
  const [reasonNote, setReasonNote] = useState('')

  const cancelMutation = trpc.appointments.cancel.useMutation({
    onSuccess: () => {
      onSuccess()
      handleClose()
    },
  })

  function handleClose() {
    setReasonType('')
    setReasonNote('')
    cancelMutation.reset()
    onOpenChange(false)
  }

  function handleOpenChange(open: boolean) {
    if (cancelMutation.isPending) return
    if (!open) handleClose()
    else onOpenChange(true)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cancel Appointment</DialogTitle>
          <DialogDescription>
            Cancel the appointment for <span className="font-medium text-gray-900">{patientName}</span>.
            This action cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <label htmlFor="reason-type" className="text-sm font-medium">Cancellation Reason</label>
            <Select
              value={reasonType}
              onValueChange={val => setReasonType(val as ReasonType)}
            >
              <SelectTrigger id="reason-type">
                <SelectValue placeholder="Select a reason..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PATIENT_REQUEST">Patient Request</SelectItem>
                <SelectItem value="NO_SHOW">No Show</SelectItem>
                <SelectItem value="PROVIDER_UNAVAILABLE">Provider Unavailable</SelectItem>
                <SelectItem value="INSURANCE_ISSUE">Insurance Issue</SelectItem>
                <SelectItem value="OTHER">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {reasonType === 'OTHER' && (
            <div className="space-y-2">
              <label htmlFor="reason-note" className="text-sm font-medium">
                Additional Details
                <span className="ml-1 text-xs text-gray-400 font-normal">{reasonNote.length}/500</span>
              </label>
              <Textarea
                id="reason-note"
                value={reasonNote}
                onChange={e => setReasonNote(e.target.value.slice(0, 500))}
                placeholder="Describe the reason for cancellation..."
                rows={3}
              />
            </div>
          )}

          {cancelMutation.error && (
            <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
              {cancelMutation.error.message}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={cancelMutation.isPending}
          >
            Keep Appointment
          </Button>
          <Button
            variant="destructive"
            disabled={!reasonType || cancelMutation.isPending}
            onClick={() =>
              cancelMutation.mutate({
                id: appointmentId,
                reasonType: reasonType as ReasonType,
                reasonNote: reasonNote.trim() || undefined,
              })
            }
          >
            {cancelMutation.isPending ? 'Cancelling...' : 'Cancel Appointment'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

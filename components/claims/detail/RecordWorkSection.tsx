'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { trpc } from '@/lib/trpc/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { STATUS_LABEL } from '../status'
import { toDateInput } from './atoms'
import type { ClaimDetail } from './types'

const STATUS_OPTIONS = Object.keys(STATUS_LABEL)

/**
 * Everything a biller writes down, in one place.
 *
 * The note, the status and the code corrections used to be three separate
 * blocks scattered down the middle of the record, between the denial card and
 * the history — so "what do I do with this" was a scroll rather than a place.
 * They are one section because they are one act.
 *
 * Everything written here goes to ClaimWork, keyed on the claim number, NOT to
 * the OrgClaim row on screen. That row is a snapshot: next month's A/R export
 * replaces it. See server/trpc/router/claims.ts.
 *
 * Mounted with key={claimId} by the dialog. That is what resets the four fields
 * below when a different claim is opened — and, just as importantly, what does
 * NOT reset them when a refetch lands, so a refresh cannot wipe a note somebody
 * is halfway through typing. An effect keyed on the server value would.
 */
export function RecordWorkSection({
  claim,
  claimNumber,
  icd10Draft,
  onIcd10Draft,
  onSaved,
}: {
  claim: ClaimDetail
  claimNumber: string
  /** Lifted, because "Use as correction" in the code review writes into it. */
  icd10Draft: string
  onIcd10Draft: (value: string) => void
  onSaved: () => void
}) {
  const [note, setNote] = useState(claim.work?.note ?? '')
  const [followUp, setFollowUp] = useState(toDateInput(claim.work?.followUpAt))
  const [cpt, setCpt] = useState('')

  const setStatus = trpc.claims.setStatus.useMutation({ onSuccess: onSaved })
  const saveNote = trpc.claims.setNote.useMutation({ onSuccess: onSaved })
  const saveFollowUp = trpc.claims.setFollowUp.useMutation({ onSuccess: onSaved })
  const correctCodes = trpc.claims.correctCodes.useMutation({
    onSuccess: () => {
      setCpt('')
      onIcd10Draft('')
      onSaved()
    },
  })

  const busy =
    setStatus.isPending || saveNote.isPending || saveFollowUp.isPending || correctCodes.isPending
  const error = setStatus.error || saveNote.error || saveFollowUp.error || correctCodes.error

  const noteChanged = note.trim() !== (claim.work?.note ?? '').trim()
  const followUpChanged = followUp !== toDateInput(claim.work?.followUpAt)
  const codesChanged = cpt.trim() !== '' || icd10Draft.trim() !== ''

  return (
    <div className="space-y-4">
      {/* Where the reason the payer gave on the phone lands. */}
      <div>
        <label
          htmlFor="claim-note"
          className="text-xs font-medium uppercase tracking-wide text-gray-500"
        >
          Note
        </label>
        <Textarea
          id="claim-note"
          rows={3}
          className="mt-1"
          placeholder="What the payer said, what you tried, what to do next…"
          value={note}
          onChange={e => setNote(e.target.value)}
        />
        {noteChanged && (
          <Button
            size="sm"
            className="mt-2"
            disabled={busy}
            onClick={() => saveNote.mutate({ claimNumber, note })}
          >
            Save note
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-3 border-t border-gray-200 pt-3">
        <div>
          <label
            htmlFor="claim-status"
            className="text-xs font-medium uppercase tracking-wide text-gray-500"
          >
            Status
          </label>
          <Select
            value={claim.work?.statusOverride ?? claim.status}
            onValueChange={v => setStatus.mutate({ claimNumber, status: v as 'PAID' })}
          >
            <SelectTrigger id="claim-status" className="mt-1 h-9 w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map(value => (
                <SelectItem key={value} value={value}>
                  {STATUS_LABEL[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <label
            htmlFor="claim-follow-up"
            className="text-xs font-medium uppercase tracking-wide text-gray-500"
          >
            Follow up
          </label>
          <Input
            id="claim-follow-up"
            type="date"
            className="mt-1 h-9 w-44"
            value={followUp}
            onChange={e => setFollowUp(e.target.value)}
          />
        </div>

        {followUpChanged && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              saveFollowUp.mutate({
                claimNumber,
                followUpAt: followUp ? new Date(followUp) : null,
              })
            }
          >
            Save follow-up
          </Button>
        )}
      </div>

      {/* A correction sits alongside the imported code, never over it. */}
      <div className="border-t border-gray-200 pt-3">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
          Correct the codes
        </p>
        <div className="mt-1 flex flex-wrap items-end gap-2">
          <Input
            className="h-9 w-32"
            placeholder={claim.cpt ?? 'CPT'}
            aria-label="Corrected CPT"
            value={cpt}
            onChange={e => setCpt(e.target.value)}
          />
          <Input
            className="h-9 w-32"
            placeholder={claim.icd10 ?? 'ICD-10'}
            aria-label="Corrected ICD-10"
            value={icd10Draft}
            onChange={e => onIcd10Draft(e.target.value)}
          />
          {codesChanged && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                correctCodes.mutate({
                  claimNumber,
                  ...(cpt.trim() ? { cpt: cpt.trim() } : {}),
                  ...(icd10Draft.trim() ? { icd10: icd10Draft.trim() } : {}),
                })
              }
            >
              Save correction
            </Button>
          )}
        </div>
        <p className="mt-1.5 text-xs text-gray-500">
          Recorded next to what was billed, not over it — a corrected claim needs both.
        </p>
      </div>

      {busy && (
        <p className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Saving…
        </p>
      )}

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error.message}
        </p>
      )}
    </div>
  )
}

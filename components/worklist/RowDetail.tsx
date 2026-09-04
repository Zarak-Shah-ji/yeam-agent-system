'use client'

import { useState } from 'react'
import { Check, Info, Loader2, PhoneOff, Search } from 'lucide-react'
import { trpc } from '@/lib/trpc/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

/**
 * Everything about one denial that is not the draft itself.
 *
 * Three things live here, and each answers a specific complaint from working
 * billers about tools in this category:
 *
 *  1. WHY THIS IS RANKED HERE. A score nobody can interrogate gets ignored, and
 *     the biller sorts by dollars instead. The factors are always visible.
 *  2. WHAT THE REMITTANCE ACTUALLY SAID. The refinement from the remark code —
 *     "N290: rendering provider NPI missing" rather than "information missing".
 *  3. THE LOOP. Status, follow-up date and a free-text note. Until these
 *     existed no row could leave DRAFTED, so nothing in the product could say
 *     what any of the work was worth.
 */

const STATUS_ACTIONS = [
  { status: 'SENT' as const, label: 'Mark sent', hint: 'Submitted to the payer' },
  { status: 'PAID' as const, label: 'Mark paid', hint: 'Money arrived' },
  { status: 'DEAD' as const, label: 'Write off', hint: 'Not worth pursuing further' },
]

const STATUS_LABEL: Record<string, string> = {
  TO_WORK: 'To work',
  DRAFTED: 'Drafted',
  SENT: 'Sent',
  PAID: 'Recovered',
  DEAD: 'Written off',
}

const STATUS_VARIANT: Record<string, 'secondary' | 'warning' | 'info' | 'success' | 'outline'> = {
  TO_WORK: 'secondary',
  DRAFTED: 'warning',
  SENT: 'info',
  PAID: 'success',
  DEAD: 'outline',
}

export type ScoreFactorView = {
  key: string
  label: string
  points: number
  detail: string
}

export type RefinementView = {
  rarc: string | null
  cause: string
  action: string
  source: 'remark-code' | 'reason-text'
  noAppealRights?: boolean
}

export type RowDetailProps = {
  rowId: string
  status: string
  score: number
  band: string
  factors: ScoreFactorView[]
  refinement: RefinementView | null
  note: string | null
  followUpAt: Date | string | null
  call: { verdict: string; label: string; detail: string }
  onChanged: () => void
}

/** yyyy-mm-dd for a date input, in local time rather than UTC. */
function toDateInput(value: Date | string | null): string {
  if (!value) return ''
  const d = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function RowDetail({
  rowId,
  status,
  score,
  band,
  factors,
  refinement,
  note,
  followUpAt,
  call,
  onChanged,
}: RowDetailProps) {
  const [draftNote, setDraftNote] = useState(note ?? '')
  const [followUp, setFollowUp] = useState(toDateInput(followUpAt))
  const [shownRow, setShownRow] = useState(rowId)

  // The dialog is reused across rows without unmounting, so local state has to
  // follow the row it is showing or the previous row's note leaks into the next.
  //
  // Reset during render, keyed on rowId alone. This used to be an effect that
  // also depended on `note` and `followUpAt`, which reset the fields whenever
  // those props changed — and saving anything invalidates the worklist, so a
  // background refetch landing mid-sentence wiped whatever the biller was
  // typing. Same reset, but only when the row genuinely changes.
  if (shownRow !== rowId) {
    setShownRow(rowId)
    setDraftNote(note ?? '')
    setFollowUp(toDateInput(followUpAt))
  }

  const utils = trpc.useUtils()
  const refresh = () => {
    void utils.worklist.invalidate()
    void utils.insights.invalidate()
    onChanged()
  }

  const setStatus = trpc.worklist.setStatus.useMutation({ onSuccess: refresh })
  const setNote = trpc.worklist.setNote.useMutation({ onSuccess: refresh })

  const busy = setStatus.isPending || setNote.isPending
  const noteChanged = draftNote.trim() !== (note ?? '').trim()

  return (
    <div className="space-y-4">
      {/* What the remittance actually said, when it said anything useful. */}
      {refinement && (
        <div className="rounded-md border border-blue-200 bg-blue-50 p-3">
          <div className="flex items-start gap-2">
            <Search className="mt-0.5 h-4 w-4 shrink-0 text-blue-700" aria-hidden="true" />
            <div className="min-w-0 text-sm">
              <p className="font-medium text-blue-900">
                {refinement.rarc ? `${refinement.rarc} — ` : ''}
                {refinement.cause}
              </p>
              <p className="mt-0.5 text-blue-800">{refinement.action}</p>
              <p className="mt-1 text-xs text-blue-700">
                {refinement.source === 'remark-code'
                  ? 'Read from the remark code on the remittance.'
                  : 'Inferred from the payer’s denial wording — confirm before relying on it.'}
              </p>
              {refinement.noAppealRights && (
                <p className="mt-1 text-xs font-medium text-red-700">
                  This denial carries no appeal rights. Correct and resubmit — an appeal will not
                  be reviewed.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Why the queue put this row where it did. */}
      <div className="rounded-md border border-gray-200 p-3">
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-gray-500">
            <Info className="h-3.5 w-3.5" aria-hidden="true" />
            Why this ranks {score}
          </p>
          <Badge variant={status === 'PAID' ? 'success' : 'secondary'}>
            {STATUS_LABEL[status] ?? status}
          </Badge>
        </div>
        <ul className="mt-2 space-y-1">
          {factors.map(f => (
            <li key={f.key} className="flex items-baseline justify-between gap-3 text-sm">
              <span className="text-gray-600">
                <span className="font-medium text-gray-900">{f.label}</span> · {f.detail}
              </span>
              <span className="shrink-0 font-mono text-xs text-gray-500">
                {f.points > 0 ? `+${f.points}` : f.points}
              </span>
            </li>
          ))}
        </ul>
        {band === 'parked' && (
          <p className="mt-2 text-xs text-gray-500">
            Scored zero deliberately. Rows that cannot be recovered do not compete for attention.
          </p>
        )}
      </div>

      {/* Whether chasing it today is worth the hold music. */}
      {call.verdict !== 'not-sent' && (
        <div className="flex items-start gap-2 rounded-md border border-gray-200 bg-gray-50 p-3 text-sm">
          <PhoneOff
            className={`mt-0.5 h-4 w-4 shrink-0 ${
              call.verdict === 'in-process' ? 'text-gray-400' : 'text-amber-600'
            }`}
            aria-hidden="true"
          />
          <div>
            <p className="font-medium text-gray-900">{call.label}</p>
            <p className="text-gray-600">{call.detail}</p>
          </div>
        </div>
      )}

      {/* The note. Where the reason the payer gave on the phone actually lands. */}
      <div>
        <label htmlFor="row-note" className="text-xs font-medium uppercase tracking-wide text-gray-500">
          Note
        </label>
        <Textarea
          id="row-note"
          rows={2}
          value={draftNote}
          disabled={busy}
          onChange={e => setDraftNote(e.target.value)}
          placeholder="What the payer actually said on the call, or anything the export does not carry…"
          className="mt-1"
        />
        {noteChanged && (
          <Button
            size="sm"
            variant="outline"
            className="mt-2"
            disabled={busy}
            onClick={() => setNote.mutate({ rowId, note: draftNote })}
          >
            {setNote.isPending ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            )}
            Save note
          </Button>
        )}
      </div>

      {/* Closing the loop. */}
      <div className="border-t border-gray-200 pt-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label
              htmlFor="follow-up"
              className="text-xs font-medium uppercase tracking-wide text-gray-500"
            >
              Follow up on
            </label>
            <Input
              id="follow-up"
              type="date"
              value={followUp}
              disabled={busy}
              onChange={e => setFollowUp(e.target.value)}
              className="mt-1 w-40"
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {STATUS_ACTIONS.map(action => (
              <Button
                key={action.status}
                size="sm"
                variant={status === action.status ? 'default' : 'outline'}
                disabled={busy}
                title={action.hint}
                onClick={() =>
                  setStatus.mutate({
                    rowId,
                    status: action.status,
                    followUpAt: followUp ? new Date(`${followUp}T12:00:00`) : null,
                  })
                }
              >
                {setStatus.isPending && setStatus.variables?.status === action.status && (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                )}
                {action.label}
              </Button>
            ))}
          </div>
        </div>
        <p className="mt-2 text-xs text-gray-500">
          Marking a row sent starts the clock the call guidance measures against.
        </p>
      </div>

      {(setStatus.error || setNote.error) && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {setStatus.error?.message ?? setNote.error?.message}
        </p>
      )}
    </div>
  )
}

export { STATUS_LABEL, STATUS_VARIANT }

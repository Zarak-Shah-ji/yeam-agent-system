'use client'

import { useState } from 'react'
import { Check, Loader2, Sparkles } from 'lucide-react'
import { trpc } from '@/lib/trpc/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  OUTCOME_HINT,
  OUTCOME_LABEL,
  RESOLVABLE_OUTCOMES,
  daysToResolution,
  type SubmissionOutcomeValue,
} from '@/lib/denials/outcomes'

/**
 * Closing the loop on one submission.
 *
 * The last step the product was missing, and the one everything else is worth
 * more because of. Recording that a letter went out told us a letter went out;
 * recording what came back is what makes the next letter better, and it is the
 * only fact in this app that cannot be re-derived from a fresh export.
 *
 * ── Design notes, because this form has to be filled in to be worth anything ─
 *
 * ONE CLICK RECORDS A USABLE OUTCOME. The ruling is the only required field.
 * Amount, date and code all improve the ledger and none of them gate it — a
 * form that demands the determination letter is a form that gets abandoned, and
 * an abandoned form leaves a hole in the data that looks exactly like a loss
 * that never happened.
 *
 * THE LOSSES MATTER MORE THAN THE WINS. Wins get recorded on their own because
 * money arriving is memorable. "Denied again" is the one nobody goes back to
 * type in, which is why it sits in the same row as the others rather than
 * behind anything, and why the note field says what it says.
 *
 * NO PATIENT FIELD. A determination letter names the patient; what leaves this
 * form is the ruling, the date, the amount and the code. recordOutcome's input
 * is `.strict()` and would refuse anything else.
 */

const OUTCOME_VARIANT: Record<SubmissionOutcomeValue, 'secondary' | 'success' | 'warning' | 'destructive' | 'outline'> = {
  PENDING: 'secondary',
  PAID: 'success',
  PARTIAL: 'warning',
  DENIED: 'destructive',
  NO_RESPONSE: 'outline',
  WITHDRAWN: 'outline',
}

const CHANNEL_LABEL: Record<string, string> = {
  PORTAL: 'Portal',
  FAX: 'Fax',
  MAIL: 'Mail',
  CLEARINGHOUSE: 'Clearinghouse',
  PHONE: 'Phone',
  OTHER: 'Other',
}

function toDateInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export interface SubmissionView {
  id: string
  channel: string
  destination: string
  sentAt: string | Date
  confirmationRef: string | null
  outcome: SubmissionOutcomeValue
  outcomeAt: string | Date | null
  outcomeCarc: string | null
  outcomeNote: string | null
  outcomeSource: 'BILLER' | 'REMITTANCE' | null
  amountRecovered: unknown
}

/** Prisma Decimals arrive over the wire as strings. */
function amount(v: unknown): number | null {
  if (v === null || v === undefined) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

export function OutcomePanel({
  submission,
  onRecorded,
}: {
  submission: SubmissionView
  onRecorded: () => void
}) {
  const sentAt = new Date(submission.sentAt)
  const resolved = submission.outcome !== 'PENDING'

  const [open, setOpen] = useState(false)
  const [outcome, setOutcome] = useState<SubmissionOutcomeValue | ''>(
    resolved ? submission.outcome : '',
  )
  const [outcomeAt, setOutcomeAt] = useState(
    submission.outcomeAt ? toDateInput(new Date(submission.outcomeAt)) : toDateInput(new Date()),
  )
  const [recovered, setRecovered] = useState(
    amount(submission.amountRecovered)?.toString() ?? '',
  )
  const [carc, setCarc] = useState(submission.outcomeCarc ?? '')
  const [note, setNote] = useState(submission.outcomeNote ?? '')

  const record = trpc.worklist.recordOutcome.useMutation({
    onSuccess: () => {
      setOpen(false)
      onRecorded()
    },
  })

  const settled = daysToResolution(sentAt, submission.outcomeAt ? new Date(submission.outcomeAt) : null)
  const recoveredAmount = amount(submission.amountRecovered)

  return (
    <li className="rounded-md border border-gray-200 p-2.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 text-sm">
          <span className="font-medium text-gray-900">
            {CHANNEL_LABEL[submission.channel] ?? submission.channel}
          </span>
          <span className="text-gray-600">
            {' · '}
            {sentAt.toLocaleDateString()}
            {submission.confirmationRef ? ` · ${submission.confirmationRef}` : ''}
          </span>
          <p className="whitespace-pre-line text-xs text-gray-500">{submission.destination}</p>
        </div>
        <Badge variant={OUTCOME_VARIANT[submission.outcome]}>
          {OUTCOME_LABEL[submission.outcome]}
        </Badge>
      </div>

      {resolved && (
        <p className="mt-1.5 text-xs text-gray-600">
          {recoveredAmount !== null && (
            <span className="font-medium text-gray-900">
              ${recoveredAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })} recovered
              {' · '}
            </span>
          )}
          {settled !== null ? `${settled} days` : 'no determination date'}
          {submission.outcomeCarc ? ` · came back ${submission.outcomeCarc}` : ''}
          {submission.outcomeSource === 'REMITTANCE' && (
            <span className="ml-1 inline-flex items-center gap-1 text-blue-700">
              <Sparkles className="h-3 w-3" aria-hidden="true" />
              from an A/R export
            </span>
          )}
        </p>
      )}
      {resolved && submission.outcomeNote && (
        <p className="mt-1 whitespace-pre-line text-xs text-gray-500">{submission.outcomeNote}</p>
      )}

      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-2 text-xs font-medium text-blue-700 underline hover:text-blue-900"
        >
          {resolved ? 'Correct this outcome' : 'Record what came back'}
        </button>
      )}

      {open && (
        <div className="mt-2 space-y-2 border-t border-gray-200 pt-2">
          <div className="flex flex-wrap gap-1.5">
            {RESOLVABLE_OUTCOMES.map(value => (
              <Button
                key={value}
                size="sm"
                variant={outcome === value ? 'default' : 'outline'}
                title={OUTCOME_HINT[value]}
                onClick={() => setOutcome(value)}
              >
                {OUTCOME_LABEL[value]}
              </Button>
            ))}
          </div>
          {outcome && <p className="text-xs text-gray-500">{OUTCOME_HINT[outcome]}</p>}

          {/*
            Everything below is optional. The ruling on its own is a usable
            outcome; demanding the letter is how a form stops getting filled in.
          */}
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label htmlFor={`out-date-${submission.id}`} className="text-xs text-gray-600">
                Date on the determination
              </label>
              <Input
                id={`out-date-${submission.id}`}
                type="date"
                className="mt-1"
                value={outcomeAt}
                onChange={e => setOutcomeAt(e.target.value)}
              />
            </div>
            {(outcome === 'PAID' || outcome === 'PARTIAL') && (
              <div>
                <label htmlFor={`out-amt-${submission.id}`} className="text-xs text-gray-600">
                  Amount recovered
                </label>
                <Input
                  id={`out-amt-${submission.id}`}
                  type="number"
                  min="0"
                  step="0.01"
                  className="mt-1"
                  placeholder="Optional"
                  value={recovered}
                  onChange={e => setRecovered(e.target.value)}
                />
              </div>
            )}
            {outcome === 'DENIED' && (
              <div>
                <label htmlFor={`out-carc-${submission.id}`} className="text-xs text-gray-600">
                  Code they denied it under
                </label>
                <Input
                  id={`out-carc-${submission.id}`}
                  className="mt-1"
                  placeholder="e.g. CO-16"
                  value={carc}
                  onChange={e => setCarc(e.target.value)}
                />
              </div>
            )}
          </div>

          <div>
            <label htmlFor={`out-note-${submission.id}`} className="text-xs text-gray-600">
              What they said
            </label>
            <Textarea
              id={`out-note-${submission.id}`}
              rows={2}
              className="mt-1"
              placeholder="The reason they gave. Often the only place it is written down."
              value={note}
              onChange={e => setNote(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              disabled={!outcome || record.isPending}
              onClick={() =>
                outcome &&
                record.mutate({
                  submissionId: submission.id,
                  outcome,
                  outcomeAt: outcomeAt ? new Date(`${outcomeAt}T12:00:00`) : null,
                  amountRecovered:
                    recovered.trim() === '' ? null : Number.parseFloat(recovered),
                  outcomeCarc: carc.trim() || null,
                  outcomeNote: note.trim() || null,
                })
              }
            >
              {record.isPending ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              )}
              Save outcome
            </Button>
            <Button size="sm" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>

          <p className="text-xs text-gray-500">
            {outcome === 'PAID' || outcome === 'PARTIAL'
              ? 'Marks the row recovered and clears the follow-up.'
              : outcome === 'DENIED' || outcome === 'NO_RESPONSE'
                ? 'Puts the row back in the queue — a second-level appeal is usually the next step, and the filing window is shorter now.'
                : 'Recorded against this attempt, not the row.'}
          </p>

          {record.error && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
              {record.error.message}
            </p>
          )}
        </div>
      )}
    </li>
  )
}

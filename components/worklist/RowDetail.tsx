'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, Info, Loader2, PhoneOff, RotateCcw, Search, Send } from 'lucide-react'
import { trpc } from '@/lib/trpc/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { OutcomePanel } from './OutcomePanel'

/**
 * Everything about one denial that is not the draft itself.
 *
 * Four things live here, and each answers a specific complaint from working
 * billers about tools in this category:
 *
 *  1. WHY THIS IS RANKED HERE. A score nobody can interrogate gets ignored, and
 *     the biller sorts by dollars instead. The factors are always visible.
 *  2. WHAT THE REMITTANCE ACTUALLY SAID. The refinement from the remark code —
 *     "N290: rendering provider NPI missing" rather than "information missing".
 *  3. THE LOOP. Status, follow-up date and a free-text note. Until these
 *     existed no row could leave DRAFTED, so nothing in the product could say
 *     what any of the work was worth.
 *  4. WHAT CAME BACK. Every submission with its own ruling, recorded against
 *     the attempt rather than the row so a first-level appeal that lost and a
 *     second-level one that won both survive. This is the only data in the
 *     product that no export could rebuild — see components/worklist/
 *     OutcomePanel.tsx.
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

/**
 * The note and follow-up date as they currently sit in the inputs, saved or not.
 *
 * `dirty` is what lets the caller distinguish "the biller typed this and has not
 * saved it" from "this is what the row already holds" — so drafting writes only
 * what actually changed and does not stamp lastTouchedAt on a row nobody edited.
 */
export type PendingWork = {
  note: string
  /** yyyy-mm-dd, straight from the date input. Empty means cleared. */
  followUp: string
  noteDirty: boolean
  followUpDirty: boolean
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
  /**
   * Reports the note and follow-up date as they stand, on every keystroke.
   *
   * The draft button lives in the parent dialog, and until this existed it could
   * not see a note the biller had typed but not saved — so the letter was drafted
   * without the one fact that would have made it specific. See the draft mutation
   * in server/trpc/router/worklist.ts, which persists what this reports.
   */
  onPendingChange?: (pending: PendingWork) => void
}

/** The Date a yyyy-mm-dd input means, pinned to midday so no timezone shifts it. */
export function dateFromInput(value: string): Date | null {
  return value ? new Date(`${value}T12:00:00`) : null
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
  onPendingChange,
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

  // Held in a ref so the effect below depends only on the values it reports. The
  // effect sets state in the parent, so a caller that rebuilds this callback on
  // every render would otherwise drive the two components round in a loop.
  const report = useRef(onPendingChange)
  useEffect(() => {
    report.current = onPendingChange
  }, [onPendingChange])

  useEffect(() => {
    report.current?.({
      note: draftNote,
      followUp,
      noteDirty: draftNote.trim() !== (note ?? '').trim(),
      followUpDirty: followUp !== toDateInput(followUpAt),
    })
  }, [draftNote, followUp, note, followUpAt])

  const utils = trpc.useUtils()
  const refresh = () => {
    void utils.worklist.invalidate()
    void utils.insights.invalidate()
    onChanged()
  }

  const setStatus = trpc.worklist.setStatus.useMutation({ onSuccess: refresh })
  const setNote = trpc.worklist.setNote.useMutation({ onSuccess: refresh })
  const saveFollowUp = trpc.worklist.setFollowUp.useMutation({ onSuccess: refresh })

  // Every attempt at getting a document to this payer, newest first. Reads as
  // the row's history: what went out, when, and under what reference.
  const submissions = trpc.worklist.submissions.useQuery({ rowId })

  const busy = setStatus.isPending || setNote.isPending || saveFollowUp.isPending
  const noteChanged = draftNote.trim() !== (note ?? '').trim()
  const followUpChanged = followUp !== toDateInput(followUpAt)
  const sent = submissions.data ?? []

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
          {/*
            Saving a date on its own. Until this existed the only way to record
            "they are reprocessing it, check back Friday" was to also click a
            status button, which forced the row into a state that was not true.
          */}
          {followUpChanged && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                saveFollowUp.mutate({
                  rowId,
                  followUpAt: dateFromInput(followUp),
                })
              }
            >
              {saveFollowUp.isPending ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              )}
              Save follow-up
            </Button>
          )}
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
                    followUpAt: dateFromInput(followUp),
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

        {/*
          Reopening. An appeal that comes back denied is not finished work, and a
          row that cannot leave a closed status is a row the biller has to track
          somewhere else. Kept away from the three dispositions above because it
          is an undo, not an outcome.
        */}
        {status !== 'TO_WORK' && (
          <button
            type="button"
            disabled={busy}
            onClick={() => setStatus.mutate({ rowId, status: 'TO_WORK' })}
            className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 underline hover:text-gray-900 disabled:opacity-50"
          >
            <RotateCcw className="h-3 w-3" aria-hidden="true" />
            Reopen — the payer denied it again, or it went out too early
          </button>
        )}
      </div>

      {/*
        What has actually gone to the payer, the proof of it, and what came
        back. The last part is the one the product was missing: a submission
        with no outcome records that a letter went out, which is not the fact
        anyone needed. Each attempt keeps its own ruling — a first-level appeal
        that lost and a second-level one that won are both true.
      */}
      {sent.length > 0 && (
        <div className="border-t border-gray-200 pt-3">
          <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-gray-500">
            <Send className="h-3.5 w-3.5" aria-hidden="true" />
            Submitted
          </p>
          <ul className="mt-2 space-y-2">
            {sent.map(s => (
              <OutcomePanel
                key={s.id}
                submission={s}
                onRecorded={() => {
                  void submissions.refetch()
                  refresh()
                }}
              />
            ))}
          </ul>
        </div>
      )}

      {(setStatus.error || setNote.error || saveFollowUp.error) && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {setStatus.error?.message ?? setNote.error?.message ?? saveFollowUp.error?.message}
        </p>
      )}
    </div>
  )
}

export { STATUS_LABEL, STATUS_VARIANT }

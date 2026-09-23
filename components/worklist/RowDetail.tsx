'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, History, Info, Loader2, PhoneOff, RotateCcw, Search, Sparkles } from 'lucide-react'
import { trpc } from '@/lib/trpc/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { BAND_LABEL, type PriorityBand } from '@/lib/denials/score'
import { STATUS_LABEL } from '@/lib/denials/status'
import { Timeline } from '@/components/shared/Timeline'
import { NoteComposer } from './NoteComposer'

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
 *
 * WHAT CAME BACK used to be the fourth, and is now its own pane at the end of
 * the panel — components/worklist/OutcomeList.tsx. It was rendered here while
 * being the last thing that happens to a claim, which meant scrolling back up
 * past the letter to close the loop on it.
 */

const STATUS_ACTIONS = [
  { status: 'SENT' as const, label: 'Mark sent', hint: 'Submitted to the payer' },
  { status: 'PAID' as const, label: 'Mark paid', hint: 'Money arrived' },
  { status: 'DEAD' as const, label: 'Write off', hint: 'Not worth pursuing further' },
]

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

/** One row of history, as the server hands it over. */
type HistoryEvent = {
  id: string
  kind: string
  detail: string | null
  at: Date | string
  actor: string | null
}

/** "12 Sep", or "12 Sep 2025" once it is not this year. */
function shortDate(value: Date | string): string {
  const d = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(d.getTime())) return ''
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}

function byline(event: HistoryEvent): string {
  return event.actor ? `${shortDate(event.at)} by ${event.actor}` : shortDate(event.at)
}

/**
 * The notes written on this row before the one in the box.
 *
 * The current note is excluded rather than repeated: it is already on screen,
 * three inches up, in an editable field. Showing it twice invites someone to
 * wonder which of the two is real.
 *
 * Empty details are dropped. Clearing a note is a real event and it is in the
 * timeline, but "someone deleted the note on 12 Sep" is not what this list is
 * for — this is for reading what the payer said last time.
 */
function PriorNotes({ events, current }: { events: HistoryEvent[]; current: string | null }) {
  const notes = events.filter(e => e.kind === 'NOTE_ADDED' && e.detail?.trim())
  // The newest NOTE_ADDED is what the column already holds, so skip it — but
  // only when it really matches, since a note saved by an older build of this
  // product has no event behind it at all.
  const prior =
    notes.length && notes[0].detail?.trim() === (current ?? '').trim() ? notes.slice(1) : notes

  if (prior.length === 0) return null

  return (
    <details className="mt-2 group">
      <summary className="cursor-pointer text-xs text-gray-500 hover:text-gray-700">
        {prior.length} earlier {prior.length === 1 ? 'note' : 'notes'}
      </summary>
      <ul className="mt-2 space-y-2 border-l-2 border-gray-200 pl-3">
        {prior.map(e => (
          <li key={e.id} className="text-sm">
            <p className="whitespace-pre-wrap text-gray-700">{e.detail}</p>
            <p className="mt-0.5 text-xs text-gray-400">{byline(e)}</p>
          </li>
        ))}
      </ul>
    </details>
  )
}

/** Who last set the follow-up date, and when. Silent when nobody has. */
function FollowUpOrigin({ events }: { events: HistoryEvent[] }) {
  const last = events.find(e => e.kind === 'FOLLOW_UP_SET')
  if (!last) return null
  return (
    <p className="mt-1 text-xs text-gray-400">
      {last.detail === 'cleared' ? 'Cleared ' : 'Set '}
      {byline(last)}
    </p>
  )
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
  /** Whether the "write it for me" composer is open on this row. */
  const [composing, setComposing] = useState(false)
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

  // Every note ever written on this row, and every date ever set. The columns
  // above hold only the current values, so without this a biller reopening a
  // claim sees the last thing they typed and no sign of the three calls before it.
  const history = trpc.worklist.history.useQuery({ rowId })

  /*
    The same events merged with the import, the drafts and the submissions.

    Collapsed by default, and that is the whole design of it. The full record
    answers a question asked once per claim — "how many times have we been round
    this already" — and printing it open would put fifteen lines of past between
    the biller and the note field they came here to type in. The count is in the
    header so the question can be answered without opening anything.
  */
  const timeline = trpc.worklist.timeline.useQuery({ rowId })
  const [historyOpen, setHistoryOpen] = useState(false)

  const busy = setStatus.isPending || setNote.isPending || saveFollowUp.isPending
  const noteChanged = draftNote.trim() !== (note ?? '').trim()
  const followUpChanged = followUp !== toDateInput(followUpAt)
  const followUps = timeline.data?.followUps ?? 0

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
          {/*
            The band leads here too, matching the table. "Why this is Work now"
            is a question a biller has; "why this ranks 72" is one they only have
            because we showed them a 72.
          */}
          <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-gray-500">
            <Info className="h-3.5 w-3.5" aria-hidden="true" />
            Why this is {BAND_LABEL[band as PriorityBand] ?? 'ranked here'}
            <span className="normal-case tracking-normal text-gray-400">
              · {score} of 100
            </span>
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
        <div className="flex items-center justify-between gap-2">
          <label
            htmlFor="row-note"
            className="text-xs font-medium uppercase tracking-wide text-gray-500"
          >
            Note
          </label>
          {/*
            Offered beside the label rather than under the box, because the
            decision it changes — write this myself or say it — is taken before
            anyone starts typing, not after.
          */}
          {!composing && (
            <button
              type="button"
              disabled={busy}
              onClick={() => setComposing(true)}
              className="flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-800 hover:bg-blue-100 disabled:opacity-50"
            >
              <Sparkles className="h-3 w-3" aria-hidden="true" />
              Write with AI
            </button>
          )}
        </div>

        {composing && (
          <NoteComposer
            rowId={rowId}
            busy={busy}
            onClose={() => setComposing(false)}
            /*
              Fills the box; does not save. The model is never what stamps this
              row as touched — a machine writing lastTouchedAt distorts the
              staleness term in the priority score, and therefore the queue.
            */
            onAccept={setDraftNote}
          />
        )}

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
        <PriorNotes events={history.data ?? []} current={note} />
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
            {/*
              Where this date came from. Recording a submission sets one
              automatically, so a biller could open a row and find a date nobody
              remembered choosing — and no way to tell that from one they had set
              themselves and forgotten.
            */}
            <FollowUpOrigin events={history.data ?? []} />
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
        The whole record, from the import that carried this claim in to the last
        thing anyone did to it. Built by lib/claims/timeline.ts and rendered by
        the same component /claims uses, so a biller who looks a claim up on one
        page and opens it on the other is reading one history, not two.
      */}
      <div className="border-t border-gray-200 pt-3">
        <button
          type="button"
          onClick={() => setHistoryOpen(v => !v)}
          aria-expanded={historyOpen}
          className="flex w-full items-center justify-between gap-2 text-left"
        >
          <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-gray-500">
            <History className="h-3.5 w-3.5" aria-hidden="true" />
            Everything that has happened
            {followUps > 0 && (
              <span className="normal-case tracking-normal text-gray-400">
                · {followUps} sent to the payer
              </span>
            )}
          </span>
          <ChevronDown
            className={`h-3.5 w-3.5 shrink-0 text-gray-500 transition-transform ${
              historyOpen ? 'rotate-180' : ''
            }`}
            aria-hidden="true"
          />
        </button>
        {historyOpen && (
          <div className="mt-2">
            <Timeline
              entries={timeline.data?.entries ?? []}
              empty={
                timeline.isLoading
                  ? 'Loading…'
                  : 'Nothing has happened to this claim since it was imported.'
              }
            />
          </div>
        )}
      </div>

      {(setStatus.error || setNote.error || saveFollowUp.error) && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {setStatus.error?.message ?? setNote.error?.message ?? saveFollowUp.error?.message}
        </p>
      )}
    </div>
  )
}

export { STATUS_LABEL, STATUS_VARIANT }

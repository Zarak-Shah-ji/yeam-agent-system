'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Loader2, MessageSquareQuote, Send, Undo2 } from 'lucide-react'
import { trpc } from '@/lib/trpc/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { UpgradeWall } from '@/components/subscription/Upgrade'
import { isUpgradeRequired } from '@/lib/plans'
import { droppedPatientSlots, findPlaceholders, mergeLetter } from '@/lib/appeals/merge'
import { standingContext } from '@/lib/denials/standing-context'
import {
  PANE_LABEL,
  furthestReachablePane,
  isWorkPane,
  nextPane,
  paneReachable,
  prevPane,
  type PaneAvailability,
  type WorkPane,
} from '@/lib/denials/panes'
import { CompleteLetter } from './CompleteLetter'
import { OutcomeList } from './OutcomeList'
import { DraftEditor } from './DraftEditor'
import { RowDetail, dateFromInput, type PendingWork } from './RowDetail'
import { SendPanel } from './SendPanel'
import { StageBar } from './StageBar'
import type { WorklistRow } from './types'

/**
 * Revision shortcuts, in the words a biller would actually use.
 *
 * "Make it shorter" and "less jargon" are first because those were the two most
 * common complaints from working billing managers about machine-drafted
 * appeals. The drafting prompt already caps length and bans buzzwords; these
 * are for the letter that still comes back too long.
 */
const SUGGESTIONS = [
  'Make it shorter',
  'Less jargon, more direct',
  'Cite the payer policy',
  'Lead with the dollar amount',
]

/**
 * The same preferences, phrased for a letter that does not exist yet.
 *
 * Separate from SUGGESTIONS because the grammar differs and the grammar is the
 * whole point: "Make it shorter" is a complaint about an output, "Keep it short"
 * is a brief. Clicking one here adds it to the instruction rather than firing a
 * model call, so two can be combined with a sentence of your own — before the
 * draft they are ingredients, and after it they are commands.
 */
const BRIEFS = [
  'Keep it short',
  'Plain language, no jargon',
  'Cite the payer policy',
  'Lead with the dollar amount',
]

/**
 * The chip that appears once there is a note on the row.
 *
 * The first draft already builds on the note, so this is for the ordinary case
 * where the order was the other way round: draft the letter, call the payer,
 * learn the real reason. The note reaches the model as standing context on every
 * revision regardless — this just spares the biller from having to phrase an
 * instruction to trigger one.
 */
const REWORK_AROUND_NOTE =
  'Rework this around what my note on this claim says. Where the note and the ' +
  'denial reason disagree, argue what the note says.'

/**
 * The panes, re-exported under the name the worklist stores them by.
 *
 * `lastStep` is the column and "step" is what the preference has always been
 * called, so the name stays; lib/denials/panes.ts owns the list.
 */
export type WorkStep = WorkPane

const EMPTY_PENDING: PendingWork = {
  note: '',
  followUp: '',
  noteDirty: false,
  followUpDirty: false,
}

/** Dates cross the wire as Date in some paths and strings in others. */
function asDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

function shortDate(value: Date | string | null | undefined): string | null {
  const d = asDate(value)
  return d ? d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : null
}

/**
 * "Note is in the prompt", and the proof.
 *
 * The note has fed the model since the note existed — BILLER_NOTE_ADDENDUM says
 * THE NOTE WINS, standingContext carries it into every revision — and the
 * product said so in a line of grey text that nobody read, so billers went on
 * retyping the note into the instruction box. The claim is worth nothing without
 * the evidence, so hovering shows the literal string that will be sent, produced
 * by the same function the server calls. Not a paraphrase: a paraphrase is what
 * this chip is trying to stop being.
 */
function NoteInPrompt({ context }: { context: string }) {
  return (
    <span className="group relative inline-block">
      <button
        type="button"
        className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-800"
      >
        <MessageSquareQuote className="mr-1 inline h-3 w-3" aria-hidden="true" />
        Note is in the prompt
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-0 z-20 mb-1 hidden w-80 max-w-[85vw] whitespace-pre-wrap rounded-md border border-gray-200 bg-white p-3 text-left text-xs leading-relaxed text-gray-700 shadow-lg group-hover:block group-focus-within:block"
      >
        <span className="mb-1 block font-medium text-gray-900">
          Sent to the model with every draft and revision:
        </span>
        {context}
      </span>
    </span>
  )
}

/**
 * Work one denial: see why it is ranked here, what the remittance really said,
 * draft the right document, argue with the draft, edit it yourself, then close
 * the loop.
 *
 * This used to be drafting only, which meant the dialog could produce a letter
 * and then had nowhere to record that it was sent — so the recovery funnel was
 * structurally unable to show a recovery. RowDetail carries the other half.
 *
 * IT ALSO OWNS THE TWO LAYERS OF THE LETTER, and that is the reason so much
 * state lives here rather than in the components below.
 *
 *   - `editBody` is the UNMERGED body: server-owned, versioned in DenialDraft,
 *     full of [PATIENT NAME]. It is what saveDraftBody writes and what the model
 *     is given.
 *   - `values` is browser-only PHI. It is merged into the body by mergeLetter
 *     for display and for the packet, and it is never an argument to a mutation.
 *
 * The merged text is a render — computed here, handed down as a string, and
 * never allowed back into editor state or mutation input. Keeping both in one
 * component is what lets the fields be built from the body a biller is typing
 * *right now*, which is what makes deleting a placeholder visibly wrong.
 *
 * Deliberately has no shell of its own — no dialog, no card, no title. It is
 * rendered in two places that frame it differently: beside the table on a wide
 * screen, and inside DraftDialog below that width, where a split pane would
 * leave two unusable halves. One component in two hosts, so the surface a biller
 * uses on a desktop cannot drift from the one they use on a laptop.
 */
export function WorkPanel({
  row,
  claimLabel,
  onDrafted,
  onStep,
  initialStep,
}: {
  row: WorklistRow | null
  claimLabel: string
  onDrafted: () => void
  /**
   * Which pane the biller moved to.
   *
   * Reported rather than controlled: the panel owns where it is, and the
   * worklist only needs to know enough to put someone back here tomorrow.
   */
  onStep?: (step: WorkStep) => void
  /**
   * Where to open. Honoured once per row, once both queries have settled and
   * only if that pane has work in it on this claim.
   */
  initialStep?: WorkStep | null
}) {
  const [instruction, setInstruction] = useState('')
  const rowId = row?.id ?? null

  /*
    What the biller has typed into RowDetail but may not have saved.

    Drafting and revising both send it, and the server writes it before it calls
    the model. Without this the sequence that matters most — type what the payer
    said, then click Draft — threw the note away and produced the generic letter.

    Compared field by field before storing so a re-render of the child cannot
    loop through this state and back.
  */
  const [pending, setPending] = useState<PendingWork>(EMPTY_PENDING)
  const onPendingChange = useCallback((next: PendingWork) => {
    setPending(prev =>
      prev.note === next.note &&
      prev.followUp === next.followUp &&
      prev.noteDirty === next.noteDirty &&
      prev.followUpDirty === next.followUpDirty
        ? prev
        : next,
    )
  }, [])

  /** Only what actually changed: an unedited row must not be stamped as touched. */
  const pendingWork = () => ({
    ...(pending.noteDirty ? { note: pending.note } : {}),
    ...(pending.followUpDirty ? { followUpAt: dateFromInput(pending.followUp) } : {}),
  })

  const drafts = trpc.worklist.drafts.useQuery(
    { rowId: rowId ?? '' },
    { enabled: Boolean(rowId) },
  )

  const draft = trpc.worklist.draft.useMutation({
    onSuccess: () => {
      // The brief has been spent. The same box becomes "ask for a change" once
      // a letter exists, and leaving "Keep it short" sitting in it would read as
      // a pending request rather than one already honoured.
      setInstruction('')
      void drafts.refetch()
      onDrafted()
    },
  })

  const revise = trpc.worklist.revise.useMutation({
    onSuccess: () => {
      setInstruction('')
      void drafts.refetch()
    },
  })

  const usage = trpc.worklist.usage.useQuery()
  /*
    The signature block THIS row signs with.

    Keyed on the row's own practice, not on the workspace and not on whatever
    the practice switcher is set to. Combined mode is the default, so a biller
    working Riverside's claim while looking at all four clinics must still fill
    the letter with Riverside's NPI.

    Resolved on the server by practiceIdentity() — the same function the draft
    mutation signs the body with. Two lookups would eventually disagree, and
    the artefact would be one letter naming two different providers.
  */
  const practice = trpc.practices.identity.useQuery({ practiceId: row?.practiceId ?? null })
  const preference = trpc.worklist.preference.useQuery()

  /*
    The biller's own edit to the letter.

    Keyed on the draft it started from rather than reset in an effect: when a
    revision lands, `current.id` changes and this state stops matching, which
    drops the edit without a single setState in an effect body. The same
    mechanism is what stops v3's text from being shown over v4.
  */
  const [edit, setEdit] = useState<{
    forDraftId: string
    body: string
    /** The version the text came from — what the PHI diff compares against. */
    baseVersion: number
  } | null>(null)
  const [viewVersion, setViewVersion] = useState<number | null>(null)
  const [scratchDismissed, setScratchDismissed] = useState(false)

  const saveBody = trpc.worklist.saveDraftBody.useMutation({
    onSuccess: () => {
      setEdit(null)
      void drafts.refetch()
      // A new version and a stamped lastTouchedAt both change the queue.
      onDrafted()
    },
  })
  const saveScratch = trpc.worklist.saveScratch.useMutation()



  const versions = drafts.data ?? []
  const current = versions[versions.length - 1]
  const busy = draft.isPending || revise.isPending

  /*
    What exists on this row, which is what decides how far you may go.

    The same query OutcomeList runs. Not a second fetch — react-query serves
    both from one cache entry — and asking it here is what lets the footer say
    "record the submission to continue" instead of offering a pane with nothing
    in it.
  */
  const submissions = trpc.worklist.submissions.useQuery(
    { rowId: rowId ?? '' },
    { enabled: Boolean(rowId) },
  )
  const available: PaneAvailability = {
    hasDraft: versions.length > 0,
    hasSubmission: (submissions.data?.length ?? 0) > 0,
  }

  /*
    Which pane is in the frame.

    Resolved during render rather than in an effect, keyed on the row — the same
    pattern RowDetail uses to reset its note field when the panel moves to
    another claim. An effect would paint the wrong pane first and then correct
    it, which on the letter pane is a visible flash of the brief box over a
    letter that already exists.

    It waits for both queries, because both answer "how far can this go". Landing
    on `note` and then jumping to `outcome` a tick later because the submissions
    arrived would move the ground under someone already reading.
  */
  const [paneRow, setPaneRow] = useState<string | null>(null)
  const [pane, setPane] = useState<WorkPane>('note')
  const settling = drafts.isLoading || submissions.isLoading
  if (rowId && paneRow !== rowId && !settling) {
    setPaneRow(rowId)
    /*
      Where they left off, if it is still a place this row can be worked, and
      the furthest pane with work in it otherwise.

      The stored value is validated rather than trusted: `lastStep` is a plain
      String column, and anybody who used the panel before it stepped has one of
      the three old section names in it. Two of those are still panes; the third
      is not, and an unchecked read would render an empty frame.

      The fallback matters more than it looks. Opening a claim that went out a
      fortnight ago on the note pane, with three clicks between the biller and
      the outcome form, is the scrolling complaint in a smaller box.
    */
    const stored = isWorkPane(initialStep) && paneReachable(initialStep, available)
      ? initialStep
      : null
    setPane(stored ?? furthestReachablePane(available))
  }

  /*
    Move, and remember it.

    Persisted on an explicit move only, never on the resolution above — writing
    the resumed pane straight back would stamp a preference nobody chose, and
    the row's own arrival would start counting as a decision.
  */
  const goToPane = useCallback(
    (next: WorkPane) => {
      setPane(next)
      onStep?.(next)
    },
    [onStep],
  )

  const forward = nextPane(pane, available)
  const back = prevPane(pane)

  /*
    Why there is no Next, when the answer is "not yet" rather than "never".

    Only the two gated panes can produce one. On the outcome pane there is no
    next step to explain — the work is finished — and saying so is the footer's
    job, not this string's.
  */
  const blockedReason =
    pane === 'draft' && !available.hasDraft
      ? 'Draft the letter to continue.'
      : pane === 'send' && !available.hasSubmission
        ? 'Record the submission to continue.'
        : null

  // ── The two layers ───────────────────────────────────────────────────────
  const storedBody = current?.body ?? ''
  const editing = edit && current && edit.forDraftId === current.id ? edit : null
  /** What Save, the model and the packet all work from. Never the merged text. */
  const editableBody = editing?.body ?? storedBody
  const baseVersion = editing?.baseVersion ?? current?.version ?? 1
  const baseBody = versions.find(v => v.version === baseVersion)?.body ?? storedBody
  const dirty = editing !== null && editing.body.trim() !== storedBody.trim()

  /** The PHI tripwire, run on every keystroke rather than on Save. */
  const dropped = useMemo(
    () => droppedPatientSlots(baseBody, editableBody),
    [baseBody, editableBody],
  )
  const blocked = dropped.length > 0

  /**
   * Practice fields fill themselves from the workspace; patient fields never do.
   *
   * The org profile is the whole reason /settings exists — an NPI retyped on
   * every appeal is the kind of friction that sends people back to Word.
   */
  const practiceValues = useMemo(() => {
    const p = practice.data
    if (!p) return {} as Record<string, string>
    const address = [
      p.addressLine1,
      p.addressLine2,
      [p.city, p.state, p.postalCode].filter(Boolean).join(', '),
    ]
      .filter(Boolean)
      .join('\n')
    return {
      'PRACTICE NAME': p.practiceName ?? '',
      'PROVIDER NAME': p.practiceName ?? '',
      PROVIDER: p.practiceName ?? '',
      NPI: p.npi ?? '',
      TIN: p.tin ?? '',
      'TAX ID': p.tin ?? '',
      'PRACTICE ADDRESS': address,
      'PRACTICE PHONE': p.contactPhone ?? '',
      'CONTACT NAME': p.contactName ?? '',
      PHONE: p.contactPhone ?? '',
      FAX: p.contactFax ?? '',
    } as Record<string, string>
  }, [practice.data])

  /** Browser-only. Never an argument to a mutation — see the header. */
  const [values, setValues] = useState<Record<string, string>>({})
  const setValue = useCallback((key: string, value: string) => {
    setValues(v => ({ ...v, [key]: value }))
  }, [])

  const allValues = useMemo(() => ({ ...practiceValues, ...values }), [practiceValues, values])
  /** Built from the live body, so deleting a slot removes its field as you type. */
  const slots = useMemo(() => findPlaceholders(editableBody), [editableBody])
  const merged = useMemo(() => mergeLetter(editableBody, allValues), [editableBody, allValues])
  const stillMissing = useMemo(() => findPlaceholders(merged), [merged])

  /*
    Park unsaved keystrokes, two seconds after the typing stops.

    Not an autosave: this writes one column on one preference row, never a
    DenialDraft. A version every two seconds would bury the draft somebody
    wanted to go back to, which is the only reason the version table is
    append-only in the first place. Text that never made it to a version survives
    a closed tab here instead, and is offered back as Restore or Discard.

    Skipped while `blocked`, so the guard is not worked around by never clicking
    Save.
  */
  const parkable = editing && dirty && !blocked ? editing : null
  const parkBody = parkable?.body ?? null
  const parkVersion = parkable?.baseVersion ?? null
  /*
    Held in a ref so the timer below depends only on the text, not on a mutation
    object that is a new value every render. Assigned in an effect rather than
    during render: a ref written while rendering is the thing React's compiler
    rule forbids, and the timer only ever reads it after one has run.
  */
  const park = useRef(saveScratch)
  useEffect(() => {
    park.current = saveScratch
  }, [saveScratch])
  useEffect(() => {
    if (!rowId || parkBody === null || parkVersion === null) return
    const t = setTimeout(
      () => park.current.mutate({ rowId, body: parkBody, baseVersion: parkVersion }),
      2_000,
    )
    return () => clearTimeout(t)
  }, [rowId, parkBody, parkVersion])

  const scratch =
    preference.data?.scratchRowId === rowId && preference.data?.scratchBody && !editing
      ? preference.data
      : null

  /** Commit the edit, then do the thing that is about to replace the letter. */
  async function commitThen(run: () => void) {
    if (rowId && editing && dirty && !blocked) {
      await saveBody.mutateAsync({ rowId, body: editing.body, baseVersion: editing.baseVersion })
    }
    run()
  }

  function save() {
    if (!rowId || !editing || !dirty || blocked) return
    saveBody.mutate({ rowId, body: editing.body, baseVersion: editing.baseVersion })
  }

  /*
    Whether this row is behind the month's allowance.

    A row with a draft already on it has been counted — DenialWorkedEvent is
    unique per row and written with the first draft — so it stays fully workable
    at the limit. Only a row that has never been drafted would spend a new unit,
    and the absence of a draft is exactly how the client can tell.

    The server refuses either way; this is so the customer sees the wall instead
    of a button that fails.
  */
  const walled = !current && (usage.data?.atLimit ?? false)

  // An upgrade refusal is rendered as the wall, not as red text. Every other
  // failure still shows as an error, because it is one.
  const error =
    (isUpgradeRequired(draft.error) ? undefined : draft.error?.message) ??
    revise.error?.message ??
    saveBody.error?.message

  /** The literal standing context — the same string the server builds. */
  const noteContext = row
    ? standingContext({
        note: pending.noteDirty ? pending.note : row.userNote,
        followUpAt: pending.followUpDirty ? dateFromInput(pending.followUp) : asDate(row.followUpAt),
      })
    : null

  return (
    <div className="space-y-4">
      {/*
        The map, and the way back.

        Sticky rather than merely first: the panel scrolls inside the container
        the worklist gives it, and a letter is tall enough that a bar which
        scrolled away would leave somebody midway through a pane with no sign of
        which one it was. Sticky costs nothing in layout — it does not change the
        flow the table's heights were measured against.
      */}
      {row && (
        <div className="sticky top-0 z-10 -mx-1 bg-white px-1 pb-1">
          <StageBar
            row={row}
            draftCount={versions.length}
            pane={pane}
            onPane={goToPane}
          />
        </div>
      )}

      {row && pane === 'note' && (
        <div>
        <RowDetail
          rowId={row.id}
          status={row.status}
          score={row.score}
          band={row.band}
          factors={row.factors}
          refinement={row.refinement}
          note={row.userNote}
          followUpAt={row.followUpAt}
          call={row.call}
          onChanged={onDrafted}
          onPendingChange={onPendingChange}
        />
        </div>
      )}

      <div className="border-t border-gray-200 pt-4" />

      {walled && !drafts.isLoading && (
        <UpgradeWall
          title={`All ${usage.data?.limit} denials for this month have been worked`}
          body="Everything already here stays open — the queue, the numbers, and every letter
            already drafted, including revising and sending them. Upgrade to draft new ones now,
            or carry on when the allowance resets."
        />
      )}

      {/*
        Ask before drafting, not after.

        The revision box has always been able to steer a letter and the Draft
        button never could, so the first letter was the generic one every time and
        the biller's actual preference only arrived as a complaint about the
        output — a second model call to get what they wanted on the first. The
        moment somebody knows most about a claim is before anything is written.
      */}
      {pane === 'draft' && !current && !walled && !drafts.isLoading && (
        <div>
        <div className="space-y-3">
          <p className="text-sm text-gray-600">
            Yeam will pick the right instrument for this denial code — an appeal, a corrected
            claim or a reprocessing request — and draft it.
          </p>

          <div className="rounded-md border border-gray-200 p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
              Anything Yeam should know before it writes?
            </p>
            <p className="mt-1 text-xs text-gray-500">
              How you want it written. Optional — leave it blank and you get the standard letter,
              which you can argue with afterwards either way.
            </p>

            <div className="mt-2 flex flex-wrap gap-1.5">
              {BRIEFS.map(b => {
                const on = instruction.includes(b)
                return (
                  <button
                    key={b}
                    type="button"
                    disabled={busy}
                    /*
                      Toggles into the box instead of drafting on click. Before a
                      draft exists these combine — "keep it short" and "lead with
                      the dollar amount" is one letter, not two.
                    */
                    onClick={() =>
                      setInstruction(prev =>
                        on
                          ? prev
                              .split('. ')
                              .filter(part => part.trim() && part.trim() !== b)
                              .join('. ')
                          : [prev.trim().replace(/\.$/, ''), b].filter(Boolean).join('. '),
                      )
                    }
                    className={`rounded-full border px-3 py-1 text-xs disabled:opacity-50 ${
                      on
                        ? 'border-gray-900 bg-gray-900 text-white'
                        : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {b}
                  </button>
                )
              })}
            </div>

            <Textarea
              rows={2}
              className="mt-2"
              value={instruction}
              disabled={busy}
              onChange={e => setInstruction(e.target.value)}
              placeholder="Lead with the timely-filing argument. Keep it to one page — this payer ignores anything longer."
            />

            <p className="mt-2 text-xs text-gray-500">
              {pending.note.trim() !== ''
                ? 'Your note goes in as fact about the claim; this goes in as direction about the letter. Yeam keeps them apart.'
                : 'Facts about the call belong in the note above — the letter is built around those. This box is for how it should read.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              disabled={busy || !rowId}
              onClick={() =>
                rowId &&
                draft.mutate({
                  rowId,
                  ...(instruction.trim() ? { instruction: instruction.trim() } : {}),
                  ...pendingWork(),
                })
              }
            >
              {draft.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                  Drafting…
                </>
              ) : (
                'Draft the response'
              )}
            </Button>
            {noteContext && <NoteInPrompt context={noteContext} />}
          </div>
        </div>
        </div>
      )}

      {pane === 'draft' && current && (
        <div>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs uppercase tracking-wide text-gray-500">
              {current.artifact.replace(/-/g, ' ')} · version {current.version}
              {current.source === 'BILLER' && ' · edited by hand'}
              {/*
                Which note this version was actually built from. The note on the
                row today may be a different one — the timestamp is captured when
                the version is written for exactly that reason.
              */}
              {current.source !== 'BILLER' && shortDate(current.noteAt) && (
                <span className="ml-1 normal-case tracking-normal text-gray-600">
                  · drafted from your note of {shortDate(current.noteAt)}
                </span>
              )}
            </p>
            {noteContext && <NoteInPrompt context={noteContext} />}
          </div>

          {/*
            Text that never became a version, offered back.

            Shown rather than restored automatically: the stored version is the
            one the rest of the panel already agrees with, and silently replacing
            it with something the biller may have abandoned on purpose is worse
            than asking.
          */}
          {scratch && !scratchDismissed && (
            <div className="flex flex-wrap items-center gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <Undo2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>
                You have unsaved edits to this letter
                {shortDate(scratch.scratchAt) ? ` from ${shortDate(scratch.scratchAt)}` : ''}, based
                on v{scratch.scratchBaseVersion}.
              </span>
              <button
                type="button"
                className="font-medium underline"
                onClick={() => {
                  setEdit({
                    forDraftId: current.id,
                    body: scratch.scratchBody!,
                    baseVersion: scratch.scratchBaseVersion ?? current.version,
                  })
                  setViewVersion(null)
                }}
              >
                Restore
              </button>
              <button
                type="button"
                className="font-medium underline"
                onClick={() => {
                  setScratchDismissed(true)
                  if (rowId) saveScratch.mutate({ rowId, body: null, baseVersion: current.version })
                }}
              >
                Discard
              </button>
            </div>
          )}

          <DraftEditor
            body={
              viewVersion !== null && viewVersion !== current.version
                ? (versions.find(v => v.version === viewVersion)?.body ?? editableBody)
                : editableBody
            }
            storedBody={storedBody}
            versions={versions}
            viewVersion={viewVersion}
            onViewVersion={setViewVersion}
            onChange={body => setEdit({ forDraftId: current.id, body, baseVersion })}
            onBlur={save}
            onRestoreVersion={version => {
              const source = versions.find(v => v.version === version)
              if (!source) return
              setEdit({ forDraftId: current.id, body: source.body, baseVersion: version })
              setViewVersion(null)
            }}
            onSave={save}
            dropped={dropped}
            dirty={dirty}
            saving={saveBody.isPending}
            disabled={busy}
            allValues={allValues}
          />

          {/* Item 12: the fields that finish the letter, under the letter. */}
          <CompleteLetter
            slots={slots}
            values={values}
            onChange={setValue}
            practiceValues={practiceValues}
          />

          <div className="flex flex-wrap gap-1.5">
            {pending.note.trim() !== '' && (
              <button
                type="button"
                disabled={busy || blocked}
                onClick={() =>
                  rowId &&
                  void commitThen(() =>
                    revise.mutate({ rowId, instruction: REWORK_AROUND_NOTE, ...pendingWork() }),
                  )
                }
                className="rounded-full border border-gray-900 bg-gray-900 px-3 py-1 text-xs text-white hover:bg-gray-800 disabled:opacity-50"
              >
                Use my note
              </button>
            )}
            {SUGGESTIONS.map(s => (
              <button
                key={s}
                type="button"
                disabled={busy || blocked}
                onClick={() =>
                  rowId &&
                  void commitThen(() => revise.mutate({ rowId, instruction: s, ...pendingWork() }))
                }
                className="rounded-full border border-gray-300 px-3 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                {s}
              </button>
            ))}
          </div>

          <form
            className="flex gap-2"
            onSubmit={e => {
              e.preventDefault()
              /*
                The edit is committed as a version first, and `revise` then reads
                the letter back out of the database. It deliberately takes no
                body from the client: a body in a mutation argument is a body a
                biller could have typed a patient's name into, and the stored one
                is PHI-free by construction because every write passed the guard.
              */
              if (rowId && instruction.trim() && !blocked)
                void commitThen(() => revise.mutate({ rowId, instruction, ...pendingWork() }))
            }}
          >
            <Input
              value={instruction}
              onChange={e => setInstruction(e.target.value)}
              placeholder="Ask for a change…"
              disabled={busy}
            />
            <Button type="submit" disabled={busy || blocked || !instruction.trim()}>
              {revise.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Send className="h-4 w-4" aria-hidden="true" />
              )}
              <span className="sr-only">Send</span>
            </Button>
          </form>
        </div>
        </div>
      )}

      {/*
        Keyed on the draft id so the send state resets when a revision lands.
        Carrying the previous version's submission form into a new draft would
        record a letter that is neither version.
      */}
      {pane === 'send' && current && rowId && (
        <div className="space-y-3">
          {/*
            The letter is finished on the previous pane, not this one.

            CompleteLetter sits under the editor deliberately — it is built from
            the live body, so a placeholder deleted while typing takes its own
            field with it, and that only works next to the text. Which leaves
            this pane able to report a gap but not to fill it, so it says where
            the filling happens rather than making someone hunt for it.
          */}
          {stillMissing.length > 0 && (
            <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <span>
                {stillMissing.length} field{stillMissing.length === 1 ? '' : 's'} still blank:{' '}
                {stillMissing.map(m => m.label).join(', ')}.
              </span>
              <button
                type="button"
                onClick={() => goToPane('draft')}
                className="font-medium underline"
              >
                Fill them in on the Letter step
              </button>
            </p>
          )}

          <SendPanel
            key={current.id}
            rowId={rowId}
            draftId={current.id}
            draftVersion={current.version}
            merged={merged}
            stillMissing={stillMissing}
            claimLabel={claimLabel}
            onRecorded={onDrafted}
          />
        </div>
      )}

      {pane === 'outcome' && rowId && (
        <OutcomeList rowId={rowId} onRecorded={onDrafted} />
      )}

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}

      {row && !settling && (
        <StepFooter
          pane={pane}
          back={back}
          forward={forward}
          blockedReason={forward === null ? blockedReason : null}
          onGo={goToPane}
        />
      )}
    </div>
  )
}

/**
 * Back on the left, the next step on the right, and the truth in the middle.
 *
 * Sticky to the bottom of the scroll container for the same reason the bar is
 * sticky to the top: a letter is taller than the frame, and a Next button that
 * has to be scrolled to is one a biller will not find twice.
 *
 * ── A sentence where a dead button would be ─────────────────────────────────
 *
 * When there is nowhere to go next it is never because the product is broken —
 * it is because the work of the next pane does not exist yet. There is nothing
 * to send before a letter is written and no ruling to record before anything
 * has gone out. A greyed-out "Next" says none of that, so the button is
 * replaced by the reason, which also names the thing that would fix it.
 */
function StepFooter({
  pane,
  back,
  forward,
  blockedReason,
  onGo,
}: {
  pane: WorkPane
  back: WorkPane | null
  forward: WorkPane | null
  /** Why there is no next step, when there is work that would create one. */
  blockedReason: string | null
  onGo: (pane: WorkPane) => void
}) {
  return (
    <div className="sticky bottom-0 -mx-1 flex items-center justify-between gap-3 border-t border-gray-200 bg-white px-1 pb-1 pt-2">
      {back ? (
        <Button size="sm" variant="ghost" onClick={() => onGo(back)}>
          <ChevronLeft className="mr-1 h-4 w-4" aria-hidden="true" />
          {PANE_LABEL[back]}
        </Button>
      ) : (
        // A placeholder rather than nothing, so Next does not slide left on the
        // first pane and change position between two adjacent steps.
        <span aria-hidden="true" />
      )}

      {forward ? (
        <Button size="sm" onClick={() => onGo(forward)}>
          Next: {PANE_LABEL[forward]}
          <ChevronRight className="ml-1 h-4 w-4" aria-hidden="true" />
        </Button>
      ) : blockedReason ? (
        <p className="text-right text-xs text-gray-500">{blockedReason}</p>
      ) : (
        <p className="text-right text-xs text-gray-500">
          {pane === 'outcome' ? 'This claim is fully worked.' : ''}
        </p>
      )}
    </div>
  )
}

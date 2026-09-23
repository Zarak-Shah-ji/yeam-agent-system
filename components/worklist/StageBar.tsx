'use client'

import { format } from 'date-fns'
import { AlertTriangle } from 'lucide-react'
import { STAGES, stageFor, stageLabels, type Stage } from '@/lib/denials/stages'
import {
  PANE_STAGE,
  paneClickable,
  type WorkPane,
} from '@/lib/denials/panes'
import type { WorklistRow } from './types'

/**
 * How far this denial has got, and what is owed next.
 *
 * The panel could already say what a row's status was — in a badge, in words a
 * state machine would use. What it could not say is the shape of the thing over
 * time: that the letter went out eleven days ago, that this payer usually
 * answers in thirty-four, and that there is therefore nothing to do yet. A
 * biller reconstructed that by reading the note history, the submission list and
 * the call guidance and holding all three in their head.
 *
 * Six dots and one sentence, at the top of the panel where it is read before
 * anything is decided.
 *
 * ── It is also the panel's navigation ───────────────────────────────────────
 *
 * Four of the six stages have a pane behind them (lib/denials/panes.ts), and
 * since the panel started showing one pane at a time this bar is how you move
 * between them. One bar rather than two, because a second row of tabs directly
 * under a row of dots saying almost the same thing is furniture, and the panel
 * is narrow.
 *
 * It therefore carries two facts at once, and they are not the same fact:
 *
 *   - WHERE THE CLAIM IS — the filled dots and the ringed one, derived from the
 *     row by stageFor(). Nobody chose these; they are what is true.
 *   - WHERE YOU ARE — the boxed label, which is a place you navigated to.
 *
 * A row can sit at `sent` while you stand on the note pane reading it back, so
 * the two are drawn in different channels: state in the dots, position in the
 * label. Collapsing them into one highlight would make the bar lie in whichever
 * direction it picked.
 *
 * Clicking goes backwards only. Forward is the Next button's job, because Next
 * is what knows whether the next pane's work is possible yet — see
 * paneReachable(). A bar that could jump ahead would land somebody on the send
 * pane of a claim with no letter.
 *
 * ── Why it is here and not above the table ──────────────────────────────────
 *
 * The left column is a frame: everything above the queue is shrink-0, and the
 * table takes what is left. On a 1366x768 laptop the table gets 430px with the
 * panel closed, and anything added above it comes straight out of that. This is
 * about one claim, so it belongs beside the claim.
 */

/** A date that may have arrived over the wire as a string. */
function day(value: Date | string | null): string {
  if (!value) return '—'
  const d = typeof value === 'string' ? new Date(value) : value
  return Number.isNaN(d.getTime()) ? '—' : format(d, 'MMM d, yyyy')
}

/** Which pane sits on a given stage, if any. Inverted from PANE_STAGE. */
const STAGE_PANE = Object.fromEntries(
  Object.entries(PANE_STAGE).map(([pane, stage]) => [stage, pane as WorkPane]),
) as Partial<Record<Stage, WorkPane>>

export function StageBar({
  row,
  /**
   * Drafts as the panel knows them, not as the table last heard.
   *
   * The row carries a count from the page it was fetched on, so a letter
   * drafted just now would leave the bar a stage behind until the queue
   * refetched — the one moment somebody is actually watching it.
   */
  draftCount,
  pane,
  onPane,
}: {
  row: WorklistRow
  draftCount: number
  /**
   * The pane on screen, when this bar is being used as navigation.
   *
   * Optional, and the bar is a plain read-out without it. /claims renders the
   * same row summary with nothing to navigate.
   */
  pane?: WorkPane | null
  /** Go to a pane. Only ever called with one behind the current one. */
  onPane?: (pane: WorkPane) => void
}) {
  const stage = stageFor(
    {
      status: row.status,
      draftCount,
      denialDate: row.denialDate ? new Date(row.denialDate) : null,
      payer: row.payer ?? null,
      followUpAt: row.followUpAt ? new Date(row.followUpAt) : null,
      call: row.call,
    },
    new Date(),
  )

  const labels = stageLabels(row.status)
  const reached = new Set(stage.reached)

  return (
    <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2.5">
      <ol className="flex items-start gap-1">
        {STAGES.map((s, i) => {
          const done = reached.has(s)
          const here = stage.current === s
          return (
            <li key={s} className="flex min-w-0 flex-1 flex-col items-center gap-1">
              <div className="flex w-full items-center">
                {/*
                  The connectors are drawn as half-segments either side of each
                  dot rather than between them, so the six columns stay equal
                  width and the labels underneath line up with their own dot at
                  any panel width.
                */}
                <span
                  className={`h-px flex-1 ${i === 0 ? 'bg-transparent' : done ? 'bg-gray-400' : 'bg-gray-200'}`}
                />
                <span
                  aria-hidden="true"
                  className={`h-2.5 w-2.5 shrink-0 rounded-full border ${
                    here
                      ? stage.overdue
                        ? 'border-red-600 bg-red-600 ring-2 ring-red-200'
                        : 'border-gray-900 bg-gray-900 ring-2 ring-gray-300'
                      : done
                        ? 'border-gray-400 bg-gray-400'
                        : 'border-gray-300 bg-white'
                  }`}
                />
                <span
                  className={`h-px flex-1 ${
                    i === STAGES.length - 1
                      ? 'bg-transparent'
                      : reached.has(STAGES[i + 1])
                        ? 'bg-gray-400'
                        : 'bg-gray-200'
                  }`}
                />
              </div>
              <StageLabel
                label={labels[s]}
                here={here}
                done={done}
                onPane={onPane}
                pane={STAGE_PANE[s]}
                currentPane={pane ?? null}
              />
            </li>
          )
        })}
      </ol>

      {stage.expectation && (
        <p
          className={`mt-2 flex items-center justify-center gap-1.5 border-t border-gray-200 pt-2 text-xs ${
            stage.overdue ? 'font-medium text-red-700' : 'text-gray-600'
          }`}
        >
          {stage.overdue && <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
          {stage.expectation} {day(stage.expectedBy)}
          {stage.overdue && ' — that date has passed'}
        </p>
      )}
    </div>
  )
}

/**
 * The word under one dot — a button where there is somewhere to go, text where
 * there is not.
 *
 * Deliberately not a button that is merely disabled. A disabled control says
 * "this could work and does not", which is wrong for `Imported`: there is no
 * pane behind it and never will be, so it is not a thing that could be clicked.
 * Panes ahead of you are rendered as text for the same reason — they are not
 * refused, they are simply not how you go forward.
 *
 * The box marks where YOU are; the dot above marks where the CLAIM is. See the
 * header — they are separate channels on purpose.
 */
function StageLabel({
  label,
  here,
  done,
  pane,
  currentPane,
  onPane,
}: {
  label: string
  /** The claim's own current stage. */
  here: boolean
  /** The claim has been through this stage. */
  done: boolean
  /** The pane behind this stage, if there is one. */
  pane: WorkPane | undefined
  /** The pane on screen. Null when the bar is a plain read-out. */
  currentPane: WorkPane | null
  onPane?: (pane: WorkPane) => void
}) {
  const standingHere = pane !== undefined && pane === currentPane
  const canClick =
    pane !== undefined &&
    currentPane !== null &&
    onPane !== undefined &&
    paneClickable(pane, currentPane)

  const tone = standingHere
    ? 'font-semibold text-gray-900'
    : here
      ? 'font-semibold text-gray-900'
      : done
        ? 'text-gray-500'
        : 'text-gray-400'

  // A ring rather than a fill: the label sits directly under a dot that may
  // already be filled for a different reason, and two filled shapes in a column
  // read as one emphasis rather than two facts.
  const box = standingHere ? 'rounded bg-white ring-1 ring-gray-900' : ''

  const content = (
    <>
      {label}
      {/* The dots and the box carry this visually; said once here for a reader
          who is not looking at either. */}
      <span className="sr-only">
        {here ? ' — the claim is at this stage' : done ? ' — done' : ' — not reached'}
        {standingHere ? ' — you are on this step' : ''}
      </span>
    </>
  )

  if (!canClick) {
    return (
      <span
        className={`w-full truncate px-0.5 text-center text-[10px] leading-tight ${tone} ${box}`}
        title={label}
        aria-current={standingHere ? 'step' : undefined}
      >
        {content}
      </span>
    )
  }

  return (
    <button
      type="button"
      onClick={() => onPane!(pane!)}
      className={`w-full truncate rounded px-0.5 text-center text-[10px] leading-tight underline decoration-dotted underline-offset-2 hover:bg-white hover:text-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 ${tone}`}
      title={`Back to ${label}`}
    >
      {content}
    </button>
  )
}

import type { Stage } from './stages'

/**
 * The work panel as four panes, one at a time.
 *
 * It used to be one long scrolling column: the note, then the letter, then the
 * send block, with an IntersectionObserver watching which had come into view.
 * Everything was reachable and nothing was locatable — a biller partway down a
 * 2,000px column has no idea whether the thing they want is above or below, and
 * the outcome form was worse than hidden, because it sat inside the FIRST
 * section while being the LAST thing that happens.
 *
 * So the panel steps. One pane in the frame, Back and Next underneath, and the
 * stage bar at the top doubling as the map.
 *
 * ── Panes are not stages ─────────────────────────────────────────────────────
 *
 * There are six stages in stages.ts and only four panes, and the difference is
 * not an oversight. A stage is where the CLAIM has got to, derived from its
 * facts; a pane is a place a PERSON can stand and do something. `imported` is
 * not somewhere you can stand — it means a file was uploaded — and `awaiting`
 * is the payer's turn, not yours. Giving those two panes of their own would
 * have produced two screens with nothing on them and a Next button to get past
 * them, which is the scrolling problem again in a smaller box.
 *
 * The four that remain map onto the stages they belong to, so one bar can show
 * both: where the claim is, and where you are in it.
 */

export const WORK_PANES = ['note', 'draft', 'send', 'outcome'] as const

export type WorkPane = (typeof WORK_PANES)[number]

/**
 * What each pane is called in the bar.
 *
 * Not the stage labels. A stage is named for a state the claim is in
 * ("Drafted"); a pane is named for the thing in front of you ("Letter"). The
 * bar shows the stage name underneath, so these are the short verbs-turned-nouns
 * that fit a quarter of a panel's width.
 */
export const PANE_LABEL: Record<WorkPane, string> = {
  note: 'Note',
  draft: 'Letter',
  send: 'Send',
  outcome: 'Outcome',
}

/** Which of the six stages each pane sits on. */
export const PANE_STAGE: Record<WorkPane, Stage> = {
  note: 'to_work',
  draft: 'drafted',
  send: 'sent',
  outcome: 'resolved',
}

/** The stages that have no pane, kept here so the bar can say why they are dim. */
export const STAGES_WITHOUT_PANE = ['imported', 'awaiting'] as const satisfies readonly Stage[]

/**
 * What exists on this row, which is what decides where you are allowed to go.
 *
 * Deliberately two booleans rather than the row itself. Whether the send pane
 * is reachable is a question about whether a letter exists, not about status:
 * a row someone marked SENT by hand with no draft on it has nothing to send,
 * and a status-driven rule would have offered them an empty screen.
 */
export type PaneAvailability = {
  hasDraft: boolean
  hasSubmission: boolean
}

/**
 * Can this pane be stood on yet?
 *
 * `note` and `draft` are always open — the draft pane is where a letter gets
 * written, so gating it on a letter existing would make it unreachable forever.
 * The two after it need something to act on.
 */
export function paneReachable(pane: WorkPane, available: PaneAvailability): boolean {
  if (pane === 'send') return available.hasDraft
  if (pane === 'outcome') return available.hasSubmission
  return true
}

/**
 * The furthest pane with work in it.
 *
 * What the panel opens on when nobody has been here before. Opening a sent
 * claim on the note pane and making someone click Next three times to record
 * what the payer said is the scrolling problem wearing a different hat.
 */
export function furthestReachablePane(available: PaneAvailability): WorkPane {
  let furthest: WorkPane = 'note'
  for (const pane of WORK_PANES) {
    if (paneReachable(pane, available)) furthest = pane
  }
  return furthest
}

/** The next pane, or null when there is nowhere further to go yet. */
export function nextPane(pane: WorkPane, available: PaneAvailability): WorkPane | null {
  const at = WORK_PANES.indexOf(pane)
  const candidate = WORK_PANES[at + 1]
  if (!candidate) return null
  return paneReachable(candidate, available) ? candidate : null
}

/**
 * The previous pane, or null on the first one.
 *
 * Never gated. Everything behind you is somewhere you have already been, and a
 * Back button that refuses is a trap.
 */
export function prevPane(pane: WorkPane): WorkPane | null {
  const at = WORK_PANES.indexOf(pane)
  return at > 0 ? WORK_PANES[at - 1] : null
}

/**
 * Is this pane one you may click to from where you are standing?
 *
 * Backwards only. Forward movement goes through Next, which is the thing that
 * knows whether the work of the next pane is possible — letting the bar jump
 * ahead would land someone on a send pane with no letter and an explanation
 * where the letter should be.
 */
export function paneClickable(pane: WorkPane, current: WorkPane): boolean {
  return WORK_PANES.indexOf(pane) < WORK_PANES.indexOf(current)
}

/**
 * A stored pane name, validated.
 *
 * `WorklistPreference.lastStep` is a plain String column holding whatever the
 * client last wrote, which for anyone who used the panel before this change is
 * one of the three old section names. Two of those three are still panes; the
 * check is here so a value that is not gets ignored rather than rendered as a
 * blank frame.
 */
export function isWorkPane(value: unknown): value is WorkPane {
  return typeof value === 'string' && (WORK_PANES as readonly string[]).includes(value)
}

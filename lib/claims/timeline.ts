/**
 * Everything that has happened to one claim, in one list.
 *
 * The product had no per-record history. AgentLog is not org-scoped, and a
 * denial's past could only be reconstructed by eye from lastTouchedAt, its draft
 * versions and its submissions — three different shapes on three different
 * queries. "How many times have we chased this, and what did they say" was the
 * question a biller asks before picking up the phone, and it was unanswerable.
 *
 * Pure on purpose: the router hands it rows and it returns a list, so the
 * ordering and the wording are testable without a database.
 */

export type TimelineKind = 'imported' | 'event' | 'draft' | 'submission'

export type TimelineEntry = {
  at: Date
  kind: TimelineKind
  /** Short label for the left column. */
  label: string
  /** The specifics, when there are any. */
  detail: string | null
  actorId: string | null
}

/** The import a claim arrived on. Derived, never stored per claim. */
export type TimelineImport = { filename: string; at: Date } | null

export type TimelineEvent = {
  kind: string
  detail: string | null
  actorId: string | null
  createdAt: Date
}

export type TimelineDraft = {
  version: number
  artifact: string
  createdAt: Date
  /**
   * Who wrote this version. Optional so a caller that has not selected the
   * column still gets a timeline — it reads as the model's, which is what every
   * version was before the letter became editable.
   */
  source?: 'MODEL' | 'BILLER' | null
}

export type TimelineSubmission = {
  channel: string
  destination: string
  sentAt: Date
  confirmationRef: string | null
  notes: string | null
}

/**
 * One map for both event tables.
 *
 * ClaimEventKind and DenialEventKind overlap on three of their members and
 * differ on the rest, and the two are read by the same builder — a claim's
 * history and its denial row's history are the same history seen from two
 * pages. A kind with no entry falls back to its own name, so an enum member
 * added without a label here reads as SHOUTY_CASE rather than as a blank.
 */
const EVENT_LABEL: Record<string, string> = {
  STATUS_CHANGED: 'Status changed',
  NOTE_ADDED: 'Note',
  FOLLOW_UP_SET: 'Follow-up set',
  CODE_CORRECTED: 'Code corrected',
  REVIEWED: 'Reviewed',
  SENT_TO_WORKLIST: 'Added to worklist',
  // DenialEventKind only. An appeal that came back denied is not finished work,
  // and the row going back to "to work" is the single most important thing in
  // its history — it is the difference between one attempt and three.
  REOPENED: 'Reopened',
}

const CHANNEL_LABEL: Record<string, string> = {
  PORTAL: 'payer portal',
  FAX: 'fax',
  MAIL: 'mail',
  CLEARINGHOUSE: 'clearinghouse',
  PHONE: 'phone',
  OTHER: 'other channel',
}

/**
 * Merge the four sources into one descending list.
 *
 * Newest first, because the question is almost always "what happened last".
 * Ties break in favour of the submission — a status change stamped in the same
 * transaction as the submission that caused it should read underneath it.
 */
export function buildClaimTimeline(input: {
  imported: TimelineImport
  events: TimelineEvent[]
  drafts: TimelineDraft[]
  submissions: TimelineSubmission[]
}): TimelineEntry[] {
  const entries: TimelineEntry[] = []

  if (input.imported) {
    entries.push({
      at: input.imported.at,
      kind: 'imported',
      label: 'Imported',
      detail: `From ${input.imported.filename}`,
      actorId: null,
    })
  }

  for (const e of input.events) {
    entries.push({
      at: e.createdAt,
      kind: 'event',
      label: EVENT_LABEL[e.kind] ?? e.kind,
      detail: e.detail,
      actorId: e.actorId,
    })
  }

  for (const d of input.drafts) {
    entries.push({
      at: d.createdAt,
      kind: 'draft',
      // "Edited" rather than "revised": a biller who rewrote the third
      // paragraph and a model that rewrote the whole letter are different
      // events, and a history that calls both a revision cannot answer "did
      // anyone actually read this before it went".
      label:
        d.source === 'BILLER'
          ? `Letter edited (v${d.version})`
          : d.version === 1
            ? 'Response drafted'
            : `Draft revised (v${d.version})`,
      detail: d.artifact,
      actorId: null,
    })
  }

  for (const s of input.submissions) {
    // The confirmation reference is the timely-filing proof, so it leads.
    const parts = [`Sent by ${CHANNEL_LABEL[s.channel] ?? s.channel.toLowerCase()} to ${s.destination}`]
    if (s.confirmationRef) parts.push(`ref ${s.confirmationRef}`)
    if (s.notes) parts.push(s.notes)
    entries.push({
      at: s.sentAt,
      kind: 'submission',
      label: 'Submitted',
      detail: parts.join(' · '),
      actorId: null,
    })
  }

  const RANK: Record<TimelineKind, number> = { submission: 0, draft: 1, event: 2, imported: 3 }
  return entries.sort((a, b) => {
    const diff = b.at.getTime() - a.at.getTime()
    return diff !== 0 ? diff : RANK[a.kind] - RANK[b.kind]
  })
}

/**
 * How many times the payer has actually been contacted about this claim.
 *
 * Submissions, not drafts: a letter written four times and sent once is one
 * follow-up. This is the number a biller wants before phoning.
 */
export function followUpCount(submissions: TimelineSubmission[]): number {
  return submissions.length
}

/**
 * The last thing a person did to this claim, or null if nobody has.
 *
 * The claim detail used to answer this by rendering three timeline entries near
 * the top and letting the reader work it out. That is the right list to have and
 * the wrong place to make somebody read one — "has anyone already chased this"
 * is the question that decides whether to pick up the phone at all, and a biller
 * who gets it wrong has burned twenty minutes and their place in a hold queue.
 * So it is now one clause on the headline, and the list is one click down.
 *
 * The import is not a touch. It is the only entry in the list that no colleague
 * did, and counting it would mean every claim in a fresh snapshot reports as
 * worked — which is the exact false negative this is here to prevent.
 *
 * Entries arrive newest-first from buildClaimTimeline, so this is the first
 * qualifying one rather than a second sort.
 */
export function lastHumanTouch(entries: TimelineEntry[]): TimelineEntry | null {
  return entries.find(e => e.kind !== 'imported') ?? null
}

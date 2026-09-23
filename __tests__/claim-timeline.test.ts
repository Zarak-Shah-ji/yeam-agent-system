import { describe, it, expect } from 'vitest'
import { buildClaimTimeline, followUpCount, lastHumanTouch } from '@/lib/claims/timeline'

const d = (iso: string) => new Date(iso)

describe('buildClaimTimeline', () => {
  const base = {
    imported: { filename: 'ar-march.csv', at: d('2026-03-01T10:00:00Z') },
    events: [],
    drafts: [],
    submissions: [],
  }

  it('names the file a claim arrived on', () => {
    const [entry] = buildClaimTimeline(base)
    expect(entry.kind).toBe('imported')
    expect(entry.detail).toBe('From ar-march.csv')
  })

  it('puts the newest thing first', () => {
    const timeline = buildClaimTimeline({
      ...base,
      events: [
        { kind: 'NOTE_ADDED', detail: 'Rep says reprocessing', actorId: 'u1', createdAt: d('2026-03-05T09:00:00Z') },
        { kind: 'STATUS_CHANGED', detail: 'DENIED to PAID', actorId: 'u1', createdAt: d('2026-03-20T09:00:00Z') },
      ],
    })

    expect(timeline.map(e => e.label)).toEqual(['Status changed', 'Note', 'Imported'])
  })

  it('labels the denial row kinds too, reopening included', () => {
    // One builder serves both event tables. A DenialEventKind with no entry in
    // EVENT_LABEL would render as SHOUTY_CASE in the work panel.
    const timeline = buildClaimTimeline({
      ...base,
      events: [
        { kind: 'REOPENED', detail: 'Denied again at first level', actorId: 'u1', createdAt: d('2026-04-02T09:00:00Z') },
        { kind: 'FOLLOW_UP_SET', detail: '2026-05-01', actorId: 'u1', createdAt: d('2026-04-01T09:00:00Z') },
      ],
    })

    expect(timeline.map(e => e.label)).toEqual(['Reopened', 'Follow-up set', 'Imported'])
  })

  it('falls back to the raw kind rather than rendering a blank row', () => {
    const [entry] = buildClaimTimeline({
      ...base,
      events: [{ kind: 'SOMETHING_NEW', detail: null, actorId: null, createdAt: d('2026-04-02T09:00:00Z') }],
    })
    expect(entry.label).toBe('SOMETHING_NEW')
  })

  it('reads a submission the way a biller needs it, proof first', () => {
    const [entry] = buildClaimTimeline({
      ...base,
      submissions: [
        {
          channel: 'PORTAL',
          destination: 'Availity — Aetna appeals',
          sentAt: d('2026-04-01T09:00:00Z'),
          confirmationRef: 'CASE-88213',
          notes: null,
        },
      ],
    })

    expect(entry.label).toBe('Submitted')
    expect(entry.detail).toBe('Sent by payer portal to Availity — Aetna appeals · ref CASE-88213')
  })

  it('distinguishes a first draft from a revision', () => {
    const timeline = buildClaimTimeline({
      ...base,
      drafts: [
        { version: 1, artifact: 'Appeal letter', createdAt: d('2026-03-10T09:00:00Z') },
        { version: 2, artifact: 'Appeal letter', createdAt: d('2026-03-11T09:00:00Z') },
      ],
    })

    expect(timeline[0].label).toBe('Draft revised (v2)')
    expect(timeline[1].label).toBe('Response drafted')
  })

  it('tells a biller\u2019s own edit apart from a revision it asked for', () => {
    // Both append a version, so without `source` the history calls them the same
    // thing — and "did anyone actually read this before it went" becomes
    // unanswerable, which is the question the version list exists for.
    const timeline = buildClaimTimeline({
      ...base,
      drafts: [
        { version: 1, artifact: 'Appeal letter', createdAt: d('2026-03-10T09:00:00Z') },
        {
          version: 2,
          artifact: 'Appeal letter',
          createdAt: d('2026-03-11T09:00:00Z'),
          source: 'BILLER',
        },
      ],
    })

    expect(timeline[0].label).toBe('Letter edited (v2)')
    expect(timeline[1].label).toBe('Response drafted')
  })

  it('reads a version with no source as the model\u2019s', () => {
    // Every version written before the letter became editable has no source,
    // and every one of them was drafted by Yeam. The column defaults to MODEL
    // for the same reason.
    const [entry] = buildClaimTimeline({
      ...base,
      drafts: [
        { version: 2, artifact: 'Appeal letter', createdAt: d('2026-03-11T09:00:00Z'), source: null },
      ],
    })
    expect(entry.label).toBe('Draft revised (v2)')
  })

  it('reads a submission above the status change stamped with it', () => {
    // recordSubmission writes both in one transaction, so their timestamps tie.
    // The submission is the thing that happened; the status is bookkeeping.
    const at = d('2026-04-01T09:00:00Z')
    const timeline = buildClaimTimeline({
      ...base,
      events: [{ kind: 'STATUS_CHANGED', detail: 'to SENT', actorId: null, createdAt: at }],
      submissions: [
        { channel: 'FAX', destination: '1-800-555-0100', sentAt: at, confirmationRef: null, notes: null },
      ],
    })

    expect(timeline.map(e => e.kind)).toEqual(['submission', 'event', 'imported'])
  })

  it('falls back to the raw kind for an event it does not know', () => {
    // A new ClaimEventKind must never render as a blank row.
    const [entry] = buildClaimTimeline({
      ...base,
      events: [{ kind: 'SOMETHING_NEW', detail: null, actorId: null, createdAt: d('2026-05-01T09:00:00Z') }],
    })
    expect(entry.label).toBe('SOMETHING_NEW')
  })
})

describe('followUpCount', () => {
  it('counts what actually reached the payer, not what was written', () => {
    // A letter drafted four times and sent once is one follow-up.
    expect(
      followUpCount([
        { channel: 'FAX', destination: 'x', sentAt: d('2026-04-01'), confirmationRef: null, notes: null },
        { channel: 'PHONE', destination: 'y', sentAt: d('2026-04-20'), confirmationRef: null, notes: null },
      ]),
    ).toBe(2)
  })
})

describe('lastHumanTouch', () => {
  const imported = { filename: 'ar-march.csv', at: d('2026-03-01T10:00:00Z') }

  it('does not count the import, so a fresh snapshot reads as unworked', () => {
    // The failure this prevents: every claim in a newly uploaded A/R export
    // reporting as recently worked, which would make the headline clause worse
    // than useless — it would be confidently wrong on the whole file.
    const entries = buildClaimTimeline({ imported, events: [], drafts: [], submissions: [] })
    expect(entries).toHaveLength(1)
    expect(lastHumanTouch(entries)).toBeNull()
  })

  it('is the most recent thing a person did', () => {
    const entries = buildClaimTimeline({
      imported,
      events: [
        { kind: 'NOTE_ADDED', detail: 'called Aetna', actorId: 'u1', createdAt: d('2026-03-04T09:00:00Z') },
        { kind: 'STATUS_CHANGED', detail: 'Denied to Paid', actorId: 'u2', createdAt: d('2026-03-09T09:00:00Z') },
      ],
      drafts: [],
      submissions: [],
    })
    const touch = lastHumanTouch(entries)
    expect(touch?.label).toBe('Status changed')
    expect(touch?.actorId).toBe('u2')
  })

  it('finds the touch even when the import is the newest entry', () => {
    // A monthly A/R export replaces every OrgClaim row, so the import is
    // routinely stamped later than the work that preceded it. Taking the first
    // entry without filtering would report "nobody has worked this" on exactly
    // the claims that have been.
    const entries = buildClaimTimeline({
      imported: { filename: 'ar-april.csv', at: d('2026-04-01T10:00:00Z') },
      events: [
        { kind: 'NOTE_ADDED', detail: 'called Aetna', actorId: 'u1', createdAt: d('2026-03-04T09:00:00Z') },
      ],
      drafts: [],
      submissions: [],
    })
    expect(entries[0].kind).toBe('imported')
    expect(lastHumanTouch(entries)?.label).toBe('Note')
  })

  it('prefers the submission when one is stamped alongside a status change', () => {
    // buildClaimTimeline breaks that tie towards the submission, and the
    // headline clause inherits it: "last chased" is the stronger statement of
    // the two and the one a biller is about to act on.
    const at = d('2026-03-10T09:00:00Z')
    const entries = buildClaimTimeline({
      imported,
      events: [{ kind: 'STATUS_CHANGED', detail: 'To Work to Sent', actorId: 'u1', createdAt: at }],
      drafts: [],
      submissions: [
        { channel: 'FAX', destination: 'Aetna appeals', sentAt: at, confirmationRef: 'FX-1', notes: null },
      ],
    })
    expect(lastHumanTouch(entries)?.kind).toBe('submission')
  })
})

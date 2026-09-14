import { describe, it, expect } from 'vitest'
import { buildClaimTimeline, followUpCount } from '@/lib/claims/timeline'

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

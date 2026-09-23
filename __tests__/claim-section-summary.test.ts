import { describe, expect, it } from 'vitest'
import {
  codeReviewSummary,
  denialSummary,
  lastTouchLine,
  recordWorkSummary,
} from '@/lib/claims/section-summary'

describe('denialSummary', () => {
  it('is null with no reason code, so the section is not rendered at all', () => {
    expect(denialSummary(null)).toBeNull()
  })

  it('carries the code and what it means', () => {
    const s = denialSummary({ code: 'CO-11', label: 'The diagnosis does not support this', daysLeft: 40 })
    expect(s?.code).toBe('CO-11')
    expect(s?.label).toBe('The diagnosis does not support this')
  })

  it('marks the filing window urgent at the same threshold the badge uses', () => {
    expect(denialSummary({ code: 'CO-11', label: null, daysLeft: 14 })?.urgent).toBe(true)
    expect(denialSummary({ code: 'CO-11', label: null, daysLeft: 15 })?.urgent).toBe(false)
    expect(denialSummary({ code: 'CO-11', label: null, daysLeft: 0 })?.urgent).toBe(true)
  })

  it('is not urgent when the window is unknown rather than short', () => {
    expect(denialSummary({ code: 'CO-11', label: null, daysLeft: null })?.urgent).toBe(false)
  })
})

describe('codeReviewSummary', () => {
  // The invariant this whole file exists for: a percentage is never printed
  // without the number of claims behind it.
  const quotesARate = /\d+% paid/
  const statesTheN = /\d+ of your claims/

  it('states the sample size in every branch that quotes a rate', () => {
    const branches = [
      codeReviewSummary({ cpt: '99213', icd10: 'E11.9', history: { n: 41, paidRate: 68 } }),
      codeReviewSummary({ cpt: '99213', icd10: 'E11.9', history: { n: 2, paidRate: 100 } }),
      codeReviewSummary({ cpt: '99213', icd10: null, history: { n: 7, paidRate: 0 }, walled: true }),
      codeReviewSummary({ cpt: null, icd10: 'E11.9', history: { n: 5, paidRate: 50 } }),
    ]
    for (const line of branches) {
      expect(line).toMatch(quotesARate)
      expect(line).toMatch(statesTheN)
    }
  })

  it('never quotes a rate when there is no history to quote', () => {
    const line = codeReviewSummary({ cpt: '99213', icd10: 'E11.9', history: null })
    expect(line).not.toMatch(quotesARate)
    expect(line).toContain('99213 + E11.9')
    expect(line).toContain('no settled claims to compare')
  })

  it('says what is missing when the claim has no codes at all', () => {
    expect(codeReviewSummary({ cpt: null, icd10: null, history: null })).toContain(
      'No codes on this claim',
    )
  })

  it('keeps the free figures on the line when the plan wall covers the reading', () => {
    const line = codeReviewSummary({
      cpt: '99213',
      icd10: 'E11.9',
      history: { n: 41, paidRate: 68 },
      walled: true,
    })
    expect(line).toMatch(statesTheN)
    expect(line).toContain('Practice plan')
  })

  it('says it is working rather than showing a half-built line', () => {
    expect(codeReviewSummary({ cpt: null, icd10: null, history: null, loading: true })).toBe(
      'Checking your history…',
    )
  })
})

describe('recordWorkSummary', () => {
  it('reads as untouched when nothing has been recorded', () => {
    expect(recordWorkSummary(null)).toBe('Nothing recorded yet')
    expect(
      recordWorkSummary({
        statusOverride: null,
        statusLabel: null,
        note: null,
        followUpAt: null,
        lastTouchedAt: null,
      }),
    ).toBe('Nothing recorded yet')
  })

  it('does not count whitespace as a note', () => {
    expect(
      recordWorkSummary({
        statusOverride: null,
        statusLabel: null,
        note: '   ',
        followUpAt: null,
        lastTouchedAt: null,
      }),
    ).toBe('Nothing recorded yet')
  })

  it('reads in the order a biller asks it', () => {
    const line = recordWorkSummary({
      statusOverride: 'DENIED',
      statusLabel: 'Denied',
      note: 'Called Aetna, reprocessing',
      followUpAt: new Date(2026, 9, 3),
      lastTouchedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    })
    expect(line).toContain('Marked Denied')
    expect(line).toContain('follow up Oct 3')
    expect(line).toContain('note from 2 days ago')
    expect(line.indexOf('Marked')).toBeLessThan(line.indexOf('follow up'))
  })

  // A Json/Date column can hold a string, and "Invalid Date" on screen reads as
  // a broken page rather than as missing data.
  it('never renders an invalid date', () => {
    const line = recordWorkSummary({
      statusOverride: 'PAID',
      statusLabel: 'Paid',
      note: 'x',
      followUpAt: 'not-a-date',
      lastTouchedAt: 'not-a-date',
    })
    expect(line).not.toContain('Invalid')
    expect(line).toContain('Marked Paid')
    expect(line).toContain('note added')
  })

  it('accepts ISO strings, which is what the wire actually carries', () => {
    const line = recordWorkSummary({
      statusOverride: null,
      statusLabel: null,
      note: null,
      followUpAt: '2026-10-03T00:00:00.000Z',
      lastTouchedAt: null,
    })
    expect(line).toContain('follow up Oct')
  })
})

describe('lastTouchLine', () => {
  const now = new Date('2026-09-22T12:00:00Z')
  const threeDaysAgo = new Date('2026-09-19T12:00:00Z')

  it('says plainly when nobody has worked it', () => {
    // The false negative that matters most. A claim nobody has touched must
    // never render a clause that could be mistaken for one somebody has.
    expect(lastTouchLine(null, now)).toBe('nobody has worked this yet')
  })

  it('says the same when the date is unreadable rather than inventing one', () => {
    const line = lastTouchLine(
      { at: 'not a date', label: 'Note', kind: 'event', actor: 'Dana' },
      now,
    )
    expect(line).toBe('nobody has worked this yet')
  })

  it('names the colleague, because that is the whole point of the clause', () => {
    const line = lastTouchLine(
      { at: threeDaysAgo, label: 'Note', kind: 'event', actor: 'Dana' },
      now,
    )
    expect(line).toBe('note 3 days ago by Dana')
  })

  it('leaves the name out rather than guessing when the event recorded none', () => {
    const line = lastTouchLine(
      { at: threeDaysAgo, label: 'Response drafted', kind: 'draft', actor: null },
      now,
    )
    expect(line).toBe('response drafted 3 days ago')
  })

  it('reserves "chased" for something that actually reached the payer', () => {
    // A drafted letter that was never sent has not chased anybody, and a biller
    // about to pick up the phone is acting on exactly that difference.
    const sent = lastTouchLine(
      { at: threeDaysAgo, label: 'Submitted', kind: 'submission', actor: null },
      now,
    )
    const drafted = lastTouchLine(
      { at: threeDaysAgo, label: 'Response drafted', kind: 'draft', actor: null },
      now,
    )
    expect(sent).toBe('last chased 3 days ago')
    expect(drafted).not.toContain('chased')
  })

  it('accepts a serialised date, because tRPC hands the client both shapes', () => {
    const line = lastTouchLine(
      { at: threeDaysAgo.toISOString(), label: 'Note', kind: 'event', actor: 'Dana' },
      now,
    )
    expect(line).toBe('note 3 days ago by Dana')
  })
})

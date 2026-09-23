import { describe, it, expect } from 'vitest'
import { STAGES, stageFor, stageLabels, type StageInput } from '@/lib/denials/stages'
import { callGuidance } from '@/lib/denials/score'

/** Fixed "today" so nothing here rots. */
const TODAY = new Date(2026, 8, 17) // 17 Sep 2026

const daysAgo = (n: number) => new Date(TODAY.getTime() - n * 86_400_000)
const daysAhead = (n: number) => new Date(TODAY.getTime() + n * 86_400_000)

const base: StageInput = {
  status: 'TO_WORK',
  draftCount: 0,
  // Aetna's window is not the default, so a payer-named deadline is testable.
  denialDate: daysAgo(10),
  payer: 'Aetna',
  followUpAt: null,
  call: { verdict: 'not-sent', expectedBy: null },
}

const at = (over: Partial<StageInput>) => stageFor({ ...base, ...over }, TODAY)

describe('stageFor', () => {
  it('starts a fresh row at to_work, with imported behind it', () => {
    const s = at({})
    expect(s.current).toBe('to_work')
    expect(s.reached).toEqual(['imported', 'to_work'])
  })

  it('counts a draft as drafted even while the status says TO_WORK', () => {
    // A reopened row goes back to TO_WORK and keeps every letter written for it.
    const s = at({ status: 'TO_WORK', draftCount: 2 })
    expect(s.current).toBe('drafted')
  })

  it('separates sent from awaiting on the payer’s own median, not a fixed wait', () => {
    const inProcess = at({
      status: 'SENT',
      call: callGuidance(
        { status: 'SENT', lastTouchedAt: daysAgo(4), payerMedianDaysToPay: 34 },
        TODAY,
      ),
    })
    expect(inProcess.current).toBe('sent')

    const late = at({
      status: 'SENT',
      call: callGuidance(
        { status: 'SENT', lastTouchedAt: daysAgo(40), payerMedianDaysToPay: 34 },
        TODAY,
      ),
    })
    expect(late.current).toBe('awaiting')
  })

  it('treats a row marked sent with no send date as awaiting an answer', () => {
    const s = at({
      status: 'SENT',
      call: callGuidance(
        { status: 'SENT', lastTouchedAt: null, payerMedianDaysToPay: 34 },
        TODAY,
      ),
    })
    expect(s.current).toBe('awaiting')
  })

  it('does not claim a written-off row was ever drafted or sent', () => {
    // The whole reason `reached` is a set rather than a prefix: filling the bar
    // in would report work that never happened.
    const s = at({ status: 'DEAD' })
    expect(s.current).toBe('resolved')
    expect(s.reached).toEqual(['imported', 'to_work', 'resolved'])
    expect(s.reached).not.toContain('drafted')
  })

  it('marks every stage reached once the money arrives', () => {
    const s = at({ status: 'PAID' })
    expect(s.current).toBe('resolved')
    expect(s.reached).toEqual([...STAGES])
  })

  it('never reports a stage as current that it does not also report as reached', () => {
    const cases: Partial<StageInput>[] = [
      {},
      { draftCount: 1 },
      { status: 'DRAFTED' },
      { status: 'SENT', call: { verdict: 'in-process', expectedBy: daysAhead(20) } },
      { status: 'SENT', call: { verdict: 'overdue', expectedBy: daysAgo(20) } },
      { status: 'PAID' },
      { status: 'DEAD' },
    ]
    for (const c of cases) {
      const s = at(c)
      expect(s.reached, JSON.stringify(c)).toContain(s.current)
    }
  })
})

describe('the expectation on the row', () => {
  it('counts the filing window against us until something is sent', () => {
    // Aetna: 180 days from the denial, 10 days ago.
    const s = at({})
    expect(s.expectedBy).not.toBeNull()
    expect(s.overdue).toBe(false)
    expect(s.expectation).toMatch(/Aetna/)
  })

  it('says the window is an estimate when the payer is not in the rule set', () => {
    const s = at({ payer: 'Some Regional Plan' })
    expect(s.expectation).toMatch(/estimated/i)
  })

  it('flags a filing window that has already closed', () => {
    const s = at({ payer: 'Some Regional Plan', denialDate: daysAgo(200) })
    expect(s.overdue).toBe(true)
  })

  it('offers no date at all when the export carried no denial date', () => {
    // A missing date is not a deadline met. Inventing one would be worse.
    const s = at({ denialDate: null })
    expect(s.expectedBy).toBeNull()
    expect(s.expectation).toBeNull()
    expect(s.overdue).toBe(false)
  })

  it('switches to the payer’s clock once the letter has gone out', () => {
    const call = callGuidance(
      { status: 'SENT', lastTouchedAt: daysAgo(4), payerMedianDaysToPay: 34 },
      TODAY,
    )
    const s = at({ status: 'SENT', call })
    expect(s.expectedBy?.toDateString()).toBe(daysAhead(30).toDateString())
    expect(s.expectation).toMatch(/payer/i)
    expect(s.overdue).toBe(false)
  })

  it('does not re-derive the ETA — it prints the one callGuidance computed', () => {
    const call = callGuidance(
      { status: 'SENT', lastTouchedAt: daysAgo(40), payerMedianDaysToPay: 34 },
      TODAY,
    )
    const s = at({ status: 'SENT', call })
    expect(s.expectedBy?.toDateString()).toBe(call.expectedBy?.toDateString())
    expect(s.overdue).toBe(true)
  })

  it('falls back to the biller’s own follow-up date when there is nothing to measure', () => {
    const s = at({
      status: 'SENT',
      followUpAt: daysAhead(12),
      call: { verdict: 'unknown', expectedBy: null },
    })
    expect(s.expectedBy?.toDateString()).toBe(daysAhead(12).toDateString())
    expect(s.expectation).toMatch(/you said/i)
  })

  it('asks nothing further of a row that is finished', () => {
    for (const status of ['PAID', 'DEAD']) {
      const s = at({ status, followUpAt: daysAgo(90) })
      expect(s.expectedBy, status).toBeNull()
      expect(s.overdue, status).toBe(false)
    }
  })

  it('accepts a date that arrived over the wire as a string', () => {
    // WorklistRow dates are typed Date | string for exactly this reason.
    const s = at({
      status: 'SENT',
      call: { verdict: 'in-process', expectedBy: daysAhead(9).toISOString() },
    })
    expect(s.expectedBy?.toDateString()).toBe(daysAhead(9).toDateString())
  })
})

describe('stageLabels', () => {
  it('names the last stage after what actually happened to the claim', () => {
    expect(stageLabels('PAID').resolved).toBe('Recovered')
    expect(stageLabels('DEAD').resolved).toBe('Written off')
    expect(stageLabels('SENT').resolved).toBe('Resolved')
  })

  it('labels every stage', () => {
    const labels = stageLabels('TO_WORK')
    for (const s of STAGES) expect(labels[s], s).toBeTruthy()
  })
})

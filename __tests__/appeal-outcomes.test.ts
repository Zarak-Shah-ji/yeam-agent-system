import { describe, it, expect } from 'vitest'
import {
  byArtifact,
  byPayerAndCode,
  coverage,
  daysToResolution,
  isWin,
  rowStatusForOutcome,
  tally,
  type OutcomeRecord,
  type SubmissionOutcomeValue,
} from '@/lib/denials/outcomes'

/**
 * The counting rules are the product.
 *
 * A win rate that is quietly wrong is worse than no win rate at all: a biller
 * who reads "CO-97 to Aetna never works" stops appealing it, loses money that
 * was recoverable, and never finds out. So every rule that decides what counts
 * is pinned here against a case where the answer is obvious by inspection.
 */

const SENT = new Date('2026-03-01T12:00:00Z')

function record(over: Partial<OutcomeRecord> = {}): OutcomeRecord {
  return {
    payerKey: 'aetna',
    payerLabel: 'Aetna',
    carc: 'CO-97',
    cpt: '99213',
    artifact: 'appeal-letter',
    channel: 'PORTAL',
    outcome: 'PENDING',
    sentAt: SENT,
    outcomeAt: null,
    billed: 400,
    amountRecovered: null,
    outcomeCarc: null,
    ...over,
  }
}

function resolved(outcome: SubmissionOutcomeValue, over: Partial<OutcomeRecord> = {}) {
  return record({ outcome, outcomeAt: new Date('2026-04-10T12:00:00Z'), ...over })
}

describe('what counts as a win', () => {
  it('counts a partial payment as a win', () => {
    // The common win in appeals: the payer allows two of three units. Folding
    // it into DENIED would understate every argument that actually works.
    expect(isWin('PARTIAL')).toBe(true)
    expect(isWin('PAID')).toBe(true)
    expect(isWin('DENIED')).toBe(false)
  })

  it('leaves a pending appeal out of the rate entirely', () => {
    // An appeal filed last Tuesday has not lost. Scoring it as one makes every
    // recent argument look bad and swings the rate with filing volume.
    const t = tally([resolved('PAID'), record(), record(), record()])
    expect(t.attempts).toBe(4)
    expect(t.pending).toBe(3)
    expect(t.decided).toBe(1)
    expect(t.winRate).toBe(100)
  })

  it('does not blame the argument for the payer’s silence', () => {
    const t = tally([resolved('PAID'), resolved('NO_RESPONSE')])
    expect(t.noResponse).toBe(1)
    // One ruling, and it was a win. Silence is counted and shown, not scored.
    expect(t.decided).toBe(1)
    expect(t.winRate).toBe(100)
  })

  it('drops a withdrawn appeal out of every number', () => {
    const t = tally([resolved('DENIED'), resolved('WITHDRAWN')])
    expect(t.withdrawn).toBe(1)
    expect(t.decided).toBe(1)
    expect(t.winRate).toBe(0)
  })

  it('is null, not zero, when nothing has been decided', () => {
    // 0/0 is not "this never works". The two must never look the same.
    expect(tally([record(), record()]).winRate).toBeNull()
    expect(tally([]).winRate).toBeNull()
  })

  it('reports the rate in percentage points, matching pct()', () => {
    const t = tally([resolved('PAID'), resolved('PARTIAL'), resolved('DENIED'), resolved('DENIED')])
    expect(t.winRate).toBe(50)
    expect(t.won).toBe(2)
    expect(t.partial).toBe(1)
    expect(t.denied).toBe(2)
  })
})

describe('dollars', () => {
  it('sums only what the wins actually brought in', () => {
    const t = tally([
      resolved('PAID', { amountRecovered: 400 }),
      resolved('PARTIAL', { amountRecovered: 150 }),
      resolved('DENIED', { amountRecovered: null }),
    ])
    expect(t.recovered).toBe(550)
    // At stake spans every ruling, won or lost — it is the denominator the
    // recovery is read against.
    expect(t.atStake).toBe(1200)
  })

  it('counts a win with no amount recorded as a win', () => {
    // The rate must not depend on a field the form does not require, or the
    // ledger quietly rewards whoever had the remit in front of them.
    const t = tally([resolved('PAID', { amountRecovered: null })])
    expect(t.winRate).toBe(100)
    expect(t.recovered).toBe(0)
  })
})

describe('turnaround', () => {
  it('is the median, not the mean', () => {
    const days = (n: number) =>
      resolved('PAID', { outcomeAt: new Date(SENT.getTime() + n * 86_400_000) })
    // One 400-day appeal is normal and would drag a mean somewhere useless.
    const t = tally([days(20), days(30), days(40), days(400)])
    expect(t.medianDays).toBe(35)
  })

  it('ignores a determination dated before the submission', () => {
    // A mistyped year must not pull the median backwards.
    expect(daysToResolution(SENT, new Date('2025-04-10T12:00:00Z'))).toBeNull()
    const t = tally([
      resolved('PAID', { outcomeAt: new Date('2025-01-01T12:00:00Z') }),
      resolved('PAID', { outcomeAt: new Date(SENT.getTime() + 10 * 86_400_000) }),
    ])
    expect(t.medianDays).toBe(10)
  })

  it('leaves an undated ruling out of the median but in the rate', () => {
    const t = tally([resolved('PAID', { outcomeAt: null })])
    expect(t.winRate).toBe(100)
    expect(t.medianDays).toBeNull()
  })
})

describe('grouping', () => {
  it('keys on payer, code and instrument together', () => {
    const groups = byPayerAndCode([
      resolved('PAID'),
      resolved('DENIED'),
      resolved('PAID', { payerKey: 'cigna', payerLabel: 'Cigna' }),
    ])
    expect(groups).toHaveLength(2)
    expect(groups[0].label).toBe('Aetna · CO-97')
    expect(groups[0].decided).toBe(2)
    expect(groups[0].winRate).toBe(50)
  })

  it('sorts by decided volume so a 1-for-1 record cannot head the table', () => {
    const many = Array.from({ length: 6 }, () => resolved('DENIED'))
    const one = resolved('PAID', { payerKey: 'cigna', payerLabel: 'Cigna' })
    const groups = byPayerAndCode([one, ...many])
    expect(groups[0].label).toBe('Aetna · CO-97')
    expect(groups[0].decided).toBe(6)
  })

  it('drops rows with no payer rather than bucketing them together', () => {
    // "Unknown payer" as a group is a finding about nothing.
    const groups = byPayerAndCode([resolved('PAID', { payerKey: null, payerLabel: null })])
    expect(groups).toHaveLength(0)
  })

  it('separates instruments so the playbook can be checked against reality', () => {
    const groups = byArtifact([
      resolved('DENIED'),
      resolved('DENIED'),
      resolved('PAID', { artifact: 'reconsideration' }),
    ])
    const letters = groups.find(g => g.key === 'appeal-letter')!
    const recon = groups.find(g => g.key === 'reconsideration')!
    expect(letters.winRate).toBe(0)
    expect(recon.winRate).toBe(100)
  })
})

describe('coverage', () => {
  it('says how much of the ledger is actually filled in', () => {
    const c = coverage([resolved('PAID'), record(), record(), record()])
    expect(c).toEqual({ total: 4, resolved: 1, pending: 3, rate: 25 })
  })

  it('is null with nothing sent, not 0%', () => {
    expect(coverage([]).rate).toBeNull()
  })
})

describe('where the row lands', () => {
  it('reopens a denied appeal instead of closing it', () => {
    // A second-level appeal to a different address is the normal next step.
    // DEAD here would bury recoverable money behind a status nobody revisits.
    expect(rowStatusForOutcome('DENIED')).toBe('TO_WORK')
    expect(rowStatusForOutcome('NO_RESPONSE')).toBe('TO_WORK')
  })

  it('marks a partial payment recovered, same as a full one', () => {
    expect(rowStatusForOutcome('PAID')).toBe('PAID')
    expect(rowStatusForOutcome('PARTIAL')).toBe('PAID')
  })

  it('leaves the row alone when the appeal was withdrawn', () => {
    expect(rowStatusForOutcome('WITHDRAWN')).toBeNull()
  })
})

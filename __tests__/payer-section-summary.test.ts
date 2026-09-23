import { describe, expect, it } from 'vitest'
import {
  appealsSummary,
  channelLine,
  payerHeadline,
  paymentsSummary,
  reasonsSummary,
  sendSummary,
} from '@/lib/insights/payer-summary'
import type { OutcomeTally } from '@/lib/denials/outcomes'
import type { ResolvedDestination } from '@/lib/billing/submission'

const base = {
  atStake: 2558,
  openDenials: 13,
  expiringSoon: 0,
  expired: 0,
  expiredBilled: 0,
  filingWindowDays: 90,
  filingWindowSource: 'payer' as const,
}

function tally(over: Partial<OutcomeTally> = {}): OutcomeTally {
  return {
    attempts: 0,
    pending: 0,
    decided: 0,
    won: 0,
    partial: 0,
    denied: 0,
    noResponse: 0,
    withdrawn: 0,
    winRate: null,
    recovered: 0,
    atStake: 0,
    medianDays: null,
    ...over,
  }
}

function dest(over: Partial<ResolvedDestination> = {}): ResolvedDestination {
  return {
    source: 'directory',
    payerLabel: 'Aetna',
    payerKey: 'aetna',
    options: [],
    requiredForm: null,
    requiredFormNote: null,
    attachments: [],
    ediPayerId: null,
    needsVerification: false,
    ...over,
  }
}

describe('payerHeadline', () => {
  it('leads with recoverable money and the denials it sits on', () => {
    const h = payerHeadline(base)
    expect(h.amount).toBe(2558)
    expect(h.lead).toBe('recoverable')
    expect(h.context).toEqual(['on 13 open denials', '90-day appeal window'])
    expect(h.urgent).toEqual([])
  })

  it('shouts only about money that is about to go or has gone', () => {
    const h = payerHeadline({ ...base, expiringSoon: 115, expired: 7, expiredBilled: 932 })
    expect(h.urgent).toEqual(['$115 closes within 14 days', '$932 already past the window'])
  })

  it('says when the window is a guess', () => {
    expect(payerHeadline({ ...base, filingWindowSource: 'default' }).context).toContain(
      '90-day appeal window (estimated)',
    )
  })

  it('has no amount when every open denial is past saving, but still says what was lost', () => {
    const h = payerHeadline({ ...base, atStake: 0, openDenials: 3, expired: 3, expiredBilled: 400 })
    expect(h.amount).toBeNull()
    expect(h.lead).toBe('Nothing recoverable')
    expect(h.urgent).toEqual(['$400 already past the window'])
  })

  it('says nothing is open rather than showing $0', () => {
    const h = payerHeadline({ ...base, atStake: 0, openDenials: 0 })
    expect(h.amount).toBeNull()
    expect(h.lead).toBe('Nothing open on the worklist')
  })

  it('counts one denial in the singular', () => {
    expect(payerHeadline({ ...base, openDenials: 1 }).context[0]).toBe('on 1 open denial')
  })
})

describe('reasonsSummary', () => {
  it('is null with no reasons, so the section is not rendered', () => {
    expect(reasonsSummary([])).toBeNull()
  })

  it('names the top reason and counts the rest', () => {
    const s = reasonsSummary([
      { carc: 'CO-197', label: 'Precertification absent', count: 3, billed: 250 },
      { carc: 'CO-151', label: 'Too many services', count: 2, billed: 1069 },
      { carc: 'CO-96', label: 'Non-covered', count: 2, billed: 369 },
    ])
    expect(s).toEqual({ carc: 'CO-197', label: 'Precertification absent', more: 2 })
  })
})

describe('paymentsSummary', () => {
  it('is null without a snapshot — no denominator, no section', () => {
    expect(paymentsSummary({ claims: 0, denialRate: null, medianDaysToPay: null })).toBeNull()
  })

  it('never quotes the denial rate without the claims behind it', () => {
    const line = paymentsSummary({ claims: 240, denialRate: 5.4, medianDaysToPay: 32 })
    expect(line).toBe('Deny 5.4% of 240 claims · typically pay in 32 days')
  })

  it('leaves out days to pay when nothing has settled', () => {
    expect(paymentsSummary({ claims: 1, denialRate: 0, medianDaysToPay: null })).toBe(
      'Deny 0.0% of 1 claim',
    )
  })
})

describe('appealsSummary', () => {
  const quotesARate = /\d+%/

  it('is null when nothing was ever sent, so the section is not rendered', () => {
    expect(appealsSummary(null)).toBeNull()
    expect(appealsSummary(tally())).toBeNull()
  })

  it('states the rulings behind every count, and a rate only past the sample floor', () => {
    const thin = appealsSummary(tally({ attempts: 4, decided: 4, won: 3, winRate: 75 }))
    expect(thin).toBe('Won 3 of 4 rulings — too few to judge')
    expect(thin).not.toMatch(quotesARate)

    const enough = appealsSummary(
      tally({ attempts: 22, decided: 20, won: 12, winRate: 60, recovered: 4200, pending: 2 }),
    )
    expect(enough).toBe('Won 12 of 20 rulings (60%) · $4,200 recovered · 2 waiting')
  })

  it('says what is pending rather than implying a loss', () => {
    expect(appealsSummary(tally({ attempts: 2, pending: 2 }))).toBe(
      '2 appeals sent, waiting on a ruling',
    )
    expect(appealsSummary(tally({ attempts: 1, noResponse: 1 }))).toBe(
      '1 appeal sent, never answered',
    )
  })
})

describe('sendSummary', () => {
  it('says so when nothing is on file', () => {
    expect(sendSummary(null)).toBe('Nothing on file yet')
    expect(sendSummary(dest())).toBe('Nothing on file yet')
    expect(sendSummary(null, true)).toBe('Looking it up…')
  })

  it('leads with the preferred channel and counts the others', () => {
    const line = sendSummary(
      dest({
        options: [
          { channel: 'PORTAL', label: 'Availity Essentials', url: 'https://availity.com' },
          { channel: 'MAIL', label: 'Aetna\nPO Box 1\nDallas, TX' },
        ],
        needsVerification: true,
      }),
    )
    expect(line).toBe('Portal · Availity Essentials · 1 more · check before sending')
  })

  it('credits the customer when the entry is theirs', () => {
    const line = sendSummary(
      dest({ source: 'org', options: [{ channel: 'FAX', label: '555-0100' }] }),
    )
    expect(line).toBe('Fax · 555-0100 · saved by you')
  })

  it('summarises an address by its first line and a clearinghouse by its payer ID', () => {
    expect(channelLine({ channel: 'MAIL', label: 'TMHP\nPO Box 200645\nAustin' }, null)).toBe(
      'Mail · TMHP',
    )
    expect(channelLine({ channel: 'CLEARINGHOUSE', label: 'Resubmit…' }, '84980')).toBe(
      'Clearinghouse · EDI payer ID 84980',
    )
  })
})

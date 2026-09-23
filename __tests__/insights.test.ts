import { describe, it, expect } from 'vitest'
import {
  arAging,
  anchorDate,
  denialTrend,
  outstanding,
  overview,
  payerScorecard,
  recoveryFunnel,
  revenueByMonth,
  topCarcs,
  topCodes,
  type ClaimFact,
  type DenialFact,
} from '@/lib/insights/aggregate'

/** Fixed "today" so bucket assertions don't rot. */
const TODAY = new Date(2026, 7, 26) // 26 Aug 2026

function claim(over: Partial<ClaimFact> = {}): ClaimFact {
  return {
    payer: 'Aetna',
    status: 'PENDING',
    billed: 100,
    allowed: null,
    paid: null,
    patientResp: null,
    adjustment: null,
    serviceDate: new Date(2026, 7, 1),
    submittedDate: new Date(2026, 7, 2),
    remitDate: null,
    cpt: '99213',
    icd10: 'M54.50',
    carc: null,
    ...over,
  }
}

function denial(over: Partial<DenialFact> = {}): DenialFact {
  return {
    carc: 'CO-50',
    billed: 200,
    denialDate: new Date(2026, 7, 1),
    payer: 'Aetna',
    status: 'TO_WORK',
    ...over,
  }
}

/** n days before TODAY. */
function daysAgo(n: number): Date {
  const d = new Date(TODAY)
  d.setDate(d.getDate() - n)
  return d
}

describe('outstanding', () => {
  it('counts nothing for a settled claim', () => {
    expect(outstanding(claim({ status: 'PAID', paid: 60 }))).toBe(0)
    expect(outstanding(claim({ status: 'WRITTEN_OFF' }))).toBe(0)
  })

  it('is billed less what came in and what was adjusted away', () => {
    expect(outstanding(claim({ status: 'PARTIAL', billed: 100, paid: 40, adjustment: 25 }))).toBe(35)
    expect(outstanding(claim({ status: 'DENIED', billed: 250 }))).toBe(250)
  })

  it('floors at zero so an overpayment cannot cancel a real balance', () => {
    expect(outstanding(claim({ status: 'PARTIAL', billed: 100, paid: 140 }))).toBe(0)
  })

  it('does not report float dust as an outstanding balance', () => {
    // 177.86 - 105.99 - 71.87 leaves 1.4e-14, which is not zero and would age
    // as a real receivable and render as "$0.00" rather than "no balance".
    expect(outstanding(claim({ status: 'PARTIAL', billed: 177.86, paid: 105.99, adjustment: 71.87 }))).toBe(0)
  })
})

describe('arAging', () => {
  it('puts each balance in the right bucket', () => {
    const { buckets, total } = arAging(
      [
        claim({ billed: 100, serviceDate: daysAgo(5) }),
        claim({ billed: 200, serviceDate: daysAgo(45) }),
        claim({ billed: 300, serviceDate: daysAgo(75) }),
        claim({ billed: 400, serviceDate: daysAgo(100) }),
        claim({ billed: 500, serviceDate: daysAgo(200) }),
      ],
      TODAY,
    )
    expect(buckets.map(b => [b.bucket, b.amount])).toEqual([
      ['0-30', 100],
      ['31-60', 200],
      ['61-90', 300],
      ['91-120', 400],
      ['120+', 500],
    ])
    expect(total).toBe(1500)
  })

  it('gets the bucket boundaries exactly right', () => {
    const at = (n: number) => arAging([claim({ serviceDate: daysAgo(n) })], TODAY).buckets.find(b => b.count > 0)!.bucket
    expect(at(30)).toBe('0-30')
    expect(at(31)).toBe('31-60')
    expect(at(60)).toBe('31-60')
    expect(at(61)).toBe('61-90')
    expect(at(120)).toBe('91-120')
    expect(at(121)).toBe('120+')
  })

  it('excludes settled claims entirely', () => {
    const { total, buckets } = arAging(
      [claim({ status: 'PAID', paid: 100, serviceDate: daysAgo(10) })],
      TODAY,
    )
    expect(total).toBe(0)
    expect(buckets.every(b => b.count === 0)).toBe(true)
  })

  it('reports an undated balance separately rather than aging it', () => {
    const { undated, buckets } = arAging(
      [claim({ billed: 90, serviceDate: null, submittedDate: null, remitDate: null })],
      TODAY,
    )
    expect(undated).toEqual({ amount: 90, count: 1 })
    expect(buckets.every(b => b.count === 0)).toBe(true)
  })

  it('returns zeroes, not NaN, for an empty snapshot', () => {
    const { buckets, total, undated } = arAging([], TODAY)
    expect(total).toBe(0)
    expect(undated).toEqual({ amount: 0, count: 0 })
    expect(buckets).toHaveLength(5)
    expect(buckets.every(b => b.amount === 0)).toBe(true)
  })

  it('reports the average and oldest age of each bucket', () => {
    const { buckets } = arAging(
      [
        claim({ billed: 100, serviceDate: daysAgo(130) }),
        claim({ billed: 100, serviceDate: daysAgo(200) }),
        claim({ billed: 100, serviceDate: daysAgo(400) }),
      ],
      TODAY,
    )
    const oldest = buckets.find(b => b.bucket === '120+')!
    expect(oldest.count).toBe(3)
    // (130 + 200 + 400) / 3
    expect(oldest.avgDays).toBe(243)
    expect(oldest.oldestDays).toBe(400)
  })

  it('averages per claim, not weighted by dollars', () => {
    // One large fresh claim against one small old one. A dollar-weighted mean
    // would land near 10 days; this is deliberately the plain mean.
    const { buckets } = arAging(
      [
        claim({ billed: 10_000, serviceDate: daysAgo(10) }),
        claim({ billed: 100, serviceDate: daysAgo(20) }),
      ],
      TODAY,
    )
    expect(buckets.find(b => b.bucket === '0-30')!.avgDays).toBe(15)
  })

  it('leaves an empty bucket null rather than zero days', () => {
    // Zero would read as "these are brand new" instead of "there are none".
    const { buckets } = arAging([claim({ serviceDate: daysAgo(5) })], TODAY)
    expect(buckets.find(b => b.bucket === '0-30')!.avgDays).toBe(5)
    for (const empty of buckets.filter(b => b.count === 0)) {
      expect(empty.avgDays).toBeNull()
      expect(empty.oldestDays).toBeNull()
    }
  })

  it('does not age an undated balance into the day counts', () => {
    const { buckets } = arAging(
      [claim({ billed: 90, serviceDate: null, submittedDate: null, remitDate: null })],
      TODAY,
    )
    expect(buckets.every(b => b.avgDays === null && b.oldestDays === null)).toBe(true)
  })
})

describe('anchorDate', () => {
  it('prefers service date, then submitted, then remit', () => {
    const svc = new Date(2026, 0, 1)
    const sub = new Date(2026, 1, 1)
    const rem = new Date(2026, 2, 1)
    expect(anchorDate(claim({ serviceDate: svc, submittedDate: sub, remitDate: rem }))).toBe(svc)
    expect(anchorDate(claim({ serviceDate: null, submittedDate: sub, remitDate: rem }))).toBe(sub)
    expect(anchorDate(claim({ serviceDate: null, submittedDate: null, remitDate: rem }))).toBe(rem)
    expect(anchorDate(claim({ serviceDate: null, submittedDate: null, remitDate: null }))).toBeNull()
  })
})

describe('revenueByMonth', () => {
  it('measures what came in rather than multiplying what went out', () => {
    const rows = revenueByMonth([
      claim({ serviceDate: new Date(2026, 5, 3), billed: 100, allowed: 70, paid: 70 }),
      claim({ serviceDate: new Date(2026, 5, 20), billed: 200, allowed: 120, paid: 90 }),
      claim({ serviceDate: new Date(2026, 6, 4), billed: 50, allowed: 40, paid: 0 }),
    ])
    expect(rows).toEqual([
      { month: '2026-06', billed: 300, allowed: 190, paid: 160, count: 2 },
      { month: '2026-07', billed: 50, allowed: 40, paid: 0, count: 1 },
    ])
  })

  it('is sorted oldest first and skips undated rows', () => {
    const rows = revenueByMonth([
      claim({ serviceDate: new Date(2026, 8, 1) }),
      claim({ serviceDate: new Date(2026, 2, 1) }),
      claim({ serviceDate: null, submittedDate: null, remitDate: null }),
    ])
    expect(rows.map(r => r.month)).toEqual(['2026-03', '2026-09'])
  })
})

describe('denialTrend', () => {
  it('divides denials by the claims in that month', () => {
    const rows = denialTrend([
      claim({ serviceDate: new Date(2026, 5, 1), status: 'PAID' }),
      claim({ serviceDate: new Date(2026, 5, 2), status: 'PAID' }),
      claim({ serviceDate: new Date(2026, 5, 3), status: 'DENIED', billed: 400 }),
      claim({ serviceDate: new Date(2026, 5, 4), status: 'DENIED', billed: 100 }),
    ])
    expect(rows).toEqual([
      { month: '2026-06', total: 4, denied: 2, rejected: 0, denialRate: 50, deniedBilled: 500 },
    ])
  })

  it('counts a clearinghouse rejection separately from a payer denial', () => {
    const rows = denialTrend([
      claim({ serviceDate: new Date(2026, 5, 1), status: 'REJECTED' }),
      claim({ serviceDate: new Date(2026, 5, 2), status: 'PAID' }),
    ])
    expect(rows[0].rejected).toBe(1)
    expect(rows[0].denied).toBe(0)
    expect(rows[0].denialRate).toBe(0)
  })

  it('returns an empty series rather than dividing by zero', () => {
    expect(denialTrend([])).toEqual([])
  })
})

describe('payerScorecard', () => {
  const claims = [
    claim({ payer: 'Aetna', status: 'PAID', billed: 1000, allowed: 600, paid: 600, submittedDate: new Date(2026, 5, 1), remitDate: new Date(2026, 5, 21) }),
    claim({ payer: 'Aetna', status: 'DENIED', billed: 500, allowed: 0, paid: 0 }),
    claim({ payer: 'Texas Medicaid', status: 'PAID', billed: 400, allowed: 200, paid: 200, submittedDate: new Date(2026, 5, 1), remitDate: new Date(2026, 5, 11) }),
  ]
  const denials = [
    denial({ payer: 'Aetna', carc: 'CO-97', billed: 500, denialDate: daysAgo(10) }),
    denial({ payer: 'Aetna', carc: 'CO-97', billed: 300, denialDate: daysAgo(20) }),
    denial({ payer: 'Aetna', carc: 'CO-11', billed: 100, denialDate: daysAgo(5) }),
  ]

  it('reports the snapshot and worklist halves in separate columns', () => {
    const [aetna] = payerScorecard(claims, denials, TODAY)
    expect(aetna.payer).toBe('Aetna')
    expect(aetna.claims).toBe(2)
    expect(aetna.billed).toBe(1500)
    expect(aetna.denialRate).toBe(50)
    expect(aetna.grossCollectionRate).toBe(40) // 600/1500
    expect(aetna.netCollectionRate).toBe(100) // 600/600
    // From the worklist, not the snapshot. Never summed with `billed`.
    expect(aetna.atStake).toBe(900)
    expect(aetna.openDenials).toBe(3)
  })

  it('names the payer’s most common denial reason', () => {
    const [aetna] = payerScorecard(claims, denials, TODAY)
    expect(aetna.topCarc).toMatchObject({ carc: 'CO-97', count: 2 })
  })

  it('uses the payer’s real filing window', () => {
    const rows = payerScorecard(claims, denials, TODAY)
    expect(rows.find(r => r.payer === 'Aetna')!.filingWindowDays).toBe(180)
    expect(rows.find(r => r.payer === 'Aetna')!.filingWindowSource).toBe('payer')
    expect(rows.find(r => r.payer === 'Texas Medicaid')!.filingWindowDays).toBe(90)
  })

  it('takes the median days to pay so one outlier cannot move it', () => {
    const rows = payerScorecard(claims, denials, TODAY)
    expect(rows.find(r => r.payer === 'Aetna')!.medianDaysToPay).toBe(20)
    expect(rows.find(r => r.payer === 'Texas Medicaid')!.medianDaysToPay).toBe(10)
  })

  it('leaves a rate null rather than reporting zero with no denominator', () => {
    const [row] = payerScorecard([claim({ payer: 'Cigna', billed: 0, paid: 0 })], [], TODAY)
    expect(row.grossCollectionRate).toBeNull()
    expect(row.netCollectionRate).toBeNull()
    expect(row.denialRate).toBe(0) // one claim, none denied — a real zero
  })

  it('groups blank payer names under one heading', () => {
    const rows = payerScorecard([claim({ payer: '' }), claim({ payer: null })], [], TODAY)
    expect(rows).toHaveLength(1)
    expect(rows[0].payer).toBe('Unknown payer')
    expect(rows[0].filingWindowSource).toBe('default')
  })

  it('excludes settled denials from open work', () => {
    const rows = payerScorecard([], [denial({ status: 'PAID' }), denial({ status: 'DEAD' })], TODAY)
    expect(rows).toHaveLength(0)
  })

  it('lists every reason the payer denies on, topCarc first', () => {
    const [aetna] = payerScorecard(claims, denials, TODAY)
    expect(aetna.reasons.map(r => r.carc)).toEqual(['CO-97', 'CO-11'])
    expect(aetna.reasons[0]).toMatchObject({ carc: 'CO-97', count: 2, billed: 800 })
    expect(aetna.reasons[0].carc).toBe(aetna.topCarc!.carc)
  })

  it('reports the expiring slice of at-stake without adding it on', () => {
    // Aetna's window is 180 days, so a denial 170 days old has 10 left.
    const rows = payerScorecard(
      [],
      [
        denial({ payer: 'Aetna', billed: 500, denialDate: daysAgo(170) }),
        denial({ payer: 'Aetna', billed: 300, denialDate: daysAgo(10) }),
      ],
      TODAY,
    )
    expect(rows[0].atStake).toBe(800)
    expect(rows[0].expiringSoon).toBe(500)
  })

  it('reports expired money separately and never inside at-stake', () => {
    const rows = payerScorecard(
      [],
      [
        denial({ payer: 'Aetna', billed: 500, denialDate: daysAgo(200) }),
        denial({ payer: 'Aetna', billed: 300, denialDate: daysAgo(10) }),
      ],
      TODAY,
    )
    expect(rows[0].atStake).toBe(300)
    expect(rows[0].expired).toBe(1)
    expect(rows[0].expiredBilled).toBe(500)
    expect(rows[0].expiringSoon).toBe(0)
  })

  it('does not count a dateless denial as expiring — there is no clock', () => {
    const rows = payerScorecard(
      [],
      [denial({ payer: 'Aetna', billed: 500, denialDate: null })],
      TODAY,
    )
    expect(rows[0].atStake).toBe(500)
    expect(rows[0].expiringSoon).toBe(0)
    expect(rows[0].expired).toBe(0)
  })
})

describe('topCarcs', () => {
  it('ranks reasons by money and routes them through the shared rules', () => {
    const rows = topCarcs(
      [
        denial({ carc: 'CO-97', billed: 500 }),
        denial({ carc: 'CO-97', billed: 300 }),
        denial({ carc: 'CO-11', billed: 1000 }),
        denial({ carc: 'PR-1', billed: 50 }),
      ],
      TODAY,
    )
    expect(rows[0]).toMatchObject({ carc: 'CO-11', count: 1, billed: 1000, remedy: 'corrected_claim' })
    expect(rows[1]).toMatchObject({ carc: 'CO-97', count: 2, billed: 800, remedy: 'appeal' })
    // Patient responsibility is not recoverable, so it is billed but not at stake.
    const pr = rows.find(r => r.carc === 'PR-1')!
    expect(pr.billed).toBe(50)
    expect(pr.atStake).toBe(0)
  })

  it('groups the same code however it was spelled', () => {
    // Three spellings of one denial must not read as three cheap problems.
    const rows = topCarcs(
      [
        denial({ carc: 'CO-97', billed: 100 }),
        denial({ carc: 'CO97', billed: 100 }),
        denial({ carc: 'co 97', billed: 100 }),
      ],
      TODAY,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ carc: 'CO-97', count: 3, billed: 300 })
  })

  it('returns nothing for an empty worklist', () => {
    expect(topCarcs([], TODAY)).toEqual([])
  })
})

describe('topCodes', () => {
  it('names a CPT it knows and leaves one it does not as null', () => {
    const { cpt } = topCodes(
      [claim({ cpt: '99213', status: 'DENIED', billed: 200 }), claim({ cpt: 'ZZ999', status: 'DENIED', billed: 100 })],
      [],
    )
    expect(cpt[0].code).toBe('99213')
    expect(cpt[0].description).toBeTruthy()
    // Never the code echoed back at itself.
    expect(cpt.find(r => r.code === 'ZZ999')!.description).toBeNull()
  })

  it('falls back to the worklist when there is no claims snapshot', () => {
    const { cpt } = topCodes([], [denial({ cpt: '99214', billed: 300 })])
    expect(cpt[0]).toMatchObject({ code: '99214', deniedCount: 1, deniedBilled: 300 })
  })

  it('returns empty tables rather than throwing on no data', () => {
    expect(topCodes([], [])).toEqual({ cpt: [], icd10: [] })
  })
})

describe('recoveryFunnel', () => {
  it('counts only rows marked paid as recovered', () => {
    const result = recoveryFunnel([
      denial({ status: 'TO_WORK', billed: 100 }),
      denial({ status: 'DRAFTED', billed: 200 }),
      denial({ status: 'SENT', billed: 300 }),
      denial({ status: 'PAID', billed: 400 }),
      denial({ status: 'PAID', billed: 50 }),
      denial({ status: 'DEAD', billed: 25 }),
    ])
    expect(result.recovered).toBe(450)
    expect(result.recoveredCount).toBe(2)
    expect(result.worked).toBe(5) // everything that left TO_WORK
    expect(result.stages.find(s => s.status === 'TO_WORK')).toMatchObject({ count: 1, billed: 100 })
  })

  it('reports every stage even when empty', () => {
    const result = recoveryFunnel([])
    expect(result.stages.map(s => s.status)).toEqual(['TO_WORK', 'DRAFTED', 'SENT', 'PAID', 'DEAD'])
    expect(result.recovered).toBe(0)
  })
})

describe('overview', () => {
  it('keeps the snapshot and worklist halves apart', () => {
    const result = overview(
      [
        claim({ status: 'PAID', billed: 1000, allowed: 600, paid: 600 }),
        claim({ status: 'DENIED', billed: 500 }),
      ],
      [denial({ billed: 500, denialDate: daysAgo(10) })],
      TODAY,
    )
    expect(result.claims).toMatchObject({
      total: 2,
      billed: 1500,
      paid: 600,
      outstanding: 500,
      denied: 1,
      denialRate: 50,
      grossCollectionRate: 40,
    })
    expect(result.denials).toMatchObject({ open: 1, atStake: 500 })
    // 1500 billed and 500 at stake describe the same denial. Never added.
    expect(result.claims!.billed).toBe(1500)
  })

  it('returns null halves rather than zeroes when a source is missing', () => {
    const denialsOnly = overview([], [denial()], TODAY)
    expect(denialsOnly.claims).toBeNull()
    expect(denialsOnly.hasClaims).toBe(false)
    expect(denialsOnly.denials).not.toBeNull()

    const nothing = overview([], [], TODAY)
    expect(nothing.claims).toBeNull()
    expect(nothing.denials).toBeNull()
  })

  it('flags a denial rate derived from amounts rather than read from a column', () => {
    const result = overview([claim({ status: 'DENIED' })], [], TODAY, { statusDerived: true })
    expect(result.claims!.statusDerived).toBe(true)
  })

  it('reports recovered money from the worklist', () => {
    const result = overview([], [denial({ status: 'PAID', billed: 750 })], TODAY)
    expect(result.denials!.recovered).toBe(750)
    expect(result.denials!.open).toBe(0)
  })
})

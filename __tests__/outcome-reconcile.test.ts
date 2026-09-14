import { describe, it, expect } from 'vitest'
import { claimKey, reconcileOutcomes, type OpenSubmission, type SnapshotClaim } from '@/lib/denials/reconcile'

/**
 * The reconciler writes outcomes nobody typed in, so its refusals matter more
 * than what it records. Each test below is a way it could quietly corrupt the
 * ledger, pinned so it cannot.
 */

const SENT = new Date('2026-03-01T00:00:00Z')

function open(over: Partial<OpenSubmission> = {}): OpenSubmission {
  return { id: 's1', rowId: 'r1', claimNumber: 'CLM-100', sentAt: SENT, billed: 400, ...over }
}

function claim(over: Partial<SnapshotClaim> = {}): SnapshotClaim {
  return {
    claimNumber: 'CLM-100',
    status: 'PAID',
    paid: 400,
    remitDate: new Date('2026-04-15T00:00:00Z'),
    ...over,
  }
}

describe('claimKey', () => {
  it('forgives case and padding, which two exports out of one system disagree on', () => {
    expect(claimKey('  clm-100 ')).toBe('CLM-100')
    expect(claimKey('CLM-100')).toBe('CLM-100')
  })

  it('leaves punctuation alone', () => {
    // "12345-01" and "1234501" are two claims often enough that collapsing them
    // would book a payment against the wrong appeal.
    expect(claimKey('12345-01')).not.toBe(claimKey('1234501'))
  })

  it('is null for a row that carried no claim number', () => {
    expect(claimKey(null)).toBeNull()
    expect(claimKey('   ')).toBeNull()
  })
})

describe('what it books', () => {
  it('closes an appeal out when a later export shows the claim paid', () => {
    const [p] = reconcileOutcomes({ open: [open()], claims: [claim()] })
    expect(p.outcome).toBe('PAID')
    expect(p.amountRecovered).toBe(400)
    expect(p.outcomeAt).toEqual(new Date('2026-04-15T00:00:00Z'))
  })

  it('books a part payment as PARTIAL, whatever the export calls the status', () => {
    // A billing system that labels everything PAID the moment any money moves
    // would otherwise turn $40 on a $400 claim into a clean win.
    const [p] = reconcileOutcomes({
      open: [open({ billed: 400 })],
      claims: [claim({ status: 'PAID', paid: 40 })],
    })
    expect(p.outcome).toBe('PARTIAL')
    expect(p.amountRecovered).toBe(40)
    expect(p.note).toContain('$40.00 of $400.00')
  })

  it('does not call a cent of rounding a partial payment', () => {
    const [p] = reconcileOutcomes({
      open: [open({ billed: 400 })],
      claims: [claim({ paid: 399.995 })],
    })
    expect(p.outcome).toBe('PAID')
  })

  it('stamps every proposal as needing confirmation', () => {
    // Strong evidence is not proof: the payer may have paid for another reason.
    const [p] = reconcileOutcomes({ open: [open()], claims: [claim()] })
    expect(p.note).toContain('Confirm')
  })
})

describe('what it refuses to book', () => {
  it('ignores a remit dated before the appeal went out', () => {
    // Without this test the original denial remittance matches its own appeal
    // and books every submission in the workspace as an instant win.
    expect(
      reconcileOutcomes({
        open: [open()],
        claims: [claim({ remitDate: new Date('2026-02-01T00:00:00Z') })],
      }),
    ).toEqual([])
  })

  it('ignores a remit dated the same day the appeal went out', () => {
    expect(
      reconcileOutcomes({ open: [open()], claims: [claim({ remitDate: SENT })] }),
    ).toEqual([])
  })

  it('never proposes a loss', () => {
    // A claim still showing DENIED on a later snapshot is far more likely a
    // line the payer has not revisited than a ruling on the appeal, and booking
    // it as a denial pushes every win rate down in the one direction that costs
    // the customer money to believe.
    expect(
      reconcileOutcomes({ open: [open()], claims: [claim({ status: 'DENIED', paid: 0 })] }),
    ).toEqual([])
    expect(
      reconcileOutcomes({ open: [open()], claims: [claim({ status: 'WRITTEN_OFF', paid: 0 })] }),
    ).toEqual([])
  })

  it('ignores a paid status carrying no money', () => {
    expect(reconcileOutcomes({ open: [open()], claims: [claim({ paid: 0 })] })).toEqual([])
    expect(reconcileOutcomes({ open: [open()], claims: [claim({ paid: null })] })).toEqual([])
  })

  it('ignores a claim with no remit date at all', () => {
    expect(reconcileOutcomes({ open: [open()], claims: [claim({ remitDate: null })] })).toEqual([])
  })

  it('cannot match a row that carried no claim number', () => {
    expect(
      reconcileOutcomes({ open: [open({ claimNumber: null })], claims: [claim()] }),
    ).toEqual([])
  })
})

describe('two appeals on one denial', () => {
  it('credits the payment to the most recent attempt only', () => {
    // Crediting both would double the recovered dollars and inflate the win
    // rate of a first-level appeal that actually lost.
    const first = open({ id: 'first', sentAt: new Date('2026-03-01T00:00:00Z') })
    const second = open({ id: 'second', sentAt: new Date('2026-04-01T00:00:00Z') })
    const proposals = reconcileOutcomes({ open: [first, second], claims: [claim()] })
    expect(proposals).toHaveLength(1)
    expect(proposals[0].submissionId).toBe('second')
  })
})

describe('several lines for one claim', () => {
  it('resolves against the latest remit in the snapshot', () => {
    const proposals = reconcileOutcomes({
      open: [open()],
      claims: [
        claim({ paid: 100, remitDate: new Date('2026-04-01T00:00:00Z') }),
        claim({ paid: 400, remitDate: new Date('2026-05-01T00:00:00Z') }),
      ],
    })
    expect(proposals[0].amountRecovered).toBe(400)
    expect(proposals[0].outcome).toBe('PAID')
  })
})

import { describe, it, expect } from 'vitest'
import {
  SAVEABLE_CHANNELS,
  SUBMISSION_CHANNELS,
  destinationFieldsFor,
  resolveDestination,
  type SubmissionChannelValue,
} from '@/lib/billing/submission'

/**
 * An address captured at the send step has to come back out at the next one.
 *
 * Where a payer takes appeals was previously only capturable in Settings, which
 * asked a biller to fill in a form about a payer before they had the remittance
 * in front of them. It is now offered where they already are: having just faxed
 * something, they are asked whether to remember the number they faxed it to.
 *
 * That round trip spans two files — the Send panel writes an OrgDestination,
 * and resolveDestination reads one back — and it is silently breakable from
 * either end. A channel saved into a field the resolver does not read produces
 * an entry that reports itself as the workspace's own answer while carrying
 * nothing to show, which is a worse dead end than the honest "we don't know"
 * it replaced. These tests pin both directions of that.
 */

const base = { carc: 'CO-50', artifact: 'appeal-letter' as const, payerName: 'Some Regional Plan' }

const orgDestination = (channel: SubmissionChannelValue, address: string) => ({
  payerLabel: 'Some Regional Plan',
  channel,
  ...destinationFieldsFor(channel, address),
  notes: null,
})

describe('capturing a destination at the send step', () => {
  it.each(SAVEABLE_CHANNELS)('a %s address saved here is shown back on the next denial', channel => {
    const address = 'the address that was actually used'
    const d = resolveDestination({ ...base, orgDestination: orgDestination(channel, address) })

    expect(d.source).toBe('org')
    // The channel the biller used is what they see first next time, not merely
    // present somewhere in the list.
    expect(d.options[0]?.channel).toBe(channel)
    expect(d.options[0]?.label).toContain(address)
  })

  it('offers exactly the channels the resolver can render, no more and no fewer', () => {
    // The real assertion: SAVEABLE_CHANNELS is not a hand-maintained subset that
    // can drift, it is precisely the set that survives the round trip. Add a
    // field to OrgDestination and forget to list it here, and this fails.
    const survives = SUBMISSION_CHANNELS.filter(
      channel =>
        resolveDestination({ ...base, orgDestination: orgDestination(channel, 'x') }).options
          .length > 0,
    )
    expect(survives).toEqual([...SAVEABLE_CHANNELS])
  })

  it('writes the address into one field and leaves the others alone', () => {
    expect(destinationFieldsFor('FAX', '555-0100')).toEqual({
      portalUrl: null,
      faxNumber: '555-0100',
      mailingAddress: null,
    })
  })

  it('a payer with no saved entry still says so, rather than claiming an empty one', () => {
    const d = resolveDestination({ ...base, orgDestination: null })
    expect(d.source).toBe('unknown')
    expect(d.options).toEqual([])
    // The Send panel keys "remember this" off a payer label, so an unknown
    // destination has to carry one or the offer never appears.
    expect(d.payerLabel).toBe('Some Regional Plan')
  })
})

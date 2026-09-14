import { describe, it, expect } from 'vitest'
import { payerKey, resolveDestination } from '@/lib/billing/submission'

/**
 * Routing guidance is only worth having if it is never confidently wrong.
 *
 * lib/billing/payers.ts is a Texas panel that says so in its own header, and
 * resolveTexasPayer() already refuses to put a Texas PO box on a payer that has
 * not named Texas. These tests pin that the Send panel inherits that refusal for
 * the postal address while still offering the channel guidance that IS national,
 * and that a customer's own entry always outranks ours.
 */

const base = { carc: 'CO-50', artifact: 'appeal-letter' as const }

describe('payerKey', () => {
  it('collapses spelling and spacing so one saved entry keeps matching', () => {
    expect(payerKey('UnitedHealthcare')).toBe('unitedhealthcare')
    expect(payerKey('United Healthcare')).toBe('united-healthcare')
    expect(payerKey('  Blue Cross Blue Shield of Texas ')).toBe('blue-cross-blue-shield-of-texas')
  })

  it('is null for a row that named no payer', () => {
    expect(payerKey(null)).toBeNull()
    expect(payerKey('   ')).toBeNull()
  })
})

describe('resolveDestination — the directory', () => {
  it('gives a Texas-named payer both the portal and the postal address', () => {
    const d = resolveDestination({ ...base, payerName: 'Blue Cross Blue Shield of Texas' })
    expect(d.source).toBe('directory')
    expect(d.options.map(o => o.channel)).toEqual(['PORTAL', 'MAIL'])
    expect(d.options.find(o => o.channel === 'MAIL')!.label).toContain('PO Box 660044')
    expect(d.requiredForm).toBe('Claim Review Form')
    // Our address, not theirs — the UI must carry the verify-it caveat.
    expect(d.needsVerification).toBe(true)
  })

  it('gives a bare national payer the portal and NO address', () => {
    // The case that matters most: "UnitedHealthcare" with no state could be any
    // plan in the country. The portal is true everywhere; the Salt Lake City PO
    // box is not, and a wrong address burns the filing window silently.
    const d = resolveDestination({ ...base, payerName: 'UnitedHealthcare' })
    expect(d.source).toBe('directory')
    expect(d.options.map(o => o.channel)).toEqual(['PORTAL'])
    expect(d.options.some(o => o.channel === 'MAIL')).toBe(false)
    expect(d.needsVerification).toBe(false)
  })

  it('does not name a state-specific plan for a payer it would not address', () => {
    // Withholding the Salt Lake City PO box and then calling the payer
    // "UnitedHealthcare Community Plan of Texas" asserts the same specificity
    // by the back door, and reads as confirmation to a biller skimming the panel.
    const d = resolveDestination({ ...base, payerName: 'UnitedHealthcare' })
    expect(d.payerLabel).toBe('UnitedHealthcare')
    expect(d.requiredFormNote).not.toContain('Texas')
  })

  it('does name the full legal plan once it is printing that plan’s address', () => {
    const d = resolveDestination({ ...base, payerName: 'UnitedHealthcare Community Plan of Texas' })
    expect(d.payerLabel).toBe('UnitedHealthcare Community Plan of Texas')
    expect(d.options.some(o => o.channel === 'MAIL')).toBe(true)
  })

  it('resolves Cigna without a state hint, since its profile carries no state routing', () => {
    const d = resolveDestination({ ...base, payerName: 'Cigna' })
    expect(d.source).toBe('directory')
    expect(d.options.some(o => o.channel === 'MAIL')).toBe(true)
  })

  it('routes a corrected claim through the clearinghouse, not the appeals unit', () => {
    // CO-11 is a corrected claim. Sending it to the appeals PO box wastes the
    // same filing window as sending the wrong document.
    const d = resolveDestination({
      payerName: 'Texas Medicaid',
      carc: 'CO-11',
      artifact: 'corrected-claim',
    })
    expect(d.options[0].channel).toBe('CLEARINGHOUSE')
    expect(d.options[0].label).toContain('617591011')
  })
})

describe('resolveDestination — unknown payers', () => {
  it('admits it does not know rather than guessing', () => {
    const d = resolveDestination({ ...base, payerName: 'Medicare' })
    expect(d.source).toBe('unknown')
    expect(d.options).toEqual([])
    expect(d.payerLabel).toBe('Medicare')
  })

  it('still returns the attachment checklist, which does not depend on the payer', () => {
    const d = resolveDestination({ ...base, payerName: 'Some Regional Plan' })
    expect(d.source).toBe('unknown')
    expect(d.attachments.length).toBeGreaterThan(0)
  })

  it('handles a row with no payer at all', () => {
    const d = resolveDestination({ ...base, payerName: null })
    expect(d.source).toBe('unknown')
    expect(d.payerLabel).toBeNull()
    expect(d.payerKey).toBeNull()
  })
})

describe('resolveDestination — the workspace’s own entry', () => {
  const saved = {
    payerLabel: 'Northgate Health Plan of Ohio',
    channel: 'FAX',
    portalUrl: null,
    faxNumber: '555-201-9000',
    mailingAddress: 'Northgate Health Plan\nPO Box 22712\nColumbus, OH 43216',
    notes: 'Ask for the provider disputes queue.',
  }

  it('outranks the directory for a payer we also know', () => {
    const d = resolveDestination({
      ...base,
      payerName: 'Blue Cross Blue Shield of Texas',
      orgDestination: { ...saved, payerLabel: 'BCBSTX — our rep' },
    })
    expect(d.source).toBe('org')
    expect(d.payerLabel).toBe('BCBSTX — our rep')
    // None of our Texas data leaks into an answer the customer overrode.
    expect(d.needsVerification).toBe(false)
    expect(d.options.every(o => o.detail === 'Saved by your workspace.')).toBe(true)
  })

  it('answers for a payer the directory has never heard of', () => {
    const d = resolveDestination({ ...base, payerName: 'Northgate Health Plan', orgDestination: saved })
    expect(d.source).toBe('org')
    expect(d.options.map(o => o.channel)).toContain('FAX')
    expect(d.options.map(o => o.channel)).toContain('MAIL')
  })

  it('puts the channel they marked preferred first', () => {
    const d = resolveDestination({ ...base, payerName: 'Northgate Health Plan', orgDestination: saved })
    expect(d.options[0].channel).toBe('FAX')
  })

  it('carries the checklist through unchanged', () => {
    const d = resolveDestination({ ...base, payerName: 'Northgate Health Plan', orgDestination: saved })
    expect(d.attachments.length).toBeGreaterThan(0)
  })
})

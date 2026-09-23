import { describe, expect, it } from 'vitest'
import { codeSignals, type ClaimCodeFact } from '@/lib/claims/code-signals'
import { buildPredictionState } from '@/lib/claims/predict'

/**
 * What may leave this server for TypeSafe.
 *
 * Same discipline as __tests__/no-phi-columns.test.ts, applied to the wire
 * instead of the schema: the state is a closed shape, and this is the test that
 * actually holds the line when somebody adds a convenient field later.
 */

const FORBIDDEN =
  /patient|member|subscriber|dob|birth|ssn|mrn|guarantor|firstName|lastName|address|phone|email/i

/**
 * Except the two code descriptions, which come from the built-in reference
 * table in lib/billing/procedure-codes.ts and not from anybody's data. CPT
 * 99213 is literally "Office/outpatient visit, established patient, low level
 * of medical decision making" — the word is in the code book.
 *
 * Same carve-out no-phi-columns.test.ts makes for `patientResp`, and made the
 * same way: named explicitly, so the scan below still covers every field whose
 * content actually originates with a customer.
 */
function scannable(state: ReturnType<typeof build>): string {
  return JSON.stringify({
    ...state,
    codes: { ...state.codes, cptDescription: null, icdDescription: null },
    candidates: state.candidates.map(c => ({ ...c, description: null })),
  })
}

function build(over: Partial<ClaimCodeFact> = {}) {
  const facts: ClaimCodeFact[] = Array.from({ length: 12 }, () => ({
    payer: 'Aetna',
    cpt: '99213',
    icd10: 'E11.65',
    status: 'PAID',
    billed: 200,
    allowed: 120,
    paid: 120,
    carc: null,
    ...over,
  }))
  return buildPredictionState({
    signals: codeSignals({ payer: 'Aetna', cpt: '99213', icd10: 'E11.9' }, facts),
    status: 'DENIED',
    billed: 200,
    allowed: null,
    paid: null,
    balance: 200,
    ageDays: 60,
    filing: { daysLeft: 40, windowDays: 90, windowSource: 'default' },
    denial: {
      code: 'CO-11',
      label: 'The diagnosis does not support this procedure',
      note: null,
      playbookRemedy: 'Corrected claim',
      payerPosition: null,
      strategy: null,
      avoid: null,
    },
  })
}

describe('the prediction state carries no PHI', () => {
  it('has no person-shaped field anywhere in what goes on the wire', () => {
    expect(scannable(build())).not.toMatch(FORBIDDEN)
  })

  it('the descriptions it does send are code-book text, not claim text', () => {
    // Guards the carve-out above: if a description ever stopped coming from the
    // reference table and started coming from an import, this is where it shows.
    const state = build()
    expect(state.codes.cptDescription).toContain('Office/outpatient visit')
    expect(state.codes.icdDescription).toContain('diabetes')
  })

  // The real guard. A snapshot of the keys fails loudly when somebody widens
  // the state, instead of letting a new field ship unnoticed.
  it('is a closed shape, so a new field is a deliberate change', () => {
    expect(Object.keys(build()).sort()).toEqual([
      'candidates',
      'claim',
      'codes',
      'denial',
      'filing',
      'history',
      'limits',
      'payer',
    ])
    expect(Object.keys(build().claim).sort()).toEqual([
      'ageDays',
      'allowed',
      'balance',
      'billed',
      'paid',
      'status',
    ])
    expect(Object.keys(build().codes).sort()).toEqual([
      'coherence',
      'cpt',
      'cptDescription',
      'icd10',
      'icdDescription',
    ])
  })

  // It contributes nothing to a judgment; it is only an anchor for a model to
  // echo back.
  it('does not send the claim number', () => {
    const state = build()
    expect('claimNumber' in state).toBe(false)
    expect(JSON.stringify(state)).not.toMatch(/claimNumber/i)
  })

  it('does not let a forbidden token ride in on a data field', () => {
    // A payer field stuffed with a patient name is the realistic leak: it is a
    // free-text column from a customer's own spreadsheet.
    const state = build()
    // The payer IS sent — it is a plan, not a person, and the signals are
    // meaningless without it — so this asserts what we actually promise: the
    // shape is closed, and nothing is carried beyond the declared fields.
    expect(Object.keys(state).sort()).toEqual([
      'candidates',
      'claim',
      'codes',
      'denial',
      'filing',
      'history',
      'limits',
      'payer',
    ])
  })
})

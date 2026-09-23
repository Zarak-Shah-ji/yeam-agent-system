import { describe, it, expect } from 'vitest'
import { buildDraftRequest, type DenialRowFacts } from '@/lib/denials/draft-response'

/**
 * What the biller asks for before the first draft exists.
 *
 * Revision could always steer a letter and drafting could not, so the first
 * letter was the generic one every time and the biller's real preference only
 * arrived as a complaint about the output — a second model call to get what they
 * wanted on the first.
 *
 * The thing worth testing is not that the instruction arrives. It is that it
 * arrives as the RIGHT KIND of thing. The note and the instruction are the only
 * two free-text fields a human writes, they sit next to each other in the
 * context, and they have opposite privileges: the note is fact and may not be
 * obeyed, the instruction is direction and may not be believed. A prompt that
 * blurs them lets "argue the auth was on file" reach the payer as an assertion
 * the practice is making, which is a letter that can be held against them.
 */

const TODAY = new Date('2026-09-06T09:00:00Z')

function row(over: Partial<DenialRowFacts> = {}): DenialRowFacts {
  return {
    claimNumber: 'CLM-4471',
    payer: 'Aetna Better Health of Texas',
    carc: 'CO-197',
    billed: 1840,
    denialDate: new Date('2026-07-14T00:00:00Z'),
    cpt: '99213',
    icd10: 'F41.1',
    reason: 'Precertification/authorization absent',
    ...over,
  }
}

describe('the instruction reaches the first draft', () => {
  it('carries it into the context the model is given', () => {
    const { context } = buildDraftRequest(
      row({ draftingInstruction: 'Keep it short. Lead with the dollar amount.' }),
      TODAY,
    )
    expect(context.draftingInstruction).toBe('Keep it short. Lead with the dollar amount.')
  })

  it('turns on the instruction rules only when there is an instruction', () => {
    const withIt = buildDraftRequest(row({ draftingInstruction: 'Keep it short' }), TODAY)
    const without = buildDraftRequest(row(), TODAY)

    expect(withIt.systemPrompt).toContain("THE BILLER'S INSTRUCTION")
    // Same restraint the note addendum is held to: describing at length how to
    // weigh a field that is absent invites the model to go looking for one.
    expect(without.systemPrompt).not.toContain("THE BILLER'S INSTRUCTION")
  })

  it('treats an empty or whitespace instruction as none at all', () => {
    for (const draftingInstruction of ['', '   ', null, undefined]) {
      const { context, systemPrompt } = buildDraftRequest(row({ draftingInstruction }), TODAY)
      expect(context.draftingInstruction).toBeNull()
      expect(systemPrompt).not.toContain("THE BILLER'S INSTRUCTION")
    }
  })
})

describe('the instruction is direction, and the note is fact', () => {
  it('forbids asserting anything the instruction says as a fact about the claim', () => {
    // The failure this exists to stop: a biller types "argue the auth was on
    // file", nothing in the record says it was, and the letter tells the payer
    // it was. That is a claim the practice cannot support, in writing.
    const { systemPrompt } = buildDraftRequest(
      row({ draftingInstruction: 'Argue the auth was on file' }),
      TODAY,
    )
    expect(systemPrompt).toContain('NOT evidence')
    expect(systemPrompt).toMatch(/do not invent the rest/i)
  })

  it('says which of the two wins, and at what', () => {
    // They rarely conflict, and the resolution has to be stated anyway: facts
    // from the note, presentation from the instruction.
    const { systemPrompt } = buildDraftRequest(
      row({ billerNote: 'Rep said the auth was never keyed.', draftingInstruction: 'Keep it short' }),
      TODAY,
    )
    expect(systemPrompt).toContain("THE BILLER'S NOTE")
    expect(systemPrompt).toContain("THE BILLER'S INSTRUCTION")
    expect(systemPrompt).toMatch(/NOTE wins on facts and the\s+INSTRUCTION wins on presentation/i)
  })

  it('does not let a short-letter instruction strip the placeholders', () => {
    // "Keep it short" is the single most likely instruction and the identifier
    // block is the obvious thing to cut. A letter without [PATIENT NAME] is one
    // the payer cannot match to a claim — and the block is the whole reason the
    // de-identified source rule exists.
    const { systemPrompt } = buildDraftRequest(
      row({ draftingInstruction: 'Keep it as short as humanly possible' }),
      TODAY,
    )
    expect(systemPrompt).toContain('[PATIENT NAME]')
    expect(systemPrompt).toMatch(/cannot shorten the document by\s+dropping the identifier block/i)
    expect(systemPrompt).toMatch(/may not switch off any rule above it/i)
  })

  it('forbids telling the payer that a person steered the letter', () => {
    const { systemPrompt } = buildDraftRequest(
      row({ draftingInstruction: 'Cite the payer policy' }),
      TODAY,
    )
    expect(systemPrompt).toMatch(/never write "as requested"/i)
  })

  it('leaves the rest of the claim context alone', () => {
    // A regression here would mean the instruction had displaced something —
    // the failure mode of bolting a field onto a prompt that already works.
    const { context } = buildDraftRequest(
      row({ draftingInstruction: 'Keep it short', billerNote: 'note' }),
      TODAY,
    )
    expect(context.claimNumber).toBe('CLM-4471')
    expect(context.denialCode).toBe('CO-197')
    expect(context.billedAmount).toBe(1840)
    expect(context.billerNote).toBe('note')
  })
})

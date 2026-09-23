import { describe, it, expect } from 'vitest'
import { buildNoteRequest, cleanNote } from '@/lib/denials/write-note'

/**
 * The note, written from what the biller actually said.
 *
 * The note is the most valuable field in the product — the only place the real
 * reason for a denial exists, as opposed to the code an adjudication system
 * picked off a list — and it is the field people skip, because writing it
 * happens straight off a long hold with the next call queued.
 *
 * Letting a model write it is therefore worth doing and dangerous in one very
 * specific way: a note that invents a reference number is WORSE than no note,
 * because the next person to read it has no way to tell which half came from the
 * payer. Everything downstream trusts this field — BILLER_NOTE_ADDENDUM tells
 * the drafting model THE NOTE WINS over the coded denial reason — so a fabricated
 * sentence here becomes an assertion to a payer two steps later.
 *
 * These assertions are on the prompt, not the model. They guard that the rules
 * are switched on and that the claim context goes in as background rather than
 * as material, which is the difference between a note the model wrote and a note
 * the model padded.
 */

describe('what the model is told before it writes a note', () => {
  it('passes the rough input through verbatim', () => {
    const rough = 'called aetna, rep said auth was under referring npi, wants 24J resubmitted'
    const { prompt } = buildNoteRequest(rough)
    expect(prompt).toContain(rough)
  })

  it('forbids adding anything the biller did not say', () => {
    // The whole risk, in one rule. Everything else in this prompt is style.
    const { systemPrompt } = buildNoteRequest('called them')
    expect(systemPrompt).toContain('ADD NOTHING')
    expect(systemPrompt).toMatch(/invent or complete a reference number/i)
  })

  it('forbids resolving what the speaker left vague', () => {
    // A biller who says "something about the NPI" is recording uncertainty on
    // purpose. A model that picks one has destroyed the only honest part.
    const { systemPrompt } = buildNoteRequest('they said something about the npi')
    expect(systemPrompt).toMatch(/You may NOT:/)
    expect(systemPrompt).toMatch(/resolve what the speaker left ambiguous/i)
    expect(systemPrompt).toMatch(/Do not decide which NPI/i)
  })

  it('forbids naming who was called when the biller did not', () => {
    // Observed in the first live run: given "called them tuesday" and a row whose
    // payer is Molina, the model wrote "the rep for Molina Healthcare of Texas".
    // Plausible, unverifiable and wrong often enough to matter — billers ring
    // clearinghouses, portals and the wrong department all day, and the next
    // reader has no way to catch an attribution that was never said.
    const { systemPrompt } = buildNoteRequest('called them tuesday', { payer: 'Molina' })
    expect(systemPrompt).toMatch(/name who was spoken to/i)
    expect(systemPrompt).toMatch(/"Called them" stays "called them"/i)
    expect(systemPrompt).toMatch(/NOT an answer to who was on the phone/i)
  })

  it('forbids contributing billing knowledge of its own', () => {
    // The claim context is given so the note can be written clearly, not so the
    // model can explain CO-197 to the person who just phoned about it.
    const { systemPrompt } = buildNoteRequest('no auth on file apparently')
    expect(systemPrompt).toMatch(/NOT so you can contribute to it/i)
    expect(systemPrompt).toMatch(/add an explanation of the denial code/i)
  })

  it('forbids softening or strengthening what was said', () => {
    const { systemPrompt } = buildNoteRequest('rep thought it might reprocess')
    expect(systemPrompt).toMatch(/soften or strengthen/i)
  })

  it('gives the claim as background and says not to restate it', () => {
    // Without the marking, a model handed "CO-197" writes a note that opens by
    // announcing the denial code — which the row already shows, in a column.
    const { prompt, hasClaimContext } = buildNoteRequest('auth was there', {
      claimNumber: 'CLM-4471',
      payer: 'Aetna Better Health of Texas',
      carc: 'CO-197',
      reason: 'Precertification/authorization absent',
    })
    expect(hasClaimContext).toBe(true)
    expect(prompt).toContain('background only; do not restate it')
    expect(prompt).toContain('CLM-4471')
    expect(prompt).toContain('CO-197')
  })

  it('omits the claim section entirely when there is nothing to say', () => {
    // A heading over an empty body reads to the model as a fact withheld —
    // the same rule standingContext follows.
    const { prompt, hasClaimContext } = buildNoteRequest('called them')
    expect(hasClaimContext).toBe(false)
    expect(prompt).not.toContain('THE CLAIM')
  })

  it('carries no patient identifier, because the row holds none', () => {
    // NoteClaimFacts names four fields and none of them is a person. The
    // schema-level guarantee (no-phi-columns.test.ts) is what makes that true
    // rather than merely intended.
    const { prompt } = buildNoteRequest('spoke to them', {
      claimNumber: 'CLM-4471',
      payer: 'Aetna',
      carc: 'CO-197',
      reason: 'Auth absent',
    })
    expect(prompt).not.toMatch(/patient|member id|date of birth/i)
  })
})

describe('the note comes back bare', () => {
  it('strips a preamble the model was told not to write', () => {
    // Cheaper to remove than to re-prompt, and a note that arrives with
    // "Here is the note:" attached reads as a bug to the person about to save it.
    expect(cleanNote("Here's the note: Called the payer on 4 Sep.")).toBe(
      'Called the payer on 4 Sep.',
    )
    expect(cleanNote('Here is your rewritten note:\nCalled the payer.')).toBe('Called the payer.')
    expect(cleanNote('Note: Called the payer.')).toBe('Called the payer.')
  })

  it('strips wrapping quotes without touching quotes inside', () => {
    expect(cleanNote('"Called the payer."')).toBe('Called the payer.')
    expect(cleanNote('The rep said "resubmit it" and hung up.')).toBe(
      'The rep said "resubmit it" and hung up.',
    )
  })

  it('leaves an ordinary note exactly as written', () => {
    const note =
      'The rep confirmed authorization 88120 is on file under the referring NPI and asked for ' +
      'the claim to be resubmitted with the rendering NPI in box 24J. Reference 4471902.'
    expect(cleanNote(note)).toBe(note)
  })
})

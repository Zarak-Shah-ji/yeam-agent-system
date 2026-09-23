import { describe, it, expect } from 'vitest'
import { buildDraftRequest, type DenialRowFacts } from '@/lib/denials/draft-response'
import { standingContext } from '@/lib/denials/standing-context'

/**
 * The biller's note is the reason a drafted document is specific rather than
 * generic, and it is the one fact in the context no export can supply: what the
 * payer said on the phone, which routinely differs from the coded denial reason.
 *
 * These assertions guard the wiring, not the model. A note that is saved but
 * never reaches the prompt fails silently — the letter still comes back, it is
 * just the same letter it would have been without the call — so nothing but a
 * test notices when this regresses.
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

describe('the note reaches the draft', () => {
  it('carries the note into the context the model is given', () => {
    const note = 'Called 9/4, rep says auth 88120 is on file under the referring NPI.'
    const { context } = buildDraftRequest(row({ billerNote: note }), TODAY)
    expect(context.billerNote).toBe(note)
  })

  it('turns on the note rules only when there is a note', () => {
    const withNote = buildDraftRequest(row({ billerNote: 'They want it resubmitted.' }), TODAY)
    const without = buildDraftRequest(row(), TODAY)

    expect(withNote.systemPrompt).toContain("THE BILLER'S NOTE")
    // Describing at length how to weigh a field that is absent invites the model
    // to go looking for one, and a model that wants a fact tends to find it.
    expect(without.systemPrompt).not.toContain("THE BILLER'S NOTE")
  })

  it('tells the model the note outranks the coded denial reason', () => {
    // The whole point. A rep who says the auth was on file has contradicted the
    // CO-197, and a letter that argues the CO-197 anyway is the generic letter.
    const { systemPrompt } = buildDraftRequest(row({ billerNote: 'Auth was on file.' }), TODAY)
    expect(systemPrompt).toContain('THE NOTE WINS')
  })

  it('does not let the note smuggle a patient identifier into the letter', () => {
    // The note is free text a human typed, so it may well name the patient. The
    // identifiers are merged in the browser (lib/appeals/merge.ts) and the
    // placeholders have to survive whatever the note says.
    const { systemPrompt } = buildDraftRequest(row({ billerNote: 'Re: Jane Doe, ID W9912.' }), TODAY)
    expect(systemPrompt).toContain('[PATIENT NAME]')
    expect(systemPrompt).toMatch(/never as direction/i)
  })

  it('treats an empty or whitespace note as no note at all', () => {
    // "" is not the same as absent: as a JSON value it reads to the model as a
    // note that said nothing, which is a fact about the claim that is not true.
    for (const billerNote of ['', '   ', null, undefined]) {
      const { context, systemPrompt } = buildDraftRequest(row({ billerNote }), TODAY)
      expect(context.billerNote).toBeNull()
      expect(systemPrompt).not.toContain("THE BILLER'S NOTE")
    }
  })
})

describe('the follow-up date reaches the draft', () => {
  it('gives the model the date and how far off it is', () => {
    // The model has no clock, so an ISO string alone cannot tell it "next week"
    // from "three weeks overdue" — and only one of those makes the closing
    // sentence sensible.
    const { context } = buildDraftRequest(
      row({ followUpAt: new Date('2026-09-20T12:00:00Z') }),
      TODAY,
    )
    expect(context.followUp).toEqual({ date: '2026-09-20', inDays: 14 })
  })

  it('reports a date already past as negative rather than dropping it', () => {
    const { context } = buildDraftRequest(
      row({ followUpAt: new Date('2026-08-30T12:00:00Z') }),
      TODAY,
    )
    expect(context.followUp?.inDays).toBe(-7)
  })

  it('switches on the follow-up rules independently of the note', () => {
    const dateOnly = buildDraftRequest(row({ followUpAt: new Date('2026-09-20T12:00:00Z') }), TODAY)
    expect(dateOnly.systemPrompt).toContain('THE FOLLOW-UP DATE')
    expect(dateOnly.systemPrompt).not.toContain("THE BILLER'S NOTE")

    expect(buildDraftRequest(row(), TODAY).systemPrompt).not.toContain('THE FOLLOW-UP DATE')
  })

  it('forbids presenting the biller’s own diary date to the payer as a deadline', () => {
    const { systemPrompt } = buildDraftRequest(
      row({ followUpAt: new Date('2026-09-20T12:00:00Z') }),
      TODAY,
    )
    expect(systemPrompt).toMatch(/never\s+present it to the payer as a deadline/i)
  })

  it('leaves the rest of the claim context alone', () => {
    // A regression here would mean the note had displaced something, which is
    // the failure mode of bolting a field onto a prompt that already works.
    const { context } = buildDraftRequest(row({ billerNote: 'note' }), TODAY)
    expect(context.claimNumber).toBe('CLM-4471')
    expect(context.denialCode).toBe('CO-197')
    expect(context.billedAmount).toBe(1840)
  })
})

/**
 * The same wiring, one layer further on.
 *
 * A revision sees the letter and the instruction and nothing else, so the note
 * is invisible to every version after the first unless standingContext puts it
 * back. That failure is silent in the worst way: the letter still comes back,
 * shorter or plainer exactly as asked, having quietly dropped the one fact the
 * biller learned on the phone. Only a test notices.
 *
 * It matters more now than it did, because a biller can edit the letter by hand
 * and then ask for a change. The edit is committed as a version first and
 * `revise` reads the body back out of the database — so the standing context is
 * the only route the note has into that call.
 */
describe('the note survives into revisions', () => {
  it('states the note as a fact about the claim', () => {
    const context = standingContext({
      note: 'Called 9/4, rep says auth 88120 is on file under the referring NPI.',
      followUpAt: null,
    })
    expect(context).toContain('Note from the biller working this claim:')
    expect(context).toContain('auth 88120 is on file under the referring NPI')
  })

  it('carries the follow-up date and says whose date it is', () => {
    // Same restraint the drafting prompt applies: the practice's own diary date
    // is not a deadline the payer agreed to, and a letter that presents it as
    // one is making a claim the practice cannot support.
    const context = standingContext({
      note: null,
      followUpAt: new Date('2026-09-20T12:00:00Z'),
    })
    expect(context).toContain('2026-09-20')
    expect(context).toMatch(/not a deadline the payer agreed to/i)
  })

  it('carries both when both exist', () => {
    const context = standingContext({
      note: 'They want it resubmitted with the rendering NPI in box 24J.',
      followUpAt: new Date('2026-09-20T12:00:00Z'),
    })
    expect(context).toContain('box 24J')
    expect(context).toContain('2026-09-20')
  })

  it('returns null rather than an empty heading when there is nothing to say', () => {
    // reviseAppealLetter omits the STANDING CONTEXT section entirely on null. A
    // heading over an empty body reads to the model as a fact that was withheld.
    expect(standingContext({ note: null, followUpAt: null })).toBeNull()
    expect(standingContext({ note: '   ', followUpAt: null })).toBeNull()
  })

  it('says the same thing to the reviser that the drafter was told', () => {
    // The two prompts are built by different functions in different files, and
    // the note reaching one but not the other is exactly the regression this
    // file exists to catch.
    const note = 'Rep confirmed the auth; they want it resubmitted.'
    const { context: drafting } = buildDraftRequest(row({ billerNote: note }), TODAY)
    const revising = standingContext({ note, followUpAt: null })

    expect(drafting.billerNote).toBe(note)
    expect(revising).toContain(note)
  })
})

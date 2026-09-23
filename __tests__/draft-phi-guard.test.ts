import { describe, it, expect } from 'vitest'
import {
  PATIENT_SLOTS,
  droppedPatientSlots,
  findPlaceholders,
  mergeLetter,
  ownerOf,
} from '@/lib/appeals/merge'

/**
 * The letter body became editable, and that is the one write in the product
 * where a biller can put a patient's name somewhere it would be stored.
 *
 * Everything else about the privacy promise is structural: no column exists to
 * hold an identifier (no-phi-columns.test.ts), the import path never reads one
 * (deidentify.ts), and the drafting prompt is told to leave placeholders alone.
 * A textarea over a server-owned column is different in kind — it is a free-text
 * field whose contents are saved, so the guard has to be behavioural.
 *
 * The rule: a save may not DROP a patient placeholder the version it came from
 * had. Nothing can recognise "Jane Doe" as a name, but the [PATIENT NAME] that
 * was standing in that spot a moment ago is gone, and that is exact.
 *
 * These assertions are on the shared primitive rather than on the mutation,
 * because the mutation, the textarea's live warning and the Save button's
 * disabled state all call this one function — which is the point. A test that
 * exercised the server alone would pass while the browser enforced something
 * else.
 */

const LETTER = `Re: Appeal of claim CLM-4471 for [PATIENT NAME], member ID [MEMBER ID]

To whom it may concern:

We are appealing the denial of the above claim, billed at $1,840.00 and denied
under CO-197. The service was authorized. Please reprocess.

[PRACTICE NAME]
NPI [NPI]`

describe('the editor may not swallow a patient placeholder', () => {
  it('catches a name typed over the placeholder', () => {
    const edited = LETTER.replace('[PATIENT NAME]', 'Jane Doe')
    const dropped = droppedPatientSlots(LETTER, edited)

    expect(dropped.map(d => d.token)).toEqual(['[PATIENT NAME]'])
    expect(dropped.every(d => d.owner === 'patient')).toBe(true)
  })

  it('catches a member ID, not only a name', () => {
    // The likelier mistake, in fact: a biller with the remittance in front of
    // them types the member number without thinking of it as identifying.
    const edited = LETTER.replace('[MEMBER ID]', 'W9912384401')
    expect(droppedPatientSlots(LETTER, edited).map(d => d.key)).toEqual(['MEMBER ID'])
  })

  it('catches the whole identifier line being rewritten at once', () => {
    const edited = LETTER.replace(
      'Re: Appeal of claim CLM-4471 for [PATIENT NAME], member ID [MEMBER ID]',
      'Re: Appeal of claim CLM-4471 for Jane Doe, member ID W9912384401',
    )
    expect(droppedPatientSlots(LETTER, edited).map(d => d.key).sort()).toEqual([
      'MEMBER ID',
      'PATIENT NAME',
    ])
  })

  it('lets an ordinary prose edit through', () => {
    // The whole feature. A biller fixing a sentence, adding a paragraph or
    // deleting the last line must never see the warning — a guard that fires on
    // normal editing is a guard that gets routed around.
    const edited = LETTER.replace(
      'Please reprocess.',
      'Please reprocess the claim and remit payment within 30 days, as required by ' +
        'the prompt-pay provisions of the plan contract.',
    )
    expect(droppedPatientSlots(LETTER, edited)).toEqual([])
  })

  it('lets the biller delete a practice placeholder', () => {
    // An NPI belongs to the provider, not the patient. Deleting [NPI] and
    // typing the real one is a legitimate edit and the server stores it happily.
    const edited = LETTER.replace('[NPI]', '1861529437')
    expect(droppedPatientSlots(LETTER, edited)).toEqual([])
    expect(ownerOf('NPI')).toBe('practice')
  })

  it('does not object to a placeholder being added', () => {
    // One-directional on purpose. A model that decides the next version also
    // wants [DATE OF BIRTH] is doing its job, and so is a biller who adds it.
    const before = LETTER.replace(', member ID [MEMBER ID]', '')
    expect(droppedPatientSlots(before, LETTER)).toEqual([])
  })

  it('is unmoved by a placeholder merely moving', () => {
    const edited = LETTER.replace(
      'Re: Appeal of claim CLM-4471 for [PATIENT NAME], member ID [MEMBER ID]',
      'Re: Appeal of claim CLM-4471\nMember: [MEMBER ID]\nPatient: [PATIENT NAME]',
    )
    expect(droppedPatientSlots(LETTER, edited)).toEqual([])
  })

  it('guards every slot the browser treats as the patient’s', () => {
    // The set is exported so the server enforces the same list the browser
    // shows fields for. A slot added to one and not the other would be a field
    // the biller fills in the browser and a token the server does not protect.
    for (const key of PATIENT_SLOTS) {
      const before = `Patient [${key}] appears here.`
      const after = 'Patient Jane Doe appears here.'
      expect(droppedPatientSlots(before, after).map(d => d.key)).toEqual([key])
    }
  })
})

describe('the merged letter is a render, never editor state', () => {
  it('produces text that would itself fail the guard', () => {
    // This is the reason the two layers must not be conflated. mergeLetter's
    // output is a complete letter with a real person in it — exactly what
    // saveDraftBody exists to refuse. If the editor ever held this string, the
    // next save would post PHI, and the guard fires precisely because it would.
    const filled = mergeLetter(LETTER, {
      'PATIENT NAME': 'Jane Doe',
      'MEMBER ID': 'W9912384401',
    })

    expect(filled).toContain('Jane Doe')
    expect(droppedPatientSlots(LETTER, filled).map(d => d.key).sort()).toEqual([
      'MEMBER ID',
      'PATIENT NAME',
    ])
  })

  it('leaves the unmerged body with its placeholders intact', () => {
    // Merging does not mutate. The body the editor holds after a preview is the
    // same body it held before one.
    const before = findPlaceholders(LETTER).map(p => p.key)
    mergeLetter(LETTER, { 'PATIENT NAME': 'Jane Doe' })
    expect(findPlaceholders(LETTER).map(p => p.key)).toEqual(before)
  })

  it('keeps brackets on slots the browser has no value for', () => {
    // Which is what makes the guard's job possible on a partially filled
    // letter: an unfilled slot is still a slot.
    const filled = mergeLetter(LETTER, { 'PATIENT NAME': 'Jane Doe' })
    expect(filled).toContain('[MEMBER ID]')
    expect(droppedPatientSlots(LETTER, filled).map(d => d.key)).toEqual(['PATIENT NAME'])
  })
})

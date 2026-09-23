import { GEMINI_AVAILABLE, getModel } from '@/lib/ai/gemini-client'

/**
 * Turning what a biller just said into the note they would have typed.
 *
 * The note is the single most valuable field in the product — it is the only
 * place the real reason for a denial exists, as opposed to the code an
 * adjudication system picked off a list — and it is also the field people skip,
 * because writing it happens at the worst possible moment: straight off a
 * forty-minute hold, with the next call queued. What actually gets typed is
 * "called, no auth on file, resubmit" or nothing at all.
 *
 * So the biller talks or types roughly, and this writes the note. The same
 * bargain as a mail client that drafts a reply: the human supplies what they
 * know, the model supplies the sentence, and the human still presses Save.
 *
 * WHAT THIS IS NOT ALLOWED TO DO is most of the rules below. A note that invents
 * a reference number is worse than no note, because the next person to read it
 * has no way to tell which half came from the payer. It may only rearrange and
 * clarify what it was given.
 */

/**
 * The claim, as much of it as helps the model write plainly.
 *
 * Passed so a dictated "they said the auth was under the wrong NPI" can be
 * written against a denial that is already known to be CO-197, rather than
 * hedged into uselessness. No patient identifier is in here, for the same reason
 * no table has a column for one.
 */
export interface NoteClaimFacts {
  claimNumber?: string | null
  payer?: string | null
  carc?: string | null
  reason?: string | null
}

const SYSTEM_PROMPT = `
You write one internal note on a denied medical claim, for a medical biller's own
worklist. You are given a rough dictation or a few typed fragments and you return
the note that person would have written if they had had time.

WHO READS IT. A colleague at the same billing company, six weeks from now,
picking this claim up cold — and the drafting model that will build an appeal
letter from it. Neither of them was on the call. Write for them.

THE ONE RULE THAT MATTERS: ADD NOTHING. Every fact in your note must be in the
input. You may reorder, join fragments into sentences, fix grammar and spelling,
expand an obvious abbreviation, and turn speech into writing. You may NOT:
- invent or complete a reference number, authorization number, claim number,
  date, dollar amount, name or phone number. If the input has a partial one,
  write the partial one exactly as given.
- resolve what the speaker left ambiguous. "They said it was something about the
  NPI" stays that vague. Do not decide which NPI.
- name who was spoken to. "Called them" stays "called them". The payer on the
  claim is background, NOT an answer to who was on the phone — a biller rings
  clearinghouses, portals and the wrong department, and a note that says "the rep
  for <payer>" when they did not say so is a false attribution that the next
  reader has no way to catch.
- add an explanation of the denial code, a recommendation, a next step, or any
  billing knowledge of your own. The context you are given is so you can write
  the input clearly, NOT so you can contribute to it.
- soften or strengthen what was said. "The rep thought it might reprocess" is not
  "the rep confirmed it will reprocess".

HOW IT READS.
- Plain past-tense statements of what happened and what was said. No headings, no
  bullets, no salutation, no sign-off.
- Two to four sentences for an ordinary call. One is fine if that is all there
  was. Never longer than the input justifies.
- Lead with what the payer said, because that is what the next reader needs. Put
  who was called and when after it, if the input gives them.
- Write "the rep" or "the payer", not "I" and not "we" — it is a record, not a
  message.
- Keep every specific: numbers, dates, names of documents, what they asked for.
  These are the reason the note is worth writing.

OUTPUT. The note itself and nothing else. No preamble, no quotes around it, no
explanation of what you changed. If the input is too empty to write anything
truthful from, return it unchanged rather than inventing a note around it.
`

/**
 * The prompt, built and returnable without an API key.
 *
 * Split from the call for the same reason buildDraftRequest is: the decision
 * that shapes the output is which facts go in and which rules are switched on,
 * and that has to be assertable in a test without a network.
 */
export function buildNoteRequest(rough: string, claim: NoteClaimFacts = {}) {
  const facts = [
    claim.claimNumber ? `Claim: ${claim.claimNumber}` : null,
    claim.payer ? `Payer: ${claim.payer}` : null,
    claim.carc ? `Denial code: ${claim.carc}` : null,
    claim.reason ? `Denial reason as coded: ${claim.reason}` : null,
  ].filter(Boolean)

  const prompt =
    (facts.length
      ? `--- THE CLAIM (background only; do not restate it in the note) ---\n${facts.join('\n')}\n\n`
      : '') +
    `--- WHAT THE BILLER SAID ---\n${rough.trim()}`

  return { systemPrompt: SYSTEM_PROMPT, prompt, hasClaimContext: facts.length > 0 }
}

/**
 * Strip the wrapper a model puts around a thing it was asked for bare.
 *
 * Gemini will occasionally answer "Here is the note:" or wrap the whole thing in
 * quotes despite the instruction. Cheaper to remove than to keep re-prompting,
 * and a note that arrives with a preamble reads as a bug to the person about to
 * save it.
 */
export function cleanNote(raw: string): string {
  let out = raw.trim()
  out = out.replace(/^(here('s| is) (the|your) (rewritten |cleaned[- ]up )?note:?\s*)/i, '')
  out = out.replace(/^note:?\s*/i, '')
  if (out.length > 1 && out.startsWith('"') && out.endsWith('"')) out = out.slice(1, -1)
  return out.trim()
}

/**
 * Write the note. Returns the proposal — saving it stays the biller's act.
 *
 * Deliberately does not touch the database. A model that could write straight
 * into the note would be writing the most trusted field in the product without
 * anyone having read it, and DenialRow.lastTouchedAt would start meaning "a
 * machine did something", which is the one thing it must never mean.
 */
export async function writeNoteFromRough(
  rough: string,
  claim: NoteClaimFacts = {},
): Promise<string> {
  if (!GEMINI_AVAILABLE) {
    throw new Error('Note writing is not configured on this deployment (missing GEMINI_API_KEY).')
  }
  if (!rough.trim()) throw new Error('Say or type something first.')

  const { systemPrompt, prompt } = buildNoteRequest(rough, claim)
  const model = getModel(systemPrompt)
  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    // Lower than the drafting paths. This is transcription-shaped work — the
    // creative latitude that makes a good letter is exactly what invents a
    // reference number here.
    generationConfig: { temperature: 0.1, maxOutputTokens: 1024 },
  })

  const note = cleanNote(result.response.text())
  if (!note) throw new Error('The model returned nothing. Try saying a bit more.')
  return note
}

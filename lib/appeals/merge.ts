/**
 * Filling in the letter, in the browser.
 *
 * Every document drafted from a worklist row comes back with bracketed
 * placeholders where a patient identifier belongs — [PATIENT NAME], [MEMBER ID],
 * [DATE OF BIRTH] — because no table in this app has a column to hold one and
 * the drafting prompt is explicitly told to leave them (DEIDENTIFIED_ADDENDUM in
 * lib/denials/draft-response.ts). That is a deliberate privacy property, and it
 * also means the letter cannot be sent as it stands.
 *
 * This module closes that gap without reopening the privacy question: it is
 * pure, it takes values as arguments, and it is imported by a client component.
 * The patient's details are typed into React state, merged here in the browser,
 * and printed from the browser. They are never an argument to a tRPC mutation
 * and never reach the server.
 *
 * Keep it pure and free of imports for that reason. The moment this file needs a
 * server-side dependency is the moment someone is about to move the merge onto
 * the server, which is the one thing it exists to prevent.
 */

/**
 * A bracketed run of capitals, digits, spaces and simple punctuation.
 *
 * Deliberately narrow. Letters routinely contain ordinary bracketed prose and
 * citations — "[sic]", "[1 TAC §354.1003]" — and treating those as fields to
 * fill would put input boxes all over a finished document. Requiring the run to
 * be upper-case is what separates a slot from a parenthetical.
 */
const PLACEHOLDER_PATTERN = /\[([A-Z0-9][A-Z0-9 ./'#-]{1,48})\]/g

/**
 * The slots we know how to label and who owns each one.
 *
 * `practice` fields are filled from the Organization record on the server —
 * an NPI belongs to the provider, not the patient, so it is safe to store.
 * `patient` fields are PHI and are only ever held in component state.
 * Anything not listed is still offered as a field, typed as `other`, because a
 * model that invents [REFERRING PROVIDER] should not produce an unfillable
 * letter.
 */
export type PlaceholderOwner = 'patient' | 'practice' | 'other'

/**
 * Exported because the server has to know these too.
 *
 * server/trpc/router/worklist.ts imports this set to reject a saved draft body
 * that dropped a patient placeholder — the one write path where a biller could
 * type an identifier into the letter and post it. That is an import of this file
 * BY a server file, which is fine; the direction this file's header warns about
 * is the reverse one, where this file acquires a server dependency. It still has
 * none, and must not.
 */
export const PATIENT_SLOTS = new Set([
  'PATIENT NAME',
  'MEMBER ID',
  'MEMBER NUMBER',
  'SUBSCRIBER ID',
  'DATE OF BIRTH',
  'DOB',
  'PATIENT DOB',
  'PATIENT DATE OF BIRTH',
])

const PRACTICE_SLOTS = new Set([
  'PRACTICE NAME',
  'PROVIDER NAME',
  'PROVIDER',
  'NPI',
  'TIN',
  'TAX ID',
  'PRACTICE ADDRESS',
  'PRACTICE PHONE',
  'CONTACT NAME',
  'PHONE',
  'FAX',
])

export interface Placeholder {
  /** The literal token as it appears in the body, brackets included. */
  token: string
  /** The token without brackets — "PATIENT NAME". */
  key: string
  /** Sentence case for a form label — "Patient name". */
  label: string
  owner: PlaceholderOwner
}

export function ownerOf(key: string): PlaceholderOwner {
  if (PATIENT_SLOTS.has(key)) return 'patient'
  if (PRACTICE_SLOTS.has(key)) return 'practice'
  return 'other'
}

function labelFor(key: string): string {
  const lower = key.toLowerCase()
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

/**
 * Every distinct slot in a draft, in the order it first appears.
 *
 * Document order matters: the identifier block is at the top of a letter, so a
 * form built from this list asks for the patient's name before it asks for the
 * signature block, which is the order the biller is reading in.
 */
export function findPlaceholders(body: string): Placeholder[] {
  const seen = new Set<string>()
  const out: Placeholder[] = []
  for (const match of body.matchAll(PLACEHOLDER_PATTERN)) {
    const key = match[1].trim()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push({ token: `[${match[1]}]`, key, label: labelFor(key), owner: ownerOf(key) })
  }
  return out
}

/**
 * Substitute what we have and leave alone what we do not.
 *
 * An unfilled slot keeps its brackets rather than collapsing to an empty string.
 * A letter that reads "Re: claim for , member ID" looks like a rendering bug and
 * a payer will reject it; one that still says [MEMBER ID] is visibly unfinished,
 * which is the correct signal to the person about to send it.
 *
 * Values are keyed without brackets: { 'PATIENT NAME': 'Jane Doe' }.
 */
export function mergeLetter(body: string, values: Record<string, string>): string {
  return body.replace(PLACEHOLDER_PATTERN, (token, rawKey: string) => {
    const value = values[rawKey.trim()]
    return value && value.trim() ? value.trim() : token
  })
}

/** Slots still unfilled after a merge — what the "not ready to send" notice counts. */
export function unresolvedPlaceholders(
  body: string,
  values: Record<string, string>,
): Placeholder[] {
  return findPlaceholders(mergeLetter(body, values))
}

/**
 * Patient slots the edit deleted — the signature of a name typed over a
 * placeholder.
 *
 * An editable letter body is the one place a biller can put PHI somewhere it
 * would be saved: select "[PATIENT NAME]", type "Jane Doe", save. Nothing can
 * recognise "Jane Doe" as a name, but the placeholder that was standing there a
 * moment ago is gone, and that is detectable exactly.
 *
 * Deliberately one-directional. Slots ADDED are ignored — a model that decides
 * v4 also wants [MEMBER ID] is doing its job. And ordinary prose edits keep
 * every token, so this is silent for the editing a biller actually does.
 *
 * Pure, and shared verbatim by the textarea's onChange guard and the mutation's
 * server-side one, so the message a biller gets and the rule that is actually
 * enforced can never drift apart.
 */
export function droppedPatientSlots(before: string, after: string): Placeholder[] {
  const kept = new Set(findPlaceholders(after).map(p => p.key))
  return findPlaceholders(before).filter(p => p.owner === 'patient' && !kept.has(p.key))
}

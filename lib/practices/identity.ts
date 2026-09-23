/**
 * Which signature block a letter gets.
 *
 * Two tables can answer this. `Practice` holds one clinic's identity; the twelve
 * identical columns on `Organization` are what the workspace had before
 * practices existed, kept as a fallback so that no letter drafted before this
 * release loses its block and so a workspace that never creates a practice
 * keeps working unchanged.
 *
 * Nothing else may read either set directly. Two call sites resolve this — the
 * server, baking the block into the draft (`worklist.draft`), and the browser,
 * filling the [PRACTICE NAME] placeholders in a completed letter (`WorkPanel`) —
 * and a letter whose body says one clinic while its filled placeholders say
 * another is a document that goes to a payer with two different providers on it.
 * One function, so they cannot disagree.
 *
 * None of this is PHI: an NPI and a TIN identify the billing provider, not a
 * patient. See the schema header and __tests__/no-phi-columns.test.ts.
 */

/** The twelve, as a Prisma `select`. Identical on both models, by construction. */
export const PRACTICE_IDENTITY_SELECT = {
  practiceName: true,
  npi: true,
  tin: true,
  addressLine1: true,
  addressLine2: true,
  city: true,
  state: true,
  postalCode: true,
  contactName: true,
  contactPhone: true,
  contactFax: true,
  contactEmail: true,
} as const

export type PracticeIdentityFields = {
  [K in keyof typeof PRACTICE_IDENTITY_SELECT]?: string | null
}

/** Where the resolved block came from, for the UI to say so honestly. */
export type IdentitySource = 'practice' | 'organization' | 'none'

export interface ResolvedIdentity extends PracticeIdentityFields {
  source: IdentitySource
  /** The practice's own label, when one answered. Never goes on the letter. */
  practiceLabel: string | null
}

/** Does this record say anything at all? A blank profile must not win. */
function hasIdentity(v: PracticeIdentityFields | null | undefined): boolean {
  if (!v) return false
  return Object.keys(PRACTICE_IDENTITY_SELECT).some(k =>
    Boolean((v as Record<string, string | null | undefined>)[k]?.trim()),
  )
}

function pick(v: PracticeIdentityFields): PracticeIdentityFields {
  const out: Record<string, string | null> = {}
  for (const k of Object.keys(PRACTICE_IDENTITY_SELECT)) {
    out[k] = (v as Record<string, string | null | undefined>)[k]?.trim() || null
  }
  return out as PracticeIdentityFields
}

/**
 * Resolve the block for one row.
 *
 * **Whole-record, never field-by-field.** A practice that names itself but has
 * no fax number does NOT borrow the organization's fax. Merging per field
 * produces a letterhead that is half one clinic and half another — the clinic's
 * name over the billing company's address — which is worse than a missing line
 * because it is wrong in a way that looks complete. Whichever record answers,
 * answers for all twelve.
 *
 * The practice wins when it has anything to say. An all-blank practice row —
 * created in settings and not yet filled in — falls through to the
 * organization, because an empty block helps nobody and the org's is what the
 * workspace was already signing with yesterday.
 */
export function practiceIdentity(
  practice: (PracticeIdentityFields & { name?: string | null }) | null | undefined,
  org: PracticeIdentityFields | null | undefined,
): ResolvedIdentity {
  if (hasIdentity(practice)) {
    return {
      ...pick(practice!),
      source: 'practice',
      practiceLabel: practice!.name?.trim() || null,
    }
  }
  if (hasIdentity(org)) {
    return { ...pick(org!), source: 'organization', practiceLabel: null }
  }
  // Neither is filled in. The draft prompt's "sign [PRACTICE NAME]" branch
  // fires on a null practiceName, which this gives it.
  return {
    ...pick({}),
    source: 'none',
    practiceLabel: practice?.name?.trim() || null,
  }
}

/**
 * Remark codes: getting underneath a vague denial.
 *
 * A working billing manager put the problem exactly: "if the denial is something
 * vague like CO 16 it has no specific way to fix it and fails then and there —
 * a missing info denial can mean a lot of things." He is right, and until this
 * file existed Yeam had the same hole. lib/denials/triage.ts routes CO-16 to a
 * corrected claim and then says, in effect, go read the remittance yourself.
 *
 * The remittance already answers it. Payers pair a vague CARC with a Remittance
 * Advice Remark Code — N290 is a missing rendering NPI, M76 is a missing
 * diagnosis, MA130 means the claim has no appeal rights at all and must be
 * resubmitted. That is the difference between "something was missing" and "add
 * the rendering provider's NPI and resubmit."
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS FILE IS ADDITIVE ON PURPOSE. It does not modify the CARC table or the
 * filing windows in lib/denials/triage.ts, because those are a deliberate copy
 * of lib/triage.ts in the yeam_website repo and drift between them is the
 * failure that file's header exists to prevent. Refinement layers on top of a
 * triaged row: the remedy still comes from triage, this only sharpens the note.
 * A row with no remark code and no recognisable wording degrades to exactly the
 * behaviour that existed before this file.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * No new import field was added for this. The denials parser already folds a
 * "remark" column into `reason` (see HEADER_PATTERNS in parse-claims.ts), so the
 * codes are extracted from that free text rather than by widening the import
 * profile — which would have meant editing the twin of parseClaims.ts too.
 */

/** How sure we are about the refinement. Shown to the user, never hidden. */
export type RefinementSource =
  /** An actual remark code was present and recognised. */
  | 'remark-code'
  /** No code, but the payer's wording named the defect unambiguously. */
  | 'reason-text'

export type Refinement = {
  /** The remark code we matched, when there was one. */
  rarc: string | null
  /** What is actually wrong, in the words a biller would use. */
  cause: string
  /** The specific next step. This is the part that was missing before. */
  action: string
  source: RefinementSource
  /**
   * True when the remark code says the payer will not entertain an appeal and
   * the claim must be resubmitted instead. Sending an appeal against one of
   * these burns the window for nothing.
   */
  noAppealRights?: boolean
}

type RarcEntry = {
  cause: string
  action: string
  noAppealRights?: boolean
}

/**
 * Remittance Advice Remark Codes, restricted to the ones that actually resolve
 * a vague denial. This is deliberately not the full CMS list: a code that
 * repeats what the CARC already said adds a row to the table and nothing to the
 * biller's day.
 */
const RARC: Record<string, RarcEntry> = {
  /* --- provider identifiers -------------------------------------------- */
  N290: {
    cause: 'Rendering provider NPI missing or invalid',
    action: 'Add the rendering provider\'s NPI in box 24J and resubmit as a corrected claim.',
  },
  N291: {
    cause: 'Rendering provider secondary identifier missing or invalid',
    action: 'Add the payer-assigned provider number or taxonomy and resubmit.',
  },
  N286: {
    cause: 'Referring provider NPI missing or invalid',
    action: 'Add the referring provider\'s NPI in box 17B and resubmit.',
  },
  N264: {
    cause: 'Ordering provider name missing or invalid',
    action: 'Add the ordering provider\'s name and resubmit.',
  },
  N265: {
    cause: 'Ordering provider NPI missing or invalid',
    action: 'Add the ordering provider\'s NPI and resubmit.',
  },
  MA112: {
    cause: 'Group practice information missing or invalid',
    action: 'Check the billing provider NPI and tax ID in boxes 25 and 33, then resubmit.',
  },
  MA120: {
    cause: 'CLIA certification number missing or invalid',
    action: 'Add the CLIA number in box 23. Lab codes cannot be paid without it.',
  },

  /* --- coding ----------------------------------------------------------- */
  M51: {
    cause: 'Procedure code missing or invalid',
    action: 'Verify the CPT/HCPCS against the code set effective on the date of service and resubmit.',
  },
  M20: {
    cause: 'HCPCS code missing or invalid',
    action: 'Supply the correct HCPCS Level II code and resubmit.',
  },
  M76: {
    cause: 'Diagnosis code missing or invalid',
    action: 'Supply a valid ICD-10 code that supports the procedure and resubmit.',
  },
  M119: {
    cause: 'NDC missing or invalid',
    action: 'Add the 11-digit NDC and units for the drug billed, then resubmit.',
  },
  N56: {
    cause: 'Procedure code not valid for the service or the date of service',
    action: 'Re-code against the code set in force on the date of service and resubmit.',
  },
  N657: {
    cause: 'Billed under the wrong code for this service',
    action: 'Rebill with the code the payer considers appropriate for what was performed.',
  },
  M79: {
    cause: 'Charge amount missing or invalid',
    action: 'Correct the charge in box 24F and resubmit.',
  },

  /* --- bundling and frequency -------------------------------------------- */
  M15: {
    cause: 'Bundled — separately billed services are not paid separately',
    action:
      'Check the NCCI edit pair. If the services were genuinely distinct, resubmit with modifier 59/XE, XS, XP or XU; if not, this is a write-off.',
  },
  N19: {
    cause: 'Incidental to the primary procedure',
    action:
      'Confirm whether an NCCI modifier legitimately overrides the edit. If none applies, close the line.',
  },
  M80: {
    cause: 'Not payable in the same session as a service already processed',
    action: 'Establish that the encounters were separate, with times documented, or write it off.',
  },
  N362: {
    cause: 'Units billed exceed the acceptable maximum',
    action: 'Reconcile delivered units against the policy maximum and the authorization.',
  },
  N522: {
    cause: 'Duplicate of a claim already processed',
    action:
      'Check whether the original paid before doing anything. If it did, close this line rather than resubmitting.',
  },

  /* --- coverage, eligibility and coordination ----------------------------- */
  N4: {
    cause: 'Primary insurer\'s EOB missing',
    action: 'Attach the primary payer\'s remittance and resubmit as a secondary claim.',
  },
  N30: {
    cause: 'Patient ineligible for this service',
    action: 'Re-verify eligibility for the date of service before spending any more time on this.',
  },
  N130: {
    cause: 'Decision rests on the plan benefit documents',
    action:
      'Request the specific plan language in writing. Do not argue medical necessity against a benefit exclusion.',
  },
  N115: {
    cause: 'Denied under a Local Coverage Determination',
    action:
      'Pull the LCD, check the covered diagnosis list, and appeal only if the documentation meets the stated criteria.',
  },

  /* --- the one that changes the whole strategy ---------------------------- */
  MA130: {
    cause: 'Claim carries incomplete or invalid information and has NO appeal rights',
    action:
      'Do not appeal this — the payer will not review it. Correct the defect and submit a new claim.',
    noAppealRights: true,
  },
  N517: {
    cause: 'Payer is asking for a fresh corrected claim',
    action: 'Resubmit as a new claim with the corrected information rather than appealing.',
    noAppealRights: true,
  },
}

/**
 * Wording patterns, for the very common case of an export that carries the
 * payer's prose but not the remark code.
 *
 * Ordered most specific first. These are matched only against the denial reason
 * text, and only when no remark code was found — a real code always wins over an
 * inference from prose.
 */
const REASON_PATTERNS: { match: RegExp; cause: string; action: string }[] = [
  {
    match: /\b(rendering|billing|referring|ordering)?\s*(provider|physician)?\s*npi\b/i,
    cause: 'Provider NPI missing or invalid',
    action: 'Add the correct provider NPI and resubmit as a corrected claim.',
  },
  {
    match: /\btaxonom(y|ies)\b/i,
    cause: 'Provider taxonomy missing or invalid',
    action: 'Add the taxonomy code that matches the provider\'s enrolment and resubmit.',
  },
  {
    match: /\bmodifier\b/i,
    cause: 'Modifier missing or invalid',
    action: 'Add or correct the modifier the code pair requires, then resubmit.',
  },
  {
    match: /\b(prior\s*auth|pre[-\s]?auth|authorization|precert)\w*\b/i,
    cause: 'Authorization missing or invalid',
    action:
      'Attach the authorization number, or pursue a retro-authorization if none was obtained.',
  },
  {
    match: /\b(ndc|national\s*drug\s*code)\b/i,
    cause: 'NDC missing or invalid',
    action: 'Add the 11-digit NDC and the units administered, then resubmit.',
  },
  {
    match: /\bclia\b/i,
    cause: 'CLIA number missing',
    action: 'Add the CLIA certification number in box 23 and resubmit.',
  },
  {
    match: /\b(diagnosis|dx)\b.*\b(missing|invalid|incomplete|not\s*support)/i,
    cause: 'Diagnosis missing or invalid',
    action: 'Supply a valid ICD-10 code that supports the procedure and resubmit.',
  },
  {
    match: /\b(eob|explanation\s*of\s*benefits|primary\s*(payer|insurance)|cob|coordination\s*of\s*benefits)\b/i,
    cause: 'Primary payer\'s EOB missing',
    action: 'Attach the primary payer\'s remittance and resubmit as a secondary claim.',
  },
  {
    match: /\b(medical\s*record|documentation|chart\s*note|office\s*note|progress\s*note)s?\b/i,
    cause: 'Supporting documentation not received',
    action: 'Send the specific records the payer named, with the claim number on every page.',
  },
  {
    match: /\b(place\s*of\s*service|pos)\b/i,
    cause: 'Place of service missing or invalid',
    action: 'Correct the POS code to match where the service was actually delivered.',
  },
  {
    match: /\b(units|quantity|frequency)\b/i,
    cause: 'Units or frequency questioned',
    action: 'Reconcile the units delivered against the authorization and the policy maximum.',
  },
  {
    match: /\b(member|subscriber|policy|insured)\s*(id|number|#)\b/i,
    cause: 'Member identifier missing or invalid',
    action: 'Re-verify the member ID against the card and resubmit.',
  },
  {
    match: /\b(date\s*of\s*service|dos|service\s*date)\b.*\b(missing|invalid|incomplete)/i,
    cause: 'Date of service missing or invalid',
    action: 'Correct the service date and resubmit.',
  },
]

/**
 * CARCs vague enough to be worth refining.
 *
 * Deliberately narrow. A CO-50 already tells the biller it is a medical-necessity
 * argument, and decorating it with a remark code adds noise; a CO-16 tells them
 * nothing they can act on. Refinement is offered where the CARC alone leaves the
 * next step genuinely undetermined.
 */
const VAGUE_CARCS = new Set(['16', '96', '97', '11', '4', '151', '18', 'B7', '119', '204'])

/**
 * Remark codes as they appear in remittance prose: N290, M76, MA130.
 *
 * The trailing lookahead keeps ICD-10 codes out. "M54.16" is a dorsalgia
 * diagnosis and "M54" is not a remark code, but the bare pattern matches it
 * because the decimal point is a word boundary — and denial reason text very
 * often carries the diagnosis. An unrecognised code would fall through the
 * table lookup harmlessly, but extractRarcs is public and should not report a
 * diagnosis as a remark code to anything that calls it.
 */
const RARC_PATTERN = /\b(MA\d{1,3}|[NM]\d{1,3})\b(?!\.\d)/gi

/**
 * Pull every remark code out of a free-text denial reason.
 *
 * Returned in the order they appear, upper-cased and de-duplicated. A remittance
 * commonly carries several; the caller decides which to lead with.
 */
export function extractRarcs(reason: string | null | undefined): string[] {
  if (!reason) return []
  const seen = new Set<string>()
  for (const match of reason.matchAll(RARC_PATTERN)) {
    seen.add(match[1].toUpperCase())
  }
  return [...seen]
}

/** Whether this denial code is one the CARC table cannot fully resolve alone. */
export function isVague(carc: string): boolean {
  const bare = (carc ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/^(CO|PR|OA|PI)[-–—]?/, '')
  return VAGUE_CARCS.has(bare)
}

/**
 * Sharpen a vague denial into a specific defect and a specific next step.
 *
 * Returns null when there is nothing honest to add — which is a real answer, not
 * a failure. A row that comes back null is one where the remittance genuinely
 * does not say, and the biller needs the payer on the phone. Saying so beats
 * inventing a cause, which is precisely what the competitor in the field
 * feedback was doing.
 */
export function refineDenial(input: {
  carc: string
  reason?: string | null
}): Refinement | null {
  if (!isVague(input.carc)) return null

  // A real remark code beats an inference from prose, every time.
  for (const code of extractRarcs(input.reason)) {
    const entry = RARC[code]
    if (entry) {
      return {
        rarc: code,
        cause: entry.cause,
        action: entry.action,
        source: 'remark-code',
        ...(entry.noAppealRights ? { noAppealRights: true } : {}),
      }
    }
  }

  const text = input.reason?.trim()
  if (!text) return null

  for (const pattern of REASON_PATTERNS) {
    if (pattern.match.test(text)) {
      return {
        rarc: null,
        cause: pattern.cause,
        action: pattern.action,
        source: 'reason-text',
      }
    }
  }

  return null
}

/**
 * Everything the remittance said, for the drafting prompt.
 *
 * The drafter has always received the raw reason string. Handing it the resolved
 * cause as well is what stops a corrected-claim transmittal saying "information
 * was missing" when the remittance said which information.
 */
export function refinementBrief(refinement: Refinement | null): string | null {
  if (!refinement) return null
  const code = refinement.rarc ? `${refinement.rarc}: ` : ''
  const appeal = refinement.noAppealRights
    ? ' The payer has assigned NO APPEAL RIGHTS to this denial — it must be corrected and resubmitted, never appealed.'
    : ''
  return `${code}${refinement.cause}. ${refinement.action}${appeal}`
}

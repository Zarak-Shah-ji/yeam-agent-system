/**
 * Payer directory for appeal correspondence.
 *
 * An appeal letter is only credible if it is addressed the way that payer
 * actually receives appeals: the right unit, the right window, the right
 * submission channel, and the evidence that payer's reviewers look for. A
 * generic "Dear Appeals Department" letter is the fastest way to tell a billing
 * manager that nobody involved has worked a denial.
 *
 * The dataset behind this app is Texas Medicaid, so the panel is the Texas
 * market: the STAR / STAR+PLUS managed-care organizations that actually
 * administer these benefits, plus TMHP for fee-for-service claims.
 *
 * ⚠️ DEMO DATA. Addresses, windows and channels below reflect each payer's
 * published provider-appeal guidance, but payers revise them routinely.
 * Re-verify against the current provider manual before any letter drafted here
 * is sent to a real payer.
 */

export interface PayerProfile {
  /** Stable key persisted on the patient record. */
  key: string
  /** Legal name as it should appear in the address block. */
  name: string
  /** Short form for UI badges. */
  shortName: string
  /** Where a written provider appeal is mailed. */
  appealsAddress: string
  /**
   * Days to file a provider appeal, counted from the remittance/EOP disposition
   * date — NOT from the date of service. These are different clocks and
   * conflating them is the most common way an appeal is filed late.
   */
  appealWindowDays: number
  /** What that clock runs from, in the payer's own vocabulary. */
  appealWindowFrom: string
  /** Days from the date of service to file the ORIGINAL claim. A separate clock. */
  timelyFilingDays: number
  /**
   * Absolute ceiling measured from the date of service, beyond which the claim
   * can no longer be paid at all regardless of how recent the remittance was.
   * Texas Medicaid sets this at 24 months (1 TAC §354.1003); commercial plans
   * generally have no equivalent, so this is null for them.
   */
  absoluteLimitDaysFromDos: number | null
  /** Citation for the ceiling, so a letter can name the authority. */
  absoluteLimitBasis: string | null
  /** Preferred electronic channel — cited so the letter shows channel awareness. */
  submissionChannel: string
  /** The payer's own named form, when it requires one. */
  requiredForm: string | null
  /** EDI payer ID, cited in the Re: block by billing staff. */
  ediPayerId: string
  /** Member ID format, as a template: # = digit, A = uppercase letter. */
  memberIdFormat: string
  /**
   * How this payer's reviewers expect to be addressed. Fed to the model as
   * voice guidance so the five letters do not read as one letter with the
   * name swapped.
   */
  houseStyle: string
}

export const PAYERS: PayerProfile[] = [
  {
    key: 'BCBSTX',
    name: 'Blue Cross and Blue Shield of Texas',
    shortName: 'BCBSTX',
    appealsAddress:
      'Blue Cross and Blue Shield of Texas\nAttn: Claim Review Section\nPO Box 660044\nDallas, TX 75266-0044',
    appealWindowDays: 180,
    appealWindowFrom: 'the date of the Provider Claim Summary (PCS)',
    timelyFilingDays: 180,
    absoluteLimitDaysFromDos: null,
    absoluteLimitBasis: null,
    submissionChannel: 'Availity Essentials provider portal',
    requiredForm: 'Claim Review Form',
    ediPayerId: '84980',
    memberIdFormat: 'AAA#########',
    houseStyle:
      'Formal and documentation-led. BCBSTX reviewers work from the Provider Claim Summary, so cite the PCS date and reference the Claim Review Form as the enclosure. Lead with the specific contract or policy provision being disputed rather than a general appeal to fairness. Keep it to a single page.',
  },
  {
    key: 'AETNA_TX',
    name: 'Aetna Better Health of Texas',
    shortName: 'Aetna',
    appealsAddress:
      'Aetna Better Health of Texas\nAttn: Provider Resolution Team\nPO Box 81040\nLondon, KY 40742',
    // Medicaid MCO: HHSC's Uniform Managed Care Manual fixes this at 120 days
    // from R&S disposition, overriding Aetna's 180-day commercial standard.
    appealWindowDays: 120,
    appealWindowFrom: 'the date of disposition on the Remittance and Status (R&S) Report',
    timelyFilingDays: 95,
    absoluteLimitDaysFromDos: 730,
    absoluteLimitBasis: '1 TAC §354.1003 (24 months from date of service)',
    submissionChannel: 'Availity provider portal',
    requiredForm: 'Provider Complaint and Appeal Form',
    ediPayerId: '38692',
    memberIdFormat: 'W#########',
    houseStyle:
      'Structured and checklist-driven. Aetna routes provider appeals through a Resolution Team that works to explicit criteria, so state the requested action in the first sentence, enumerate the enclosures as a numbered list, and tie each enclosure to the specific denial element it rebuts.',
  },
  {
    key: 'CIGNA',
    name: 'Cigna Healthcare',
    shortName: 'Cigna',
    appealsAddress:
      'Cigna Healthcare\nAttn: National Appeals Unit\nPO Box 188011\nChattanooga, TN 37422',
    appealWindowDays: 180,
    appealWindowFrom: 'the date printed on the original remittance advice',
    timelyFilingDays: 180,
    absoluteLimitDaysFromDos: null,
    absoluteLimitBasis: null,
    submissionChannel: 'CignaforHCP provider portal',
    requiredForm: null,
    ediPayerId: '62308',
    memberIdFormat: 'U#########',
    houseStyle:
      'Clinical and narrative. Cigna\'s National Appeals Unit routes medical-necessity questions to clinical reviewers, so write to a clinician: describe the presentation, the clinical decision, and the outcome in prose before citing codes. Reference the applicable Cigna Coverage Policy by name where one governs.',
  },
  {
    key: 'UHC_TX',
    name: 'UnitedHealthcare Community Plan of Texas',
    shortName: 'UHC',
    appealsAddress:
      'UnitedHealthcare Community Plan\nAttn: Provider Appeals\nPO Box 31364\nSalt Lake City, UT 84131-0364',
    // Medicaid MCO: the state contract governs, not UHC's commercial timeline.
    appealWindowDays: 120,
    appealWindowFrom: 'the date of disposition on the Remittance and Status (R&S) Report',
    timelyFilingDays: 95,
    absoluteLimitDaysFromDos: 730,
    absoluteLimitBasis: '1 TAC §354.1003 (24 months from date of service)',
    submissionChannel: 'UnitedHealthcare Provider Portal',
    requiredForm: 'Claim Reconsideration Request',
    ediPayerId: '87726',
    memberIdFormat: '#########',
    houseStyle:
      'Concise and process-aware. UHC distinguishes a claim reconsideration from a formal appeal and expects the correct one to be named. State which is being requested, reference the original claim number (ICN/DCN), and keep the argument to three tight paragraphs.',
  },
  {
    key: 'TX_MEDICAID',
    name: 'Texas Medicaid (TMHP)',
    shortName: 'TX Medicaid',
    appealsAddress:
      'Texas Medicaid & Healthcare Partnership\nAttn: Claim Appeals\nPO Box 200645\nAustin, TX 78720-0645',
    appealWindowDays: 120,
    appealWindowFrom: 'the date of disposition on the Remittance and Status (R&S) Report',
    timelyFilingDays: 95,
    absoluteLimitDaysFromDos: 730,
    absoluteLimitBasis: '1 TAC §354.1003 (24 months from date of service)',
    submissionChannel: 'TexMedConnect',
    requiredForm: 'TMHP Claim Appeal',
    ediPayerId: '617591011',
    memberIdFormat: '#########',
    houseStyle:
      'Strictly procedural. TMHP appeals are adjudicated against the Texas Medicaid Provider Procedures Manual, so cite the R&S report date, the affected Internal Control Number (ICN), and the specific TMPPM section relied on. Texas allows only one appeal per claim detail — state plainly that this is that appeal and that all supporting documentation is enclosed.',
  },
]

const BY_KEY = new Map(PAYERS.map(p => [p.key, p]))

export function getPayer(key: string | null | undefined): PayerProfile | null {
  return key ? BY_KEY.get(key) ?? null : null
}

/**
 * Deterministic payer for a patient, so a given patient keeps the same plan
 * across re-runs of the backfill and across environments.
 */
export function payerForSeed(seed: string): PayerProfile {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return PAYERS[h % PAYERS.length]
}

const DIGITS = '0123456789'
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ' // no I/O — payers omit them to avoid 1/0 confusion

/** Build a member ID that matches the payer's published format. */
export function memberIdFor(payer: PayerProfile, seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 131 + seed.charCodeAt(i)) >>> 0
  let out = ''
  for (const ch of payer.memberIdFormat) {
    h = (h * 1103515245 + 12345) >>> 0
    if (ch === '#') out += DIGITS[h % 10]
    else if (ch === 'A') out += LETTERS[h % LETTERS.length]
    else out += ch
  }
  return out
}

export interface AppealWindow {
  /** The operative date the appeal must reach the payer by. */
  deadline: Date
  /** remittance + appealWindowDays, ignoring any date-of-service ceiling. */
  fromRemittance: Date
  /** dateOfService + absoluteLimitDaysFromDos, or null where none applies. */
  fromServiceDate: Date | null
  /** Which clock actually binds — what the letter should cite. */
  governedBy: 'remittance' | 'date-of-service'
}

/**
 * Resolve the appeal deadline from BOTH clocks and return the earlier.
 *
 * Two independent limits apply, and they are routinely conflated:
 *
 *   1. The appeal window, counted from the date printed on the remittance /
 *      R&S / EOB — not the date it was received, and not the date of service.
 *   2. For Texas Medicaid, an absolute ceiling 24 months after the date of
 *      service (1 TAC §354.1003), past which the claim cannot be paid at all
 *      however recent the remittance was.
 *
 * A claim adjudicated late can therefore have a live 120-day appeal window that
 * is already worthless because the 24-month ceiling has passed. Returning only
 * the remittance-based date would advertise a deadline that does not exist.
 */
export function resolveAppealWindow(
  payer: PayerProfile,
  remittanceDate: Date,
  dateOfService?: Date | null,
): AppealWindow {
  const fromRemittance = new Date(remittanceDate)
  fromRemittance.setDate(fromRemittance.getDate() + payer.appealWindowDays)

  let fromServiceDate: Date | null = null
  if (dateOfService && payer.absoluteLimitDaysFromDos != null) {
    fromServiceDate = new Date(dateOfService)
    fromServiceDate.setDate(fromServiceDate.getDate() + payer.absoluteLimitDaysFromDos)
  }

  const capped = fromServiceDate != null && fromServiceDate < fromRemittance
  return {
    deadline: capped ? fromServiceDate! : fromRemittance,
    fromRemittance,
    fromServiceDate,
    governedBy: capped ? 'date-of-service' : 'remittance',
  }
}

/**
 * The date by which the appeal must reach the payer.
 * Pass the date of service so the absolute ceiling is honoured where one applies.
 */
export function appealDeadline(
  payer: PayerProfile,
  remittanceDate: Date,
  dateOfService?: Date | null,
): Date {
  return resolveAppealWindow(payer, remittanceDate, dateOfService).deadline
}

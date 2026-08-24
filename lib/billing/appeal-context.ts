import { prisma } from '@/lib/db'
import { getPayer, resolveAppealWindow, type PayerProfile } from './payers'
import { getPlaybook, type DenialPlaybook } from './denial-playbooks'
import { profileFor, describeIcd } from './procedure-codes'

/**
 * Structured context for drafting an insurance appeal letter.
 * Fields that are genuinely absent from the data model are left null so the
 * letter can render a clearly-marked placeholder instead of asking the user.
 */
export interface AppealContext {
  claimNumber: string
  /**
   * Payer-assigned Internal Control Number. Every adjudicated claim has one and
   * appeals are worked by it, so without it the letter has to leave a bracket in
   * the sentence that matters most.
   */
  internalControlNumber: string
  serviceDate: string | null // MM/DD/YYYY
  /** Date the remittance advice issued — the appeal clock runs from here. */
  remittanceDate: string | null
  /** Last date this appeal can be filed — the earlier of the two clocks below. */
  appealDeadline: string | null
  /** Days left to file, as of today. Negative means the window has closed. */
  daysRemaining: number | null
  /**
   * Which limit actually binds: the appeal window counted from the remittance,
   * or Texas Medicaid's 24-month ceiling counted from the date of service. The
   * letter should cite whichever one it is.
   */
  deadlineGovernedBy: 'remittance' | 'date-of-service' | null
  /** Deadline from the date of service, where a ceiling applies. */
  absoluteDeadlineFromDos: string | null
  /** Days from date of service to file the original claim — a separate clock. */
  timelyFilingDays: number | null
  claimStatus: string
  /** Submitted charge — the amount actually in dispute. */
  billedAmount: number | null
  /** Contracted/fee-schedule allowable, needed to argue a rate dispute (CO-45). */
  allowedAmount: number | null
  paidAmount: number | null
  denialReason: string | null
  denialCode: string | null
  payer: PayerProfile | null
  patient: {
    name: string
    dateOfBirth: string | null
    mrn: string
    memberId: string | null
    address: string | null
    phone: string | null
  }
  provider: {
    name: string
    npi: string
    credentials: string | null
    address: string | null
  } | null
  procedure: {
    code: string
    /** CPT vs HCPCS — S/T/H/D codes are HCPCS Level II, never "CPT". */
    codeSystem: 'CPT' | 'HCPCS'
    description: string | null
  } | null
  diagnoses: { code: string; description: string | null }[]
  /**
   * Diagnoses that legitimately support this procedure, excluding the ones
   * already on the claim. A CO-11 appeal has to name the code it is correcting
   * TO — without these the letter "corrects" the diagnosis to the same code it
   * already carried, which reads as incoherent to anyone checking.
   */
  supportedDiagnoses: { code: string; description: string | null }[]
  /** The argument strategy for this denial code, resolved from the playbooks. */
  playbook: DenialPlaybook | null
}

function fmtDate(d: Date | null | undefined): string | null {
  if (!d) return null
  return new Intl.DateTimeFormat('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
  }).format(d)
}

function joinAddress(parts: (string | null | undefined)[]): string | null {
  const cleaned = parts.map(p => p?.trim()).filter(Boolean)
  return cleaned.length ? cleaned.join(', ') : null
}

const DAY_MS = 86_400_000

/**
 * Build a plausible Internal Control Number.
 *
 * Payers assign an ICN at adjudication encoding the processing region, the year,
 * and the Julian day of receipt. The dataset carries no ICN, so derive a
 * well-formed one from the claim and its remittance date — deterministic, so the
 * same claim always cites the same number across redraws.
 */
function internalControlNumber(id: string, remittance: Date | null): string {
  const basis = remittance ?? new Date()
  const year = String(basis.getFullYear()).slice(2)
  const startOfYear = Date.UTC(basis.getFullYear(), 0, 0)
  const julian = String(
    Math.floor((basis.getTime() - startOfYear) / DAY_MS),
  ).padStart(3, '0')
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 33 + id.charCodeAt(i)) >>> 0
  const region = String(20 + (h % 10))
  const batch = String(h % 1_000_000).padStart(6, '0')
  const seq = String((h >>> 7) % 1000).padStart(3, '0')
  return `${region}${year}${julian}${batch}${seq}`
}

/**
 * Fetch the full claim context for an appeal from the live MedicaidEncounter
 * data model. The billing UI surfaces encounters as claims, so `claimId` is the
 * encounter id. Returns null if the encounter is not found.
 */
export async function buildAppealContext(claimId: string): Promise<AppealContext | null> {
  const enc = await prisma.medicaidEncounter.findUnique({
    where: { id: claimId },
    include: { patient: true, provider: true },
  })
  if (!enc) return null

  const hcpcs = enc.procCode
    ? await prisma.hcpcsCode.findUnique({ where: { code: enc.procCode } })
    : null

  const provider = enc.provider
  const providerName =
    provider?.orgName?.trim() ||
    [provider?.firstName, provider?.lastName].filter(Boolean).join(' ') ||
    'Yeam Health Clinic'

  // The payer rides on the patient's plan, not on the claim.
  const payer = getPayer(enc.patient.payerKey)
  const remittance = enc.remittanceDate
  // Pass the service date so a 24-month Medicaid ceiling can override a window
  // that still looks open when measured from the remittance alone.
  const window =
    payer && remittance
      ? resolveAppealWindow(payer, remittance, enc.encounterDate)
      : null
  const deadline = window?.deadline ?? null

  const procProfile = enc.procCode ? profileFor(enc.procCode) : null

  return {
    claimNumber: 'ENC-' + enc.id.slice(0, 8).toUpperCase(),
    internalControlNumber: internalControlNumber(enc.id, remittance),
    serviceDate: fmtDate(enc.encounterDate),
    remittanceDate: fmtDate(remittance),
    appealDeadline: fmtDate(deadline),
    daysRemaining: deadline
      ? Math.round((deadline.getTime() - Date.now()) / DAY_MS)
      : null,
    deadlineGovernedBy: window?.governedBy ?? null,
    absoluteDeadlineFromDos: fmtDate(window?.fromServiceDate ?? null),
    timelyFilingDays: payer?.timelyFilingDays ?? null,
    claimStatus: enc.claimStatus ?? 'denied',
    billedAmount: enc.billedAmount?.toNumber() ?? null,
    allowedAmount: hcpcs?.avgCostTx?.toNumber() ?? null,
    paidAmount: enc.paidAmount?.toNumber() ?? null,
    denialReason: enc.denialReason,
    denialCode: enc.denialCode,
    payer,
    patient: {
      name: [enc.patient.firstName, enc.patient.lastName].filter(Boolean).join(' '),
      dateOfBirth: fmtDate(enc.patient.dateOfBirth),
      mrn: enc.patient.mrn,
      memberId: enc.patient.insuranceId ?? null,
      address: joinAddress([
        enc.patient.addrLine1,
        enc.patient.city,
        enc.patient.state,
        enc.patient.zip,
      ]),
      phone: enc.patient.phone ?? null,
    },
    provider: provider
      ? {
          name: providerName,
          npi: provider.npi,
          credentials: provider.credentials ?? null,
          address: joinAddress([
            provider.addrLine1,
            provider.addrLine2,
            provider.city,
            provider.state,
            provider.zip,
          ]),
        }
      : null,
    procedure: enc.procCode
      ? {
          code: enc.procCode,
          codeSystem: procProfile?.system ?? 'HCPCS',
          description: hcpcs?.description ?? procProfile?.description ?? null,
        }
      : null,
    // Name the condition, not just the code — a bare ICD-10 string in a letter
    // reads as machine output to anyone who works denials.
    diagnoses: (enc.diagnosisCodes ?? []).map(code => ({
      code,
      description: describeIcd(code),
    })),
    supportedDiagnoses: (procProfile?.diagnoses ?? [])
      .filter(code => !enc.diagnosisCodes.includes(code))
      .map(code => ({ code, description: describeIcd(code) })),
    playbook: getPlaybook(enc.denialCode),
  }
}

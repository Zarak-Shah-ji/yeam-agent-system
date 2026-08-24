import { prisma } from '@/lib/db'

/**
 * Structured context for drafting an insurance appeal letter.
 * Fields that are genuinely absent from the data model are left null so the
 * letter can render a clearly-marked placeholder instead of asking the user.
 */
export interface AppealContext {
  claimNumber: string
  serviceDate: string | null // MM/DD/YYYY
  claimStatus: string
  totalCharge: number | null
  denialReason: string | null
  denialCode: string | null
  payer: {
    name: string
    claimsAddress: string | null
  }
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
    cptCode: string
    description: string | null
  } | null
  diagnoses: { code: string; description: string | null }[]
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

  return {
    claimNumber: 'ENC-' + enc.id.slice(0, 8).toUpperCase(),
    serviceDate: fmtDate(enc.encounterDate),
    claimStatus: enc.claimStatus ?? 'denied',
    totalCharge: enc.paidAmount?.toNumber() ?? null,
    denialReason: enc.denialReason,
    denialCode: enc.denialCode,
    payer: {
      name: 'Texas Medicaid',
      // TMHP handles Texas Medicaid claim appeals; the dataset carries no payer
      // record, so use the published appeals address rather than a placeholder.
      claimsAddress: 'Texas Medicaid & Healthcare Partnership\nAttn: Claim Appeals\nPO Box 200645\nAustin, TX 78720-0645',
    },
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
      ? { cptCode: enc.procCode, description: hcpcs?.description ?? null }
      : null,
    diagnoses: (enc.diagnosisCodes ?? []).map(code => ({ code, description: null })),
  }
}

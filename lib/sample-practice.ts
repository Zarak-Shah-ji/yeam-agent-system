/**
 * The sample practice, as data rather than as a separate section of the product.
 *
 * This used to live at /demo over its own tables — seeded Patients, Encounters
 * and Claims that no customer could ever import into. That split meant every
 * real section of the app was empty on day one and the only thing worth looking
 * at was a place the customer's own data could never reach.
 *
 * So the sample arrives the same way a customer's data does: as an ImportBatch,
 * in their own workspace, flagged `isSample`. Worklist, Claims, Analytics and
 * Payers read it through exactly the code path they read a real upload with —
 * there is no second code path to keep in step. The rows are workable: drafting
 * an appeal against one exercises the real mutation.
 *
 * It is deleted whole the first time a real file lands. See dropSamplePractice.
 */

import type { PrismaClient } from '@prisma/client'

export const SAMPLE_FILENAME = 'Sample practice — denials.csv'
export const SAMPLE_CLAIMS_FILENAME = 'Sample practice — A/R snapshot.csv'

/** Days back from today, so filing windows and aging buckets stay live. */
function daysAgo(n: number): Date {
  const d = new Date()
  d.setDate(d.getDate() - n)
  d.setHours(12, 0, 0, 0)
  return d
}

/**
 * Denials chosen to span every remedy class triageRow() can return — appeal,
 * corrected claim, reprocess, not recoverable — and to straddle the filing
 * deadline in both directions. A sample where everything is a winnable appeal
 * teaches the wrong thing about a denial worklist.
 */
const SAMPLE_DENIALS = [
  { claimNumber: 'SP-10041', payer: 'Blue Cross Blue Shield', carc: 'CO-50',  billed: 1840.00, days: 12,  cpt: '99215', icd10: 'M54.16', reason: 'Not medically necessary' },
  { claimNumber: 'SP-10042', payer: 'UnitedHealthcare',       carc: 'CO-197', billed: 3250.00, days: 26,  cpt: '29881', icd10: 'M23.51', reason: 'No prior authorization on file' },
  // Carries the remark code as well as the prose, so the sample exercises the
  // remark-code path in lib/denials/rarc.ts rather than only the wording
  // fallback. A CO-16 with no remark code is the denial billers complain about.
  { claimNumber: 'SP-10043', payer: 'Aetna',                  carc: 'CO-16',  billed:  420.50, days: 8,   cpt: '99214', icd10: 'E11.9',  reason: 'N290 Missing rendering provider NPI' },
  { claimNumber: 'SP-10044', payer: 'Cigna',                  carc: 'CO-97',  billed:  615.00, days: 34,  cpt: '96372', icd10: 'J45.909', reason: 'Bundled into primary procedure' },
  { claimNumber: 'SP-10045', payer: 'Texas Medicaid',         carc: 'CO-29',  billed:  980.00, days: 118, cpt: '99213', icd10: 'I10',    reason: 'Timely filing expired' },
  { claimNumber: 'SP-10046', payer: 'Blue Cross Blue Shield', carc: 'CO-11',  billed: 1120.00, days: 19,  cpt: '20610', icd10: 'M17.11', reason: 'Diagnosis does not support procedure' },
  { claimNumber: 'SP-10047', payer: 'Humana',                 carc: 'CO-22',  billed:  740.25, days: 41,  cpt: '99204', icd10: 'R51.9',  reason: 'Other payer is primary' },
  { claimNumber: 'SP-10048', payer: 'UnitedHealthcare',       carc: 'CO-18',  billed:  310.00, days: 6,   cpt: '85025', icd10: 'D64.9',  reason: 'Duplicate of SP-10012' },
  { claimNumber: 'SP-10049', payer: 'Aetna',                  carc: 'CO-96',  billed: 2475.00, days: 52,  cpt: '64483', icd10: 'M54.17', reason: 'Non-covered under plan' },
  { claimNumber: 'SP-10050', payer: 'Cigna',                  carc: 'CO-45',  billed:  188.00, days: 15,  cpt: '99212', icd10: 'Z00.00', reason: 'Exceeds contracted rate' },
  { claimNumber: 'SP-10051', payer: 'Texas Medicaid',         carc: 'CO-151', billed:  890.00, days: 29,  cpt: '97110', icd10: 'M62.81', reason: 'Frequency exceeds policy' },
  { claimNumber: 'SP-10052', payer: 'Humana',                 carc: 'CO-27',  billed:  530.00, days: 63,  cpt: '99203', icd10: 'J06.9',  reason: 'Coverage terminated before service' },
  { claimNumber: 'SP-10053', payer: 'Blue Cross Blue Shield', carc: 'CO-167', billed: 1395.00, days: 22,  cpt: '70553', icd10: 'G43.909', reason: 'Diagnosis not covered' },
  { claimNumber: 'SP-10054', payer: 'UnitedHealthcare',       carc: 'CO-B7',  billed:  965.00, days: 47,  cpt: '11042', icd10: 'L97.909', reason: 'Provider not eligible on date of service' },
]

/**
 * An A/R snapshot wide enough to be the denominator for a denial rate. Denial
 * rows above are echoed here as DENIED so the two views agree — a worklist that
 * disagrees with the claims table is the first thing anyone notices.
 */
const SAMPLE_CLAIMS = [
  ...SAMPLE_DENIALS.map(d => ({
    claimNumber: d.claimNumber, payer: d.payer, status: 'DENIED' as const,
    billed: d.billed, allowed: null, paid: 0, days: d.days, cpt: d.cpt, icd10: d.icd10, carc: d.carc,
  })),
  { claimNumber: 'SP-10001', payer: 'Blue Cross Blue Shield', status: 'PAID' as const,    billed: 1240.00, allowed:  892.00, paid:  892.00, days: 31, cpt: '99214', icd10: 'E11.9',   carc: null },
  { claimNumber: 'SP-10002', payer: 'UnitedHealthcare',       status: 'PAID' as const,    billed:  480.00, allowed:  344.00, paid:  344.00, days: 28, cpt: '99213', icd10: 'I10',     carc: null },
  { claimNumber: 'SP-10003', payer: 'Aetna',                  status: 'PAID' as const,    billed: 2130.00, allowed: 1518.00, paid: 1518.00, days: 44, cpt: '29881', icd10: 'M23.51',  carc: null },
  { claimNumber: 'SP-10004', payer: 'Cigna',                  status: 'PARTIAL' as const, billed:  915.00, allowed:  610.00, paid:  430.00, days: 37, cpt: '99215', icd10: 'M54.16',  carc: 'CO-45' },
  { claimNumber: 'SP-10005', payer: 'Texas Medicaid',         status: 'PAID' as const,    billed:  305.00, allowed:  198.00, paid:  198.00, days: 22, cpt: '99212', icd10: 'Z00.00',  carc: null },
  { claimNumber: 'SP-10006', payer: 'Humana',                 status: 'PENDING' as const, billed: 1675.00, allowed:    null, paid:     0,   days: 9,  cpt: '64483', icd10: 'M54.17',  carc: null },
  { claimNumber: 'SP-10007', payer: 'Blue Cross Blue Shield', status: 'PAID' as const,    billed:  760.00, allowed:  541.00, paid:  541.00, days: 53, cpt: '20610', icd10: 'M17.11',  carc: null },
  { claimNumber: 'SP-10008', payer: 'UnitedHealthcare',       status: 'PENDING' as const, billed:  442.00, allowed:    null, paid:     0,   days: 5,  cpt: '85025', icd10: 'D64.9',   carc: null },
  { claimNumber: 'SP-10009', payer: 'Aetna',                  status: 'PAID' as const,    billed: 1980.00, allowed: 1386.00, paid: 1386.00, days: 61, cpt: '70553', icd10: 'G43.909', carc: null },
  { claimNumber: 'SP-10010', payer: 'Cigna',                  status: 'PARTIAL' as const, billed:  588.00, allowed:  402.00, paid:  260.00, days: 40, cpt: '97110', icd10: 'M62.81',  carc: 'CO-45' },
  { claimNumber: 'SP-10011', payer: 'Texas Medicaid',         status: 'PAID' as const,    billed:  830.00, allowed:  538.00, paid:  538.00, days: 26, cpt: '99204', icd10: 'R51.9',   carc: null },
  { claimNumber: 'SP-10012', payer: 'UnitedHealthcare',       status: 'PAID' as const,    billed:  310.00, allowed:  221.00, paid:  221.00, days: 17, cpt: '85025', icd10: 'D64.9',   carc: null },
  { claimNumber: 'SP-10013', payer: 'Humana',                 status: 'PAID' as const,    billed: 1105.00, allowed:  773.00, paid:  773.00, days: 35, cpt: '99203', icd10: 'J06.9',   carc: null },
  { claimNumber: 'SP-10014', payer: 'Blue Cross Blue Shield', status: 'PENDING' as const, billed:  695.00, allowed:    null, paid:     0,   days: 3,  cpt: '96372', icd10: 'J45.909', carc: null },
  { claimNumber: 'SP-10015', payer: 'Aetna',                  status: 'PAID' as const,    billed: 1450.00, allowed: 1015.00, paid: 1015.00, days: 48, cpt: '11042', icd10: 'L97.909', carc: null },
  { claimNumber: 'SP-10016', payer: 'Texas Medicaid',         status: 'WRITTEN_OFF' as const, billed: 240.00, allowed: 0, paid: 0,          days: 92, cpt: '99213', icd10: 'I10',     carc: 'CO-29' },
]

/**
 * Give an organization its sample practice.
 *
 * Idempotent on the sample flag, so calling it twice for the same workspace does
 * not double the rows. Returns how many batches it created.
 */
export async function seedSamplePractice(prisma: PrismaClient, orgId: string): Promise<number> {
  const existing = await prisma.importBatch.findFirst({
    where: { orgId, isSample: true },
    select: { id: true },
  })
  if (existing) return 0

  await prisma.importBatch.create({
    data: {
      orgId,
      kind: 'DENIALS',
      isSample: true,
      filename: SAMPLE_FILENAME,
      rowCount: SAMPLE_DENIALS.length,
      droppedColumns: [],
      rows: {
        create: SAMPLE_DENIALS.map(d => ({
          orgId,
          claimNumber: d.claimNumber,
          payer: d.payer,
          carc: d.carc,
          billed: d.billed,
          denialDate: daysAgo(d.days),
          cpt: d.cpt,
          icd10: d.icd10,
          reason: d.reason,
        })),
      },
    },
  })

  await prisma.importBatch.create({
    data: {
      orgId,
      kind: 'CLAIMS',
      isSample: true,
      filename: SAMPLE_CLAIMS_FILENAME,
      rowCount: SAMPLE_CLAIMS.length,
      droppedColumns: [],
      claims: {
        create: SAMPLE_CLAIMS.map(c => ({
          orgId,
          claimNumber: c.claimNumber,
          payer: c.payer,
          status: c.status,
          billed: c.billed,
          allowed: c.allowed,
          paid: c.paid,
          serviceDate: daysAgo(c.days + 14),
          submittedDate: daysAgo(c.days + 7),
          remitDate: c.status === 'PENDING' ? null : daysAgo(c.days),
          cpt: c.cpt,
          icd10: c.icd10,
          carc: c.carc,
        })),
      },
    },
  })

  return 2
}

/**
 * Take the sample practice back out.
 *
 * Called when a real import commits. Rows, claims and any drafts the customer
 * made against a sample row cascade from the schema — which is the point of
 * having shipped the sample as a batch rather than as a separate section.
 */
export async function dropSamplePractice(prisma: PrismaClient, orgId: string): Promise<number> {
  const { count } = await prisma.importBatch.deleteMany({ where: { orgId, isSample: true } })
  return count
}

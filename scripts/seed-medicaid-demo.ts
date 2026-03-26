/**
 * Seed Medicaid demo data without requiring state_TX.csv
 * Creates: providers, patients, encounters, claims agg
 */
import { faker } from '@faker-js/faker'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient({ log: [] })

const HCPCS_TO_ICD10: Record<string, string[]> = {
  '99213': ['Z00.00', 'J06.9', 'I10'],
  '99214': ['I10', 'E11.9', 'Z00.00'],
  '99212': ['J06.9', 'Z00.00', 'R05'],
  '99215': ['I10', 'E11.65', 'J45.20'],
  '90837': ['F32.9', 'F41.9', 'F41.1'],
  '97110': ['M54.5', 'M79.3', 'S93.401A'],
  '97530': ['M54.5', 'M62.81'],
  '96372': ['E11.9', 'I10', 'M06.9'],
  '99281': ['R10.9', 'J06.9'],
  '99284': ['I21.9', 'R55', 'K92.1'],
  '92507': ['F80.9', 'F80.1'],
  '94640': ['J45.20', 'J44.1'],
  '99203': ['Z00.00', 'R10.9'],
  '99204': ['E11.9', 'I10', 'M54.5'],
  '36415': ['Z13.6', 'E11.9'],
  '71046': ['J18.9', 'J44.1'],
  '93000': ['I10', 'I25.10'],
  '85025': ['D50.9', 'E11.9'],
}
const PROC_CODES = Object.keys(HCPCS_TO_ICD10)
const CLAIM_STATUSES = ['clean', 'paid', 'denied', 'flagged', 'resubmitted'] as const
const CITIES = ['Houston', 'Dallas', 'San Antonio', 'Austin', 'Fort Worth', 'El Paso', 'Arlington', 'Corpus Christi']
const MONTHS = ['2023-01', '2023-04', '2023-07', '2023-10', '2024-01', '2024-04', '2024-07', '2024-10', '2025-01']

async function main() {
  console.log('🌱 Seeding Medicaid demo data...')

  // ── Providers (50) ───────────────────────────────────────────────────────────
  const providerNpis: string[] = []
  for (let i = 0; i < 50; i++) {
    const npi = String(1000000000 + i).padStart(10, '0')
    providerNpis.push(npi)
    await prisma.medicaidProvider.upsert({
      where: { npi },
      update: {},
      create: {
        npi,
        firstName: faker.person.firstName(),
        lastName: faker.person.lastName(),
        credentials: faker.helpers.arrayElement(['MD', 'DO', 'NP', 'PA']),
        orgName: faker.helpers.arrayElement(['Community Health Clinic', 'Texas Medical Center', 'Lone Star Health', 'Gulf Coast Medical', null]),
        addrLine1: faker.location.streetAddress(),
        city: faker.helpers.arrayElement(CITIES),
        state: 'TX',
        zip: faker.location.zipCode('#####'),
        phone: faker.phone.number(),
      },
    })
  }
  console.log('✓ Providers:', providerNpis.length)

  // ── MedicaidClaimsAgg (200 rows) ─────────────────────────────────────────────
  for (let i = 0; i < 200; i++) {
    const billingNpi = faker.helpers.arrayElement(providerNpis)
    const procCode = faker.helpers.arrayElement(PROC_CODES)
    const yearMonth = faker.helpers.arrayElement(MONTHS)
    const numClaims = faker.number.int({ min: 10, max: 300 })
    await prisma.medicaidClaimsAgg.create({
      data: {
        billingNpi,
        servicingNpi: Math.random() > 0.5 ? faker.helpers.arrayElement(providerNpis) : null,
        procCode,
        yearMonth,
        numBeneficiaries: faker.number.int({ min: 5, max: numClaims }),
        numClaims,
        paidAmount: faker.number.float({ min: numClaims * 50, max: numClaims * 300, fractionDigits: 2 }),
      },
    })
  }
  console.log('✓ Claims aggregates: 200')

  // ── Patients (500) ───────────────────────────────────────────────────────────
  const patientIds: string[] = []
  for (let i = 0; i < 500; i++) {
    const providerNpi = faker.helpers.arrayElement(providerNpis)
    const patient = await prisma.medicaidPatient.create({
      data: {
        mrn: `MRN-TX-${String(i + 1).padStart(6, '0')}`,
        firstName: faker.person.firstName(),
        lastName: faker.person.lastName(),
        dateOfBirth: faker.date.birthdate({ min: 1, max: 85, mode: 'age' }),
        gender: faker.helpers.arrayElement(['M', 'F']),
        phone: faker.phone.number(),
        email: Math.random() > 0.4 ? faker.internet.email() : null,
        addrLine1: faker.location.streetAddress(),
        city: faker.helpers.arrayElement(CITIES),
        state: 'TX',
        zip: faker.location.zipCode('#####'),
        insuranceType: 'Medicaid',
        insuranceId: `TX-MCD-${faker.string.alphanumeric(8).toUpperCase()}`,
        insuranceStatus: 'active',
        primaryProviderNpi: providerNpi,
      },
    })
    patientIds.push(patient.id)
  }
  console.log('✓ Patients:', patientIds.length)

  // ── Encounters (1500) ────────────────────────────────────────────────────────
  let encCount = 0
  for (const patientId of patientIds) {
    const numEnc = faker.number.int({ min: 1, max: 5 })
    for (let j = 0; j < numEnc; j++) {
      const providerNpi = faker.helpers.arrayElement(providerNpis)
      const procCode = faker.helpers.arrayElement(PROC_CODES)
      const diagCodes = faker.helpers.arrayElements(HCPCS_TO_ICD10[procCode] ?? ['Z00.00'], { min: 1, max: 3 })
      await prisma.medicaidEncounter.create({
        data: {
          patientId,
          providerNpi,
          billingNpi: Math.random() > 0.3 ? providerNpi : faker.helpers.arrayElement(providerNpis),
          encounterDate: faker.date.between({ from: '2023-01-01', to: '2025-03-01' }),
          procCode,
          diagnosisCodes: diagCodes,
          status: 'completed',
          claimStatus: faker.helpers.arrayElement(CLAIM_STATUSES),
          paidAmount: faker.number.float({ min: 50, max: 800, fractionDigits: 2 }),
        },
      })
      encCount++
    }
  }
  console.log('✓ Encounters:', encCount)

  console.log('\n✅ Medicaid demo data seeded!')
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })

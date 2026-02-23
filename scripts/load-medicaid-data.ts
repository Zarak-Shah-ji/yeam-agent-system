/**
 * Phase 2: Medicaid Dataset Loader
 * Streams state_TX.csv (11M rows) and populates:
 *   medicaid_providers, medicaid_claims_agg, hcpcs_codes,
 *   medicaid_patients (synthetic), medicaid_encounters (synthetic)
 *
 * Usage: pnpm db:seed-medicaid
 */

import fs from 'fs'
import path from 'path'
import { parse } from 'csv-parse'
import { faker } from '@faker-js/faker'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient({ log: [] })

const CSV_PATH = path.join(process.cwd(), 'state_TX.csv')
const CLAIMS_BATCH = 5000
const MAX_PROVIDERS_FOR_PATIENTS = 500
const PATIENTS_PER_PROVIDER_MIN = 5
const PATIENTS_PER_PROVIDER_MAX = 20

// ─── HCPCS → ICD-10 mapping (top 60 common codes) ───────────────────────────

const HCPCS_TO_ICD10: Record<string, string[]> = {
  '99213': ['Z00.00', 'J06.9', 'I10'],
  '99214': ['I10', 'E11.9', 'Z00.00'],
  '99212': ['J06.9', 'Z00.00', 'R05'],
  '99215': ['I10', 'E11.65', 'J45.20'],
  '99211': ['Z00.00', 'J06.9'],
  '99203': ['Z00.00', 'R10.9'],
  '99204': ['E11.9', 'I10', 'M54.5'],
  '99205': ['I10', 'E11.65', 'F32.9'],
  '99202': ['Z00.00', 'J06.9'],
  '90837': ['F32.9', 'F41.9', 'F41.1'],
  '90834': ['F32.9', 'F41.9', 'F33.0'],
  '90832': ['F32.9', 'F41.1'],
  '90847': ['F32.9', 'Z63.0'],
  '90853': ['F32.9', 'F41.9'],
  '96150': ['F32.9', 'F41.9'],
  '96152': ['F32.9', 'F41.9'],
  '97110': ['M54.5', 'M79.3', 'S93.401A'],
  '97530': ['M54.5', 'M62.81', 'S93.401A'],
  '97140': ['M54.5', 'M25.511', 'M79.3'],
  '97035': ['M54.5', 'M79.3'],
  '92507': ['F80.9', 'F80.1', 'H91.90'],
  '92526': ['F80.9', 'R13.10'],
  '94640': ['J45.20', 'J44.1', 'J45.50'],
  '94664': ['J45.20', 'J44.1'],
  '94760': ['J96.00', 'J45.20'],
  '94761': ['J96.00', 'J44.1'],
  '96372': ['E11.9', 'I10', 'M06.9'],
  '96402': ['C50.911', 'C34.10'],
  '96413': ['C50.911', 'C34.10'],
  '96415': ['C50.911', 'C34.10'],
  '99281': ['R10.9', 'J06.9', 'S00.01XA'],
  '99282': ['R10.9', 'I10', 'J06.9'],
  '99283': ['R10.9', 'I10', 'M54.5'],
  '99284': ['I21.9', 'R55', 'K92.1'],
  '99285': ['I21.9', 'I63.9', 'S06.0X0A'],
  '90460': ['Z23', 'Z00.129'],
  '90461': ['Z23'],
  '90471': ['Z23'],
  '90472': ['Z23'],
  '90716': ['Z23'],
  '90734': ['Z23'],
  '99391': ['Z00.110', 'Z00.111'],
  '99392': ['Z00.121'],
  '99393': ['Z00.129'],
  '99394': ['Z00.3'],
  '99395': ['Z00.00'],
  '99396': ['Z00.00'],
  '99397': ['Z00.00'],
  'G0101': ['Z12.31', 'Z01.419'],
  'G0121': ['Z12.11', 'Z12.12'],
  'G0180': ['Z71.89', 'E11.9'],
  'G0181': ['Z71.89', 'J44.1'],
  'G0270': ['E66.9', 'Z71.3'],
  'G0271': ['E66.9', 'Z71.3'],
  'T1002': ['F32.9', 'F20.9'],
  'T1016': ['F32.9', 'F20.9'],
  'T1017': ['F32.9', 'F41.9'],
  'H0001': ['F10.10', 'F11.10'],
  'H0004': ['F10.10', 'F11.10'],
  'H0020': ['F10.20', 'F11.20'],
}

function getIcd10(procCode: string): string[] {
  return HCPCS_TO_ICD10[procCode] ?? ['Z00.00']
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface ProviderRow {
  npi: string
  orgName: string | null
  firstName: string | null
  middleName: string | null
  lastName: string | null
  credentials: string | null
  orgNameOther: string | null
  addrLine1: string | null
  addrLine2: string | null
  city: string | null
  state: string | null
  zip: string | null
  phone: string | null
}

interface HcpcsAgg {
  totalPaid: number
  totalClaims: number
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🚀 Starting Medicaid data load...')
  console.log(`📂 CSV: ${CSV_PATH}`)

  // Maps built during streaming
  const providers = new Map<string, ProviderRow>()
  const hcpcsAgg = new Map<string, HcpcsAgg>()
  // track claim count per billing NPI for selecting top providers
  const billingClaimCount = new Map<string, number>()

  let claimsBatch: Array<{
    billingNpi: string
    servicingNpi: string | null
    procCode: string
    yearMonth: string
    numBeneficiaries: number | null
    numClaims: number | null
    paidAmount: number | null
    aoFirstName: string | null
    aoMiddleName: string | null
    aoLastName: string | null
  }> = []

  let totalRows = 0
  let totalClaimsInserted = 0

  // ── Phase 2a: Pass 1 — collect providers + HCPCS stats (no DB writes) ──

  console.log('\n📡 Pass 1: Collecting providers and HCPCS stats...')

  const streamPass = (onRecord: (record: Record<string, string>) => void) =>
    new Promise<void>((resolve, reject) => {
      const parser = parse({ columns: true, skip_empty_lines: true, trim: true, relax_column_count: true })
      parser.on('readable', () => {
        let record
        while ((record = parser.read()) !== null) onRecord(record)
      })
      parser.on('end', resolve)
      parser.on('error', reject)
      fs.createReadStream(CSV_PATH).pipe(parser)
    })

  await streamPass(record => {
    totalRows++
    const billingNpi: string = record.billing_npi?.trim() ?? ''
    const servicingNpi: string = record.servicing_npi?.trim() ?? ''
    if (!billingNpi) return

    if (!providers.has(billingNpi)) {
      providers.set(billingNpi, {
        npi: billingNpi,
        orgName: record.billing_name?.trim() || null,
        firstName: record.billing_fname?.trim() || null,
        middleName: record.billing_mname?.trim() || null,
        lastName: record.billing_lname?.trim() || null,
        credentials: record.billing_cred?.trim() || null,
        orgNameOther: record.billing_othr_name?.trim() || null,
        addrLine1: record.billing_addr1?.trim() || null,
        addrLine2: record.billing_addr2?.trim() || null,
        city: record.billing_city?.trim() || null,
        state: record.billing_state?.trim() || null,
        zip: record.billing_zip?.trim() || null,
        phone: record.billing_phone?.trim() || null,
      })
    }
    if (servicingNpi && !providers.has(servicingNpi)) {
      providers.set(servicingNpi, {
        npi: servicingNpi,
        orgName: record.servicing_name?.trim() || null,
        firstName: record.servicing_fname?.trim() || null,
        middleName: record.servicing_mname?.trim() || null,
        lastName: record.servicing_lname?.trim() || null,
        credentials: record.servicing_cred?.trim() || null,
        orgNameOther: record.servicing_othr_name?.trim() || null,
        addrLine1: record.servicing_addr1?.trim() || null,
        addrLine2: record.servicing_addr2?.trim() || null,
        city: record.servicing_city?.trim() || null,
        state: record.servicing_state?.trim() || null,
        zip: record.servicing_zip?.trim() || null,
        phone: record.servicing_phone?.trim() || null,
      })
    }

    const procCode: string = record.proc_cd?.trim() ?? ''
    const paidAmt = parseFloat(record.pd_amt) || 0
    const numClaims = parseInt(record.num_claims) || 0
    if (procCode) {
      const existing = hcpcsAgg.get(procCode) ?? { totalPaid: 0, totalClaims: 0 }
      existing.totalPaid += paidAmt
      existing.totalClaims += numClaims
      hcpcsAgg.set(procCode, existing)
    }
    billingClaimCount.set(billingNpi, (billingClaimCount.get(billingNpi) ?? 0) + numClaims)
  })

  console.log(`✅ Pass 1 done — ${totalRows.toLocaleString()} rows`)
  console.log(`   Unique providers: ${providers.size.toLocaleString()}`)
  console.log(`   Unique HCPCS codes: ${hcpcsAgg.size.toLocaleString()}`)

  // ── Phase 2b: Bulk-insert providers ──

  console.log('\n👩‍⚕️ Inserting providers...')
  const providerList = Array.from(providers.values())
  const PROVIDER_BATCH = 2000
  for (let i = 0; i < providerList.length; i += PROVIDER_BATCH) {
    await prisma.medicaidProvider.createMany({
      data: providerList.slice(i, i + PROVIDER_BATCH),
      skipDuplicates: true,
    })
    process.stdout.write(`\r  inserted ${Math.min(i + PROVIDER_BATCH, providerList.length).toLocaleString()} / ${providerList.length.toLocaleString()}`)
  }
  console.log(`\n✅ Providers done`)

  // ── Phase 2b-2: Pass 2 — stream claims now that providers exist ──

  console.log('\n📡 Pass 2: Streaming claims into DB...')

  const knownNpis = new Set(providers.keys())

  const flushBatch = async () => {
    if (claimsBatch.length === 0) return
    const batch = claimsBatch.splice(0)
    await prisma.medicaidClaimsAgg.createMany({ data: batch, skipDuplicates: true })
    totalClaimsInserted += batch.length
    if (totalClaimsInserted % 100000 === 0) {
      process.stdout.write(`\r  claims inserted: ${totalClaimsInserted.toLocaleString()}  `)
    }
  }

  await new Promise<void>((resolve, reject) => {
    const parser = parse({ columns: true, skip_empty_lines: true, trim: true, relax_column_count: true })
    let pending = Promise.resolve()

    parser.on('readable', () => {
      parser.pause()
      pending = pending.then(async () => {
        let record
        while ((record = parser.read()) !== null) {
          const billingNpi: string = record.billing_npi?.trim() ?? ''
          const servicingNpi: string = record.servicing_npi?.trim() ?? ''
          if (!billingNpi || !knownNpis.has(billingNpi)) continue

          const procCode: string = record.proc_cd?.trim() ?? ''
          const paidAmt = parseFloat(record.pd_amt) || 0
          const numClaims = parseInt(record.num_claims) || 0

          claimsBatch.push({
            billingNpi,
            servicingNpi: (servicingNpi && knownNpis.has(servicingNpi)) ? servicingNpi : null,
            procCode,
            yearMonth: record.month?.trim() ?? '',
            numBeneficiaries: parseInt(record.num_benes) || null,
            numClaims: numClaims || null,
            paidAmount: paidAmt || null,
            aoFirstName: record.aofname?.trim() || null,
            aoMiddleName: record.aomname?.trim() || null,
            aoLastName: record.aolname?.trim() || null,
          })

          if (claimsBatch.length >= CLAIMS_BATCH) await flushBatch()
        }
        parser.resume()
      }).catch(reject)
    })

    parser.on('end', () => {
      pending.then(() => flushBatch()).then(resolve).catch(reject)
    })
    parser.on('error', reject)
    fs.createReadStream(CSV_PATH).pipe(parser)
  })

  console.log(`\n✅ ${totalClaimsInserted.toLocaleString()} claims inserted`)

  // ── Phase 2c: Bulk-insert HCPCS codes ──

  console.log('\n💊 Inserting HCPCS codes...')
  const hcpcsList = Array.from(hcpcsAgg.entries()).map(([code, agg]) => ({
    code,
    description: null as string | null,
    category: null as string | null,
    avgCostTx: agg.totalClaims > 0
      ? Math.round((agg.totalPaid / agg.totalClaims) * 100) / 100
      : null,
  }))
  await prisma.hcpcsCode.createMany({ data: hcpcsList, skipDuplicates: true })
  console.log(`✅ ${hcpcsList.length.toLocaleString()} HCPCS codes inserted`)

  // ── Phase 2d: Generate synthetic patients ──

  console.log('\n🧑‍🤝‍🧑 Generating synthetic patients...')

  // Pick top N billing providers by claim count
  const topProviders = Array.from(billingClaimCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_PROVIDERS_FOR_PATIENTS)
    .map(([npi]) => npi)

  // Build a quick city/zip lookup from provider data
  const providerCityZip = new Map<string, { city: string; zip: string }>()
  for (const p of providerList) {
    if (p.npi && p.city && p.zip) {
      providerCityZip.set(p.npi, { city: p.city, zip: p.zip })
    }
  }

  const GENDERS = ['male', 'female', 'other']

  let mrnCounter = 1
  let totalPatientsInserted = 0
  const patientIdsByProvider = new Map<string, string[]>()

  const PATIENT_BATCH_SIZE = 1000
  let patientBatch: Array<{
    mrn: string
    firstName: string
    lastName: string
    dateOfBirth: Date
    gender: string
    phone: string | null
    email: string | null
    addrLine1: string | null
    city: string | null
    state: string
    zip: string | null
    insuranceType: string
    insuranceId: string
    insuranceStatus: string
    primaryProviderNpi: string
  }> = []

  for (const npi of topProviders) {
    const count = faker.number.int({ min: PATIENTS_PER_PROVIDER_MIN, max: PATIENTS_PER_PROVIDER_MAX })
    const location = providerCityZip.get(npi)
    const ids: string[] = []

    for (let i = 0; i < count; i++) {
      const gender = GENDERS[faker.number.int({ min: 0, max: 2 })]
      const sex = gender === 'female' ? 'female' : 'male'
      const mrn = `MRN-TX-${String(mrnCounter++).padStart(6, '0')}`
      const id = mrn // use mrn as stable reference; Prisma will generate cuid

      ids.push(mrn) // we'll look up real IDs after insert

      patientBatch.push({
        mrn,
        firstName: faker.person.firstName(sex as 'male' | 'female'),
        lastName: faker.person.lastName(),
        dateOfBirth: faker.date.birthdate({ min: 0, max: 95, mode: 'age' }),
        gender,
        phone: faker.phone.number({ style: 'national' }),
        email: faker.internet.email(),
        addrLine1: faker.location.streetAddress(),
        city: location?.city ?? faker.location.city(),
        state: 'TX',
        zip: location?.zip?.slice(0, 5) ?? faker.location.zipCode('#####'),
        insuranceType: 'Medicaid',
        insuranceId: `TX-MCD-${faker.string.numeric(10)}`,
        insuranceStatus: 'active',
        primaryProviderNpi: npi,
      })

      if (patientBatch.length >= PATIENT_BATCH_SIZE) {
        await prisma.medicaidPatient.createMany({ data: patientBatch, skipDuplicates: true })
        totalPatientsInserted += patientBatch.length
        patientBatch = []
        process.stdout.write(`\r  patients created: ${totalPatientsInserted.toLocaleString()}`)
      }
    }
    patientIdsByProvider.set(npi, ids)
  }
  if (patientBatch.length > 0) {
    await prisma.medicaidPatient.createMany({ data: patientBatch, skipDuplicates: true })
    totalPatientsInserted += patientBatch.length
  }
  console.log(`\n✅ ${totalPatientsInserted.toLocaleString()} synthetic patients created`)

  // ── Phase 2e: Generate synthetic encounters ──

  console.log('\n🏥 Generating synthetic encounters...')

  // Fetch all patient IDs grouped by provider NPI
  const allPatients = await prisma.medicaidPatient.findMany({
    where: { primaryProviderNpi: { in: topProviders } },
    select: { id: true, primaryProviderNpi: true },
  })
  const patientsByProvider = new Map<string, string[]>()
  for (const p of allPatients) {
    if (!p.primaryProviderNpi) continue
    const list = patientsByProvider.get(p.primaryProviderNpi) ?? []
    list.push(p.id)
    patientsByProvider.set(p.primaryProviderNpi, list)
  }

  // Fetch top proc codes per billing NPI from medicaid_claims_agg
  // We'll get the top 10 proc codes for each provider in one query
  const topProcsByProvider = new Map<string, string[]>()
  const procAggRows = await prisma.medicaidClaimsAgg.groupBy({
    by: ['billingNpi', 'procCode'],
    _sum: { numClaims: true },
    orderBy: { _sum: { numClaims: 'desc' } },
    where: { billingNpi: { in: topProviders } },
    take: topProviders.length * 10,
  })
  for (const row of procAggRows) {
    const list = topProcsByProvider.get(row.billingNpi) ?? []
    if (list.length < 10) list.push(row.procCode)
    topProcsByProvider.set(row.billingNpi, list)
  }

  // Date range: 2018-01 to 2024-12
  const START_DATE = new Date('2018-01-01')
  const END_DATE = new Date('2024-12-31')

  const CLAIM_STATUSES = [
    ...Array(78).fill('clean'),
    ...Array(8).fill('denied'),
    ...Array(5).fill('flagged'),
    ...Array(5).fill('paid'),
    ...Array(4).fill('resubmitted'),
  ]

  let totalEncountersInserted = 0
  let encounterBatch: Array<{
    patientId: string
    providerNpi: string
    billingNpi: string | null
    encounterDate: Date
    procCode: string
    diagnosisCodes: string[]
    status: string
    claimStatus: string
    paidAmount: number | null
    notes: string | null
  }> = []

  const ENCOUNTER_BATCH_SIZE = 2000

  const flushEncounters = async () => {
    if (encounterBatch.length === 0) return
    const batch = encounterBatch.splice(0)
    await prisma.medicaidEncounter.createMany({ data: batch, skipDuplicates: true })
    totalEncountersInserted += batch.length
    process.stdout.write(`\r  encounters created: ${totalEncountersInserted.toLocaleString()}`)
  }

  for (const npi of topProviders) {
    const patientIds = patientsByProvider.get(npi) ?? []
    const procCodes = topProcsByProvider.get(npi) ?? ['99213']

    for (const patientId of patientIds) {
      const numEncounters = faker.number.int({ min: 3, max: 10 })

      for (let e = 0; e < numEncounters; e++) {
        const procCode = procCodes[faker.number.int({ min: 0, max: procCodes.length - 1 })]
        const claimStatus = CLAIM_STATUSES[faker.number.int({ min: 0, max: CLAIM_STATUSES.length - 1 })]
        const encounterDate = faker.date.between({ from: START_DATE, to: END_DATE })

        encounterBatch.push({
          patientId,
          providerNpi: npi,
          billingNpi: npi,
          encounterDate,
          procCode,
          diagnosisCodes: getIcd10(procCode),
          status: 'completed',
          claimStatus,
          paidAmount: claimStatus === 'paid' || claimStatus === 'clean'
            ? faker.number.float({ min: 20, max: 800, fractionDigits: 2 })
            : null,
          notes: null,
        })

        if (encounterBatch.length >= ENCOUNTER_BATCH_SIZE) {
          await flushEncounters()
        }
      }
    }
  }
  await flushEncounters()
  console.log(`\n✅ ${totalEncountersInserted.toLocaleString()} synthetic encounters created`)

  // ── Summary ──

  console.log('\n🎉 Load complete!\n')
  const [provCount, claimCount, patCount, encCount, hcpcsCount] = await Promise.all([
    prisma.medicaidProvider.count(),
    prisma.medicaidClaimsAgg.count(),
    prisma.medicaidPatient.count(),
    prisma.medicaidEncounter.count(),
    prisma.hcpcsCode.count(),
  ])
  console.log(`  medicaid_providers:    ${provCount.toLocaleString()}`)
  console.log(`  medicaid_claims_agg:   ${claimCount.toLocaleString()}`)
  console.log(`  medicaid_patients:     ${patCount.toLocaleString()}`)
  console.log(`  medicaid_encounters:   ${encCount.toLocaleString()}`)
  console.log(`  hcpcs_codes:           ${hcpcsCount.toLocaleString()}`)

  await prisma.$disconnect()
}

main().catch(err => {
  console.error('❌ Fatal error:', err)
  process.exit(1)
})

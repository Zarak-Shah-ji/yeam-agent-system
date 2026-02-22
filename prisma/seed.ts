import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

const today = new Date()
const d = (daysOffset: number, hour = 9, minute = 0) => {
  const date = new Date(today)
  date.setDate(date.getDate() + daysOffset)
  date.setHours(hour, minute, 0, 0)
  return date
}

async function main() {
  console.log('🌱 Seeding Molina Family Health Clinic demo data...')

  // ─── Users ───────────────────────────────────────────────────────────────
  const passwordHash = await bcrypt.hash('demo1234', 12)

  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@molinaclinic.demo' },
    update: {},
    create: {
      email: 'admin@molinaclinic.demo',
      name: 'Admin User',
      passwordHash,
      role: 'ADMIN',
    },
  })

  const providerUser = await prisma.user.upsert({
    where: { email: 'provider@molinaclinic.demo' },
    update: {},
    create: {
      email: 'provider@molinaclinic.demo',
      name: 'Dr. Sarah Chen',
      passwordHash,
      role: 'PROVIDER',
    },
  })

  await prisma.user.upsert({
    where: { email: 'frontdesk@molinaclinic.demo' },
    update: {},
    create: {
      email: 'frontdesk@molinaclinic.demo',
      name: 'Maria Lopez',
      passwordHash,
      role: 'FRONT_DESK',
    },
  })

  await prisma.user.upsert({
    where: { email: 'billing@molinaclinic.demo' },
    update: {},
    create: {
      email: 'billing@molinaclinic.demo',
      name: 'James Okafor',
      passwordHash,
      role: 'BILLING',
    },
  })

  console.log('✓ Users created')

  // ─── Providers ───────────────────────────────────────────────────────────
  const providerChen = await prisma.provider.upsert({
    where: { npi: '1234567890' },
    update: {},
    create: {
      npi: '1234567890',
      firstName: 'Sarah',
      lastName: 'Chen',
      credential: 'MD',
      specialty: 'Family Medicine',
      email: 'provider@molinaclinic.demo',
      phone: '(555) 201-0001',
    },
  })

  const providerPatel = await prisma.provider.upsert({
    where: { npi: '1234567891' },
    update: {},
    create: {
      npi: '1234567891',
      firstName: 'Raj',
      lastName: 'Patel',
      credential: 'MD',
      specialty: 'Pediatrics',
      email: 'rpatel@molinaclinic.demo',
      phone: '(555) 201-0002',
    },
  })

  const providerWilliams = await prisma.provider.upsert({
    where: { npi: '1234567892' },
    update: {},
    create: {
      npi: '1234567892',
      firstName: 'Tamara',
      lastName: 'Williams',
      credential: 'NP',
      specialty: 'Family Medicine',
      email: 'twilliams@molinaclinic.demo',
      phone: '(555) 201-0003',
    },
  })

  console.log('✓ Providers created')

  // ─── Payers ──────────────────────────────────────────────────────────────
  const payerAetna = await prisma.payer.upsert({
    where: { payerId: 'AETNA001' },
    update: {},
    create: {
      name: 'Aetna',
      payerId: 'AETNA001',
      planType: 'PPO',
      phone: '(800) 872-3862',
      claimsAddress: 'P.O. Box 981106, El Paso, TX 79998',
      electronicPayerId: '60054',
    },
  })

  const payerBCBS = await prisma.payer.upsert({
    where: { payerId: 'BCBS001' },
    update: {},
    create: {
      name: 'Blue Cross Blue Shield',
      payerId: 'BCBS001',
      planType: 'PPO',
      phone: '(800) 521-2227',
      claimsAddress: 'P.O. Box 660044, Dallas, TX 75266',
      electronicPayerId: '00790',
    },
  })

  const payerMedicaid = await prisma.payer.upsert({
    where: { payerId: 'MEDICAID001' },
    update: {},
    create: {
      name: 'California Medicaid (Medi-Cal)',
      payerId: 'MEDICAID001',
      planType: 'MEDICAID',
      phone: '(800) 541-5555',
      claimsAddress: 'P.O. Box 997417, Sacramento, CA 95899',
      electronicPayerId: 'CAMCD',
    },
  })

  const payerMedicare = await prisma.payer.upsert({
    where: { payerId: 'MEDICARE001' },
    update: {},
    create: {
      name: 'Medicare Part B',
      payerId: 'MEDICARE001',
      planType: 'MEDICARE',
      phone: '(800) 633-4227',
      claimsAddress: 'P.O. Box 6800, Fargo, ND 58108',
      electronicPayerId: 'NOVJZ',
    },
  })

  const payerCigna = await prisma.payer.upsert({
    where: { payerId: 'CIGNA001' },
    update: {},
    create: {
      name: 'Cigna',
      payerId: 'CIGNA001',
      planType: 'HMO',
      phone: '(800) 244-6224',
      claimsAddress: 'P.O. Box 188061, Chattanooga, TN 37422',
      electronicPayerId: '62308',
    },
  })

  console.log('✓ Payers created')

  // ─── Patients ────────────────────────────────────────────────────────────
  const patientsData = [
    { mrn: 'MRN-001', firstName: 'Eleanor', lastName: 'Vance', dob: '1955-03-12', gender: 'F', phone: '(555) 301-0001', email: 'evance@email.demo', ssnLast4: '4231', payer: payerMedicare, memberId: 'MED-001-ELEANOR' },
    { mrn: 'MRN-002', firstName: 'Marcus', lastName: 'Webb', dob: '1978-07-22', gender: 'M', phone: '(555) 301-0002', email: 'mwebb@email.demo', ssnLast4: '8847', payer: payerBCBS, memberId: 'BCBS-002-MARCUS' },
    { mrn: 'MRN-003', firstName: 'Sofia', lastName: 'Reyes', dob: '1992-11-05', gender: 'F', phone: '(555) 301-0003', email: 'sreyes@email.demo', ssnLast4: '2190', payer: payerMedicaid, memberId: 'CAL-003-SOFIA' },
    { mrn: 'MRN-004', firstName: 'David', lastName: 'Kim', dob: '1965-04-18', gender: 'M', phone: '(555) 301-0004', email: 'dkim@email.demo', ssnLast4: '5523', payer: payerAetna, memberId: 'AET-004-DAVID' },
    { mrn: 'MRN-005', firstName: 'Priya', lastName: 'Sharma', dob: '1988-09-30', gender: 'F', phone: '(555) 301-0005', email: 'psharma@email.demo', ssnLast4: '7712', payer: payerCigna, memberId: 'CIG-005-PRIYA' },
    { mrn: 'MRN-006', firstName: 'James', lastName: 'Thompson', dob: '1945-12-01', gender: 'M', phone: '(555) 301-0006', email: null, ssnLast4: '3344', payer: payerMedicare, memberId: 'MED-006-JAMES' },
    { mrn: 'MRN-007', firstName: 'Amara', lastName: 'Osei', dob: '2010-06-15', gender: 'F', phone: '(555) 301-0007', email: 'amara.parent@email.demo', ssnLast4: '9901', payer: payerMedicaid, memberId: 'CAL-007-AMARA' },
    { mrn: 'MRN-008', firstName: 'Robert', lastName: 'Delgado', dob: '1971-02-28', gender: 'M', phone: '(555) 301-0008', email: 'rdelgado@email.demo', ssnLast4: '6678', payer: payerBCBS, memberId: 'BCBS-008-ROBERT' },
    { mrn: 'MRN-009', firstName: 'Chen', lastName: 'Liu', dob: '1983-08-14', gender: 'M', phone: '(555) 301-0009', email: 'cliu@email.demo', ssnLast4: '4412', payer: payerAetna, memberId: 'AET-009-CHEN' },
    { mrn: 'MRN-010', firstName: 'Fatima', lastName: 'Al-Hassan', dob: '1995-01-20', gender: 'F', phone: '(555) 301-0010', email: 'falhassan@email.demo', ssnLast4: '8821', payer: payerCigna, memberId: 'CIG-010-FATIMA' },
    { mrn: 'MRN-011', firstName: 'William', lastName: 'Park', dob: '1958-05-07', gender: 'M', phone: '(555) 301-0011', email: 'wpark@email.demo', ssnLast4: '1156', payer: payerMedicare, memberId: 'MED-011-WILLIAM' },
    { mrn: 'MRN-012', firstName: 'Nadia', lastName: 'Kowalski', dob: '2015-10-25', gender: 'F', phone: '(555) 301-0012', email: null, ssnLast4: '3398', payer: payerMedicaid, memberId: 'CAL-012-NADIA' },
    { mrn: 'MRN-013', firstName: 'Carlos', lastName: 'Fuentes', dob: '1980-03-11', gender: 'M', phone: '(555) 301-0013', email: 'cfuentes@email.demo', ssnLast4: '7743', payer: payerBCBS, memberId: 'BCBS-013-CARLOS' },
    { mrn: 'MRN-014', firstName: 'Linda', lastName: 'Nguyen', dob: '1952-07-30', gender: 'F', phone: '(555) 301-0014', email: 'lnguyen@email.demo', ssnLast4: '2267', payer: payerMedicare, memberId: 'MED-014-LINDA' },
    { mrn: 'MRN-015', firstName: 'Tyler', lastName: 'Brooks', dob: '1999-12-03', gender: 'M', phone: '(555) 301-0015', email: 'tbrooks@email.demo', ssnLast4: '5590', payer: payerAetna, memberId: 'AET-015-TYLER' },
    { mrn: 'MRN-016', firstName: 'Grace', lastName: 'Okonkwo', dob: '1967-04-22', gender: 'F', phone: '(555) 301-0016', email: 'gokonkwo@email.demo', ssnLast4: '8834', payer: payerCigna, memberId: 'CIG-016-GRACE' },
    { mrn: 'MRN-017', firstName: 'Michael', lastName: 'Rosenberg', dob: '1976-09-08', gender: 'M', phone: '(555) 301-0017', email: 'mrosenberg@email.demo', ssnLast4: '1179', payer: payerBCBS, memberId: 'BCBS-017-MICHAEL' },
    { mrn: 'MRN-018', firstName: 'Aisha', lastName: 'Jackson', dob: '2018-02-14', gender: 'F', phone: '(555) 301-0018', email: null, ssnLast4: '6645', payer: payerMedicaid, memberId: 'CAL-018-AISHA' },
    { mrn: 'MRN-019', firstName: 'Diego', lastName: 'Martinez', dob: '1990-06-19', gender: 'M', phone: '(555) 301-0019', email: 'dmartinez@email.demo', ssnLast4: '3312', payer: payerAetna, memberId: 'AET-019-DIEGO' },
    { mrn: 'MRN-020', firstName: 'Helen', lastName: 'Zhang', dob: '1962-11-27', gender: 'F', phone: '(555) 301-0020', email: 'hzhang@email.demo', ssnLast4: '9980', payer: payerMedicaid, memberId: 'CAL-020-HELEN' },
  ]

  const patients: Record<string, { id: string }> = {}

  for (const p of patientsData) {
    const patient = await prisma.patient.upsert({
      where: { mrn: p.mrn },
      update: {},
      create: {
        mrn: p.mrn,
        firstName: p.firstName,
        lastName: p.lastName,
        dateOfBirth: new Date(p.dob),
        gender: p.gender,
        phone: p.phone,
        email: p.email ?? undefined,
        ssnLast4: p.ssnLast4,
        address: `${Math.floor(Math.random() * 9000) + 1000} Main St`,
        city: 'San Diego',
        state: 'CA',
        zip: '92101',
        coverages: {
          create: {
            payerId: p.payer.id,
            memberId: p.memberId,
            groupNumber: `GRP-${p.mrn}`,
            planName: p.payer.name,
            effectiveDate: new Date('2024-01-01'),
            copay: 25,
            deductible: 1500,
            deductibleMet: Math.random() * 1500,
            outOfPocketMax: 5000,
            outOfPocketMet: Math.random() * 2000,
          },
        },
      },
    })
    patients[p.mrn] = patient
  }

  console.log('✓ Patients created')

  // ─── Appointments ────────────────────────────────────────────────────────
  const appointmentTypes = ['follow-up', 'annual-wellness', 'new-patient', 'sick-visit', 'preventive']

  const appointmentsData = [
    // Past appointments (completed)
    { mrn: 'MRN-001', provider: providerChen, offset: -30, hour: 9, status: 'COMPLETED' as const, type: 'annual-wellness', complaint: 'Annual wellness exam' },
    { mrn: 'MRN-002', provider: providerChen, offset: -25, hour: 10, status: 'COMPLETED' as const, type: 'follow-up', complaint: 'Hypertension follow-up' },
    { mrn: 'MRN-003', provider: providerWilliams, offset: -20, hour: 11, status: 'COMPLETED' as const, type: 'sick-visit', complaint: 'Upper respiratory infection' },
    { mrn: 'MRN-004', provider: providerChen, offset: -15, hour: 14, status: 'COMPLETED' as const, type: 'follow-up', complaint: 'Diabetes management' },
    { mrn: 'MRN-007', provider: providerPatel, offset: -12, hour: 9, status: 'COMPLETED' as const, type: 'preventive', complaint: 'Well child visit 12yo' },
    { mrn: 'MRN-005', provider: providerWilliams, offset: -10, hour: 13, status: 'COMPLETED' as const, type: 'sick-visit', complaint: 'Migraine headache' },
    { mrn: 'MRN-006', provider: providerChen, offset: -8, hour: 10, status: 'COMPLETED' as const, type: 'follow-up', complaint: 'COPD management' },
    { mrn: 'MRN-008', provider: providerChen, offset: -7, hour: 15, status: 'COMPLETED' as const, type: 'follow-up', complaint: 'Lower back pain' },
    { mrn: 'MRN-009', provider: providerWilliams, offset: -5, hour: 9, status: 'COMPLETED' as const, type: 'new-patient', complaint: 'New patient eval' },
    { mrn: 'MRN-010', provider: providerWilliams, offset: -4, hour: 11, status: 'COMPLETED' as const, type: 'sick-visit', complaint: 'Anxiety, insomnia' },
    { mrn: 'MRN-011', provider: providerChen, offset: -3, hour: 14, status: 'COMPLETED' as const, type: 'follow-up', complaint: 'Post-MI follow-up' },
    { mrn: 'MRN-012', provider: providerPatel, offset: -2, hour: 9, status: 'COMPLETED' as const, type: 'preventive', complaint: 'Well child 9yo' },
    { mrn: 'MRN-013', provider: providerChen, offset: -1, hour: 10, status: 'COMPLETED' as const, type: 'sick-visit', complaint: 'Chest tightness, cough' },
    { mrn: 'MRN-020', provider: providerWilliams, offset: -1, hour: 15, status: 'CANCELLED' as const, type: 'follow-up', complaint: 'Thyroid check' },
    // Today's appointments
    { mrn: 'MRN-001', provider: providerChen, offset: 0, hour: 8, status: 'CHECKED_IN' as const, type: 'follow-up', complaint: 'Blood pressure check' },
    { mrn: 'MRN-015', provider: providerChen, offset: 0, hour: 9, status: 'SCHEDULED' as const, type: 'new-patient', complaint: 'New patient, fatigue' },
    { mrn: 'MRN-016', provider: providerWilliams, offset: 0, hour: 9, status: 'SCHEDULED' as const, type: 'follow-up', complaint: 'Joint pain follow-up' },
    { mrn: 'MRN-018', provider: providerPatel, offset: 0, hour: 10, status: 'SCHEDULED' as const, type: 'preventive', complaint: 'Well child 6yo' },
    { mrn: 'MRN-017', provider: providerChen, offset: 0, hour: 11, status: 'SCHEDULED' as const, type: 'sick-visit', complaint: 'Sore throat, fever' },
    { mrn: 'MRN-014', provider: providerChen, offset: 0, hour: 13, status: 'SCHEDULED' as const, type: 'follow-up', complaint: 'Osteoporosis review' },
    { mrn: 'MRN-019', provider: providerWilliams, offset: 0, hour: 14, status: 'SCHEDULED' as const, type: 'annual-wellness', complaint: 'Annual physical' },
    { mrn: 'MRN-002', provider: providerChen, offset: 0, hour: 15, status: 'SCHEDULED' as const, type: 'follow-up', complaint: 'Lab results review' },
    // Upcoming appointments
    { mrn: 'MRN-003', provider: providerWilliams, offset: 1, hour: 9, status: 'SCHEDULED' as const, type: 'follow-up', complaint: 'Post-illness check' },
    { mrn: 'MRN-004', provider: providerChen, offset: 2, hour: 10, status: 'SCHEDULED' as const, type: 'follow-up', complaint: 'A1c results' },
    { mrn: 'MRN-005', provider: providerWilliams, offset: 3, hour: 11, status: 'SCHEDULED' as const, type: 'follow-up', complaint: 'Medication adjustment' },
    { mrn: 'MRN-006', provider: providerChen, offset: 5, hour: 9, status: 'SCHEDULED' as const, type: 'annual-wellness', complaint: 'Annual physical' },
    { mrn: 'MRN-007', provider: providerPatel, offset: 7, hour: 14, status: 'SCHEDULED' as const, type: 'preventive', complaint: 'Sports physical' },
    { mrn: 'MRN-008', provider: providerChen, offset: 10, hour: 10, status: 'SCHEDULED' as const, type: 'follow-up', complaint: 'PT progress' },
    { mrn: 'MRN-009', provider: providerWilliams, offset: 14, hour: 9, status: 'SCHEDULED' as const, type: 'follow-up', complaint: 'Establish care' },
    { mrn: 'MRN-010', provider: providerWilliams, offset: 21, hour: 13, status: 'SCHEDULED' as const, type: 'follow-up', complaint: 'Anxiety meds check' },
  ]

  const appointments: { id: string; patientId: string; providerId: string; encounterDate: Date; status: string }[] = []

  for (const apt of appointmentsData) {
    const patient = patients[apt.mrn]
    if (!patient) continue
    const appt = await prisma.appointment.create({
      data: {
        patientId: patient.id,
        providerId: apt.provider.id,
        scheduledAt: d(apt.offset, apt.hour),
        duration: 30,
        status: apt.status,
        appointmentType: apt.type,
        chiefComplaint: apt.complaint,
      },
    })
    appointments.push({
      id: appt.id,
      patientId: patient.id,
      providerId: apt.provider.id,
      encounterDate: d(apt.offset, apt.hour),
      status: apt.status,
    })
  }

  console.log('✓ Appointments created')

  // ─── Encounters ──────────────────────────────────────────────────────────
  const completedAppts = appointments.filter(a => a.status === 'COMPLETED')

  const encounterTemplates = [
    { icd: 'I10', icdDesc: 'Essential (primary) hypertension', cpt: '99213', cptDesc: 'Office visit, moderate complexity', fee: 175 },
    { icd: 'J06.9', icdDesc: 'Acute upper respiratory infection', cpt: '99213', cptDesc: 'Office visit, moderate complexity', fee: 175 },
    { icd: 'E11.9', icdDesc: 'Type 2 diabetes mellitus without complications', cpt: '99214', cptDesc: 'Office visit, high complexity', fee: 250 },
    { icd: 'Z00.00', icdDesc: 'Encounter for general adult medical exam', cpt: '99395', cptDesc: 'Preventive care, 18-39 years', fee: 350 },
    { icd: 'Z00.129', icdDesc: 'Encounter for routine child health exam', cpt: '99392', cptDesc: 'Preventive care, 1-4 years', fee: 300 },
    { icd: 'G43.909', icdDesc: 'Migraine, unspecified, not intractable', cpt: '99213', cptDesc: 'Office visit, moderate complexity', fee: 175 },
    { icd: 'J44.1', icdDesc: 'Chronic obstructive pulmonary disease with acute exacerbation', cpt: '99214', cptDesc: 'Office visit, high complexity', fee: 250 },
    { icd: 'M54.5', icdDesc: 'Low back pain', cpt: '99213', cptDesc: 'Office visit, moderate complexity', fee: 175 },
    { icd: 'Z00.00', icdDesc: 'New patient evaluation', cpt: '99202', cptDesc: 'New patient office visit', fee: 200 },
    { icd: 'F41.9', icdDesc: 'Anxiety disorder, unspecified', cpt: '99213', cptDesc: 'Office visit, moderate complexity', fee: 175 },
    { icd: 'I25.10', icdDesc: 'Atherosclerotic heart disease of native coronary artery', cpt: '99214', cptDesc: 'Office visit, high complexity', fee: 250 },
    { icd: 'Z00.129', icdDesc: 'Well child 9yo', cpt: '99393', cptDesc: 'Preventive care, 5-11 years', fee: 300 },
    { icd: 'J20.9', icdDesc: 'Acute bronchitis, unspecified', cpt: '99213', cptDesc: 'Office visit, moderate complexity', fee: 175 },
  ]

  for (let i = 0; i < Math.min(completedAppts.length, encounterTemplates.length); i++) {
    const appt = completedAppts[i]
    const tmpl = encounterTemplates[i]
    const isOdd = i % 2 === 0

    await prisma.encounter.create({
      data: {
        appointmentId: appt.id,
        patientId: appt.patientId,
        providerId: appt.providerId,
        encounterDate: appt.encounterDate,
        status: isOdd ? 'SIGNED' : 'DRAFT',
        subjective: `Patient presents with ${tmpl.icdDesc.toLowerCase()}. Reports symptoms for past 2 weeks.`,
        objective: 'Vitals stable. Alert and oriented x3. Examination within normal limits for age.',
        assessment: tmpl.icdDesc,
        plan: 'Continue current medications. Follow up in 3 months. Lab work ordered.',
        signedAt: isOdd ? new Date(appt.encounterDate.getTime() + 3600000) : null,
        diagnoses: {
          create: {
            icdCode: tmpl.icd,
            description: tmpl.icdDesc,
            isPrimary: true,
            sequence: 1,
          },
        },
        procedures: {
          create: {
            cptCode: tmpl.cpt,
            description: tmpl.cptDesc,
            units: 1,
            fee: tmpl.fee,
          },
        },
      },
    })
  }

  console.log('✓ Encounters created')

  // ─── Claims ──────────────────────────────────────────────────────────────
  const encounters = await prisma.encounter.findMany({
    where: { status: 'SIGNED' },
    include: { patient: { include: { coverages: { include: { payer: true } } } } },
    take: 10,
  })

  const claimStatuses = ['PENDING', 'SCRUBBING', 'SUBMITTED', 'ACCEPTED', 'PAID', 'DENIED', 'APPEALED', 'SUBMITTED', 'PAID', 'PENDING'] as const

  for (let i = 0; i < encounters.length; i++) {
    const enc = encounters[i]
    const coverage = enc.patient.coverages[0]
    if (!coverage) continue
    const status = claimStatuses[i]

    const claim = await prisma.claim.create({
      data: {
        claimNumber: `CLM-2024-${String(i + 1).padStart(4, '0')}`,
        patientId: enc.patientId,
        payerId: coverage.payerId,
        encounterId: enc.id,
        status,
        totalCharge: 250,
        allowedAmount: status === 'PAID' || status === 'ACCEPTED' ? 180 : null,
        paidAmount: status === 'PAID' ? 155 : null,
        patientBalance: status === 'PAID' ? 25 : null,
        serviceDate: enc.encounterDate,
        submittedAt: ['SUBMITTED', 'ACCEPTED', 'PAID', 'DENIED', 'APPEALED'].includes(status)
          ? new Date(enc.encounterDate.getTime() + 86400000 * 3)
          : null,
        adjudicatedAt: ['PAID', 'DENIED'].includes(status)
          ? new Date(enc.encounterDate.getTime() + 86400000 * 14)
          : null,
        denialReason: status === 'DENIED' ? 'Duplicate claim – previously submitted under claim CLM-2024-0001' : null,
        events: {
          create: {
            status,
            notes: `Claim ${status.toLowerCase()} via agent automation`,
            agentName: 'CLAIM_SCRUBBER',
            automated: true,
          },
        },
      },
    })
  }

  console.log('✓ Claims created')

  // ─── Agent Logs (sample history) ─────────────────────────────────────────
  const agentLogSamples = [
    { agentName: 'FRONT_DESK' as const, intent: 'check-in', message: 'Checked in patient Eleanor Vance (MRN-001) for 8:00 AM appointment', status: 'COMPLETE' as const, confidence: 0.98 },
    { agentName: 'CLAIM_SCRUBBER' as const, intent: 'scrub-claim', message: 'Scrubbed CLM-2024-0001: No errors found, ready for submission', status: 'COMPLETE' as const, confidence: 0.95 },
    { agentName: 'ANALYTICS' as const, intent: 'query-metrics', message: 'Generated daily metrics report: 8 patients today, $2,150 in pending claims', status: 'COMPLETE' as const, confidence: 0.99 },
    { agentName: 'BILLING' as const, intent: 'post-payment', message: 'Posted ERA for claim CLM-2024-0005: paid $155.00, patient balance $25.00', status: 'COMPLETE' as const, confidence: 0.97 },
    { agentName: 'CLAIM_SCRUBBER' as const, intent: 'scrub-claim', message: 'CLM-2024-0006 flagged: Missing modifier on CPT 99214, escalating to billing', status: 'ESCALATED' as const, confidence: 0.45 },
  ]

  for (let i = 0; i < agentLogSamples.length; i++) {
    const log = agentLogSamples[i]
    await prisma.agentLog.create({
      data: {
        taskId: `task-seed-${i + 1}`,
        agentName: log.agentName,
        status: log.status,
        intent: log.intent,
        message: log.message,
        confidence: log.confidence,
        userId: adminUser.id,
        durationMs: Math.floor(Math.random() * 3000) + 500,
        createdAt: new Date(Date.now() - (5 - i) * 600000),
      },
    })
  }

  console.log('✓ Agent logs created')
  console.log('\n✅ Seed complete! Demo credentials:')
  console.log('   admin@molinaclinic.demo / demo1234')
  console.log('   provider@molinaclinic.demo / demo1234')
  console.log('   frontdesk@molinaclinic.demo / demo1234')
  console.log('   billing@molinaclinic.demo / demo1234')
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })

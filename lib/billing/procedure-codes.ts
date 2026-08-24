/**
 * Clinically coherent procedure → diagnosis pairings, plus procedure descriptions.
 *
 * Replaces the previous loader mapping, which covered ~60 codes and fell back to
 * `['Z00.00']` for everything else. Because the denied-claim population is
 * dominated by Medicaid long-term-services codes (S5125, T1019, T1005, T2003)
 * that were absent from that map, 85% of denied encounters ended up carrying
 * "Encounter for general adult medical examination" as their only diagnosis —
 * against attendant care, personal care and retroperitoneal ultrasound. Any
 * coder reads that as fabricated data in about two seconds.
 *
 * Two rules govern this table:
 *   1. Every pairing must be one a coder would accept on a real claim.
 *   2. Z00.* appears ONLY against preventive/screening procedures, where it is
 *      genuinely correct — never as a filler.
 *
 * Codes are ICD-10-CM FY2025-valid. Note that several codes in the old map
 * (M54.5, R05, M79.3) were deleted or repurposed in FY2022 and are corrected here.
 */

export interface ProcedureProfile {
  /** Human-readable description — letters cannot name a service without this. */
  description: string
  /** Whether the code is CPT (AMA) or HCPCS Level II. Letters were calling S/T codes "CPT". */
  system: 'CPT' | 'HCPCS'
  /** Clinically plausible primary diagnoses, most typical first. */
  diagnoses: string[]
}

export const PROCEDURES: Record<string, ProcedureProfile> = {
  // ── Medicaid long-term services & supports ────────────────────────────────
  S5125: {
    description: 'Attendant care services, per 15 minutes',
    system: 'HCPCS',
    diagnoses: ['G80.9', 'I69.354', 'G82.20', 'M62.81', 'G35'],
  },
  T1019: {
    description: 'Personal care services, per 15 minutes',
    system: 'HCPCS',
    diagnoses: ['I69.354', 'G82.20', 'M62.81', 'G20', 'E11.40'],
  },
  T1005: {
    description: 'Respite care services, up to 15 minutes',
    system: 'HCPCS',
    diagnoses: ['G80.9', 'F84.0', 'F72', 'G93.1'],
  },
  T2003: {
    description: 'Non-emergency transportation; encounter/trip',
    system: 'HCPCS',
    diagnoses: ['N18.6', 'Z99.2', 'E11.9', 'I69.354'],
  },
  T1502: {
    description:
      'Administration of oral, intramuscular and/or subcutaneous medication by health care agency/professional, per visit',
    system: 'HCPCS',
    diagnoses: ['E11.9', 'M06.9', 'I10', 'Z79.899'],
  },
  T2017: {
    description: 'Habilitation, residential, waiver; 15 minutes',
    system: 'HCPCS',
    diagnoses: ['F72', 'F84.0', 'G80.9'],
  },
  T1002: {
    description: 'RN services, up to 15 minutes',
    system: 'HCPCS',
    diagnoses: ['L89.90', 'E11.65', 'I50.9', 'Z93.0'],
  },
  T1000: {
    description: 'Private duty / independent nursing service, up to 15 minutes',
    system: 'HCPCS',
    diagnoses: ['Z99.11', 'J96.10', 'G80.9', 'Z93.0'],
  },
  T1015: {
    description: 'Clinic visit/encounter, all-inclusive',
    system: 'HCPCS',
    diagnoses: ['J06.9', 'I10', 'E11.9', 'N39.0'],
  },
  H2015: {
    description: 'Comprehensive community support services, per 15 minutes',
    system: 'HCPCS',
    diagnoses: ['F20.9', 'F31.9', 'F33.1'],
  },
  H2014: {
    description: 'Skills training and development, per 15 minutes',
    system: 'HCPCS',
    diagnoses: ['F84.0', 'F20.9', 'F31.9', 'F72'],
  },
  H0004: {
    description: 'Behavioral health counseling and therapy, per 15 minutes',
    system: 'HCPCS',
    diagnoses: ['F10.20', 'F11.20', 'F33.1'],
  },

  // ── Therapy ───────────────────────────────────────────────────────────────
  '92508': {
    description: 'Treatment of speech, language, voice or communication disorder; group',
    system: 'CPT',
    diagnoses: ['F80.2', 'F80.1', 'F80.9'],
  },
  '92507': {
    description: 'Treatment of speech, language, voice or communication disorder; individual',
    system: 'CPT',
    diagnoses: ['F80.1', 'F80.2', 'R47.01', 'F80.0'],
  },
  '92526': {
    description: 'Treatment of swallowing dysfunction and/or oral function for feeding',
    system: 'CPT',
    diagnoses: ['R13.12', 'R13.11', 'F80.9'],
  },
  '97110': {
    description: 'Therapeutic exercises to develop strength, endurance, range of motion',
    system: 'CPT',
    diagnoses: ['M54.50', 'M25.561', 'M62.81', 'S83.519A'],
  },
  '97530': {
    description: 'Therapeutic activities, direct patient contact; each 15 minutes',
    system: 'CPT',
    diagnoses: ['M62.81', 'M25.561', 'I69.354', 'S83.519A'],
  },
  '97140': {
    description: 'Manual therapy techniques, one or more regions; each 15 minutes',
    system: 'CPT',
    diagnoses: ['M54.50', 'M25.511', 'M54.2'],
  },

  // ── Evaluation & management ───────────────────────────────────────────────
  '99213': {
    description: 'Office/outpatient visit, established patient, low level of medical decision making',
    system: 'CPT',
    diagnoses: ['I10', 'E11.9', 'J06.9', 'F41.1'],
  },
  '99214': {
    description: 'Office/outpatient visit, established patient, moderate level of medical decision making',
    system: 'CPT',
    diagnoses: ['E11.65', 'I10', 'J44.9', 'N18.3'],
  },
  '99212': {
    description: 'Office/outpatient visit, established patient, straightforward medical decision making',
    system: 'CPT',
    diagnoses: ['J06.9', 'R05.9', 'L03.115', 'H66.90'],
  },
  '99215': {
    description: 'Office/outpatient visit, established patient, high level of medical decision making',
    system: 'CPT',
    diagnoses: ['E11.65', 'I50.32', 'J44.1', 'N18.4'],
  },
  '99203': {
    description: 'Office/outpatient visit, new patient, low level of medical decision making',
    system: 'CPT',
    diagnoses: ['R10.9', 'I10', 'M54.50'],
  },
  '99204': {
    description: 'Office/outpatient visit, new patient, moderate level of medical decision making',
    system: 'CPT',
    diagnoses: ['E11.9', 'I10', 'M54.50', 'R53.83'],
  },
  '99283': {
    description: 'Emergency department visit, moderate severity',
    system: 'CPT',
    diagnoses: ['R10.9', 'J45.901', 'R07.9', 'S61.409A'],
  },
  '99284': {
    description: 'Emergency department visit, high severity',
    system: 'CPT',
    diagnoses: ['R07.9', 'R55', 'K92.1', 'J45.902'],
  },
  '99285': {
    description: 'Emergency department visit, high severity with significant threat to function',
    system: 'CPT',
    diagnoses: ['I21.9', 'I63.9', 'S06.0X0A', 'J96.01'],
  },
  '99051': {
    description: 'Service provided in the office during regularly scheduled evening/weekend hours',
    system: 'CPT',
    diagnoses: ['J06.9', 'R50.9', 'H66.90'],
  },

  // ── Preventive / screening — Z codes are CORRECT here ─────────────────────
  '99391': {
    description: 'Periodic preventive medicine reevaluation, established patient, infant (under 1 year)',
    system: 'CPT',
    diagnoses: ['Z00.121', 'Z00.129'],
  },
  '99392': {
    description: 'Periodic preventive medicine reevaluation, established patient, ages 1–4',
    system: 'CPT',
    diagnoses: ['Z00.129', 'Z00.121'],
  },
  '99393': {
    description: 'Periodic preventive medicine reevaluation, established patient, ages 5–11',
    system: 'CPT',
    diagnoses: ['Z00.129', 'Z00.121'],
  },
  '99395': {
    description: 'Periodic preventive medicine reevaluation, established patient, ages 18–39',
    system: 'CPT',
    diagnoses: ['Z00.00', 'Z00.01'],
  },
  '99396': {
    description: 'Periodic preventive medicine reevaluation, established patient, ages 40–64',
    system: 'CPT',
    diagnoses: ['Z00.00', 'Z00.01'],
  },
  '96110': {
    description: 'Developmental screening with scoring and documented report',
    system: 'CPT',
    diagnoses: ['Z13.42', 'F84.0', 'F80.9'],
  },
  G0101: {
    description: 'Cervical or vaginal cancer screening; pelvic and clinical breast examination',
    system: 'HCPCS',
    diagnoses: ['Z12.4', 'Z01.419'],
  },

  // ── Immunization ──────────────────────────────────────────────────────────
  '90460': {
    description:
      'Immunization administration through age 18 with counseling; first vaccine component',
    system: 'CPT',
    diagnoses: ['Z23'],
  },
  '90461': {
    description:
      'Immunization administration through age 18 with counseling; each additional component',
    system: 'CPT',
    diagnoses: ['Z23'],
  },
  '90471': { description: 'Immunization administration; one vaccine', system: 'CPT', diagnoses: ['Z23'] },
  '90472': {
    description: 'Immunization administration; each additional vaccine',
    system: 'CPT',
    diagnoses: ['Z23'],
  },

  // ── Laboratory ────────────────────────────────────────────────────────────
  '85025': {
    description: 'Complete blood count (CBC) with automated differential WBC count',
    system: 'CPT',
    diagnoses: ['D50.9', 'D64.9', 'R50.9', 'Z79.899'],
  },
  '80053': {
    description: 'Comprehensive metabolic panel',
    system: 'CPT',
    diagnoses: ['E11.9', 'N18.3', 'I10', 'K76.0'],
  },
  '80061': {
    description: 'Lipid panel',
    system: 'CPT',
    diagnoses: ['E78.5', 'E78.00', 'I10', 'E11.9'],
  },
  '81001': {
    description: 'Urinalysis, automated, with microscopy',
    system: 'CPT',
    diagnoses: ['N39.0', 'R31.9', 'N30.00'],
  },
  '87880': {
    description: 'Infectious agent detection, Streptococcus group A, direct optical observation',
    system: 'CPT',
    diagnoses: ['J02.0', 'J03.90', 'R07.0'],
  },
  '87804': {
    description: 'Infectious agent detection, influenza, direct optical observation',
    system: 'CPT',
    diagnoses: ['J11.1', 'J09.X2', 'R50.9'],
  },
  '87426': {
    description: 'Infectious agent antigen detection, SARS-CoV-2',
    system: 'CPT',
    diagnoses: ['U07.1', 'Z20.822', 'R05.9'],
  },
  '87491': {
    description: 'Infectious agent detection, Chlamydia trachomatis, amplified probe technique',
    system: 'CPT',
    diagnoses: ['A56.02', 'Z11.3', 'N39.0'],
  },
  '36415': {
    description: 'Collection of venous blood by venipuncture',
    system: 'CPT',
    diagnoses: ['E11.9', 'I10', 'Z79.899', 'D64.9'],
  },
  '99000': {
    description: 'Handling and/or conveyance of specimen from the office to a laboratory',
    system: 'CPT',
    diagnoses: ['E11.9', 'N39.0', 'D64.9'],
  },

  // ── Imaging ───────────────────────────────────────────────────────────────
  '71045': {
    description: 'Radiologic examination, chest; single view',
    system: 'CPT',
    diagnoses: ['R05.9', 'J18.9', 'R06.02', 'R07.9'],
  },
  '76770': {
    description: 'Ultrasound, retroperitoneal, real time with image documentation; complete',
    system: 'CPT',
    diagnoses: ['N28.9', 'N20.0', 'R10.9', 'N18.3'],
  },

  // ── Dental ────────────────────────────────────────────────────────────────
  D0120: {
    description: 'Periodic oral evaluation, established patient',
    system: 'HCPCS',
    diagnoses: ['K02.9', 'K05.10'],
  },
  D0220: {
    description: 'Intraoral periapical radiographic image, first image',
    system: 'HCPCS',
    diagnoses: ['K02.9', 'K04.7'],
  },
  D0230: {
    description: 'Intraoral periapical radiographic image, each additional image',
    system: 'HCPCS',
    diagnoses: ['K02.9', 'K04.7'],
  },
  D1120: {
    description: 'Prophylaxis — child',
    system: 'HCPCS',
    diagnoses: ['K02.9', 'K05.10'],
  },

  // ── Behavioral health ─────────────────────────────────────────────────────
  '90837': {
    description: 'Psychotherapy, 60 minutes with patient',
    system: 'CPT',
    diagnoses: ['F33.1', 'F41.1', 'F43.10'],
  },
  '90834': {
    description: 'Psychotherapy, 45 minutes with patient',
    system: 'CPT',
    diagnoses: ['F32.1', 'F41.1', 'F43.23'],
  },
  '90832': {
    description: 'Psychotherapy, 30 minutes with patient',
    system: 'CPT',
    diagnoses: ['F32.0', 'F41.1'],
  },
  '90847': {
    description: 'Family psychotherapy with patient present, 50 minutes',
    system: 'CPT',
    diagnoses: ['F43.20', 'Z63.0', 'F91.3'],
  },
}

/**
 * Fallback pairings by code family, used when a procedure is not individually
 * mapped. Far from perfect, but a family-appropriate diagnosis beats a routine
 * physical against every unmapped code in the dataset.
 */
const FAMILY_FALLBACKS: { test: (code: string) => boolean; profile: ProcedureProfile }[] = [
  {
    // S/T Medicaid LTSS and waiver services — chronic, function-limiting conditions.
    test: c => /^[ST]\d{4}$/.test(c),
    profile: {
      description: 'Medicaid long-term services and supports',
      system: 'HCPCS',
      diagnoses: ['I69.354', 'G82.20', 'M62.81', 'G80.9'],
    },
  },
  {
    // H-codes are behavioral health.
    test: c => /^H\d{4}$/.test(c),
    profile: {
      description: 'Behavioral health service',
      system: 'HCPCS',
      diagnoses: ['F20.9', 'F33.1', 'F31.9'],
    },
  },
  {
    test: c => /^D\d{4}$/.test(c),
    profile: { description: 'Dental service', system: 'HCPCS', diagnoses: ['K02.9', 'K05.10'] },
  },
  {
    // 8xxxx — pathology and laboratory.
    test: c => /^8\d{4}$/.test(c),
    profile: {
      description: 'Laboratory service',
      system: 'CPT',
      diagnoses: ['E11.9', 'I10', 'D64.9'],
    },
  },
  {
    // 7xxxx — radiology.
    test: c => /^7\d{4}$/.test(c),
    profile: {
      description: 'Diagnostic imaging service',
      system: 'CPT',
      diagnoses: ['R10.9', 'M54.50', 'R07.9'],
    },
  },
  {
    // 9xxxx — medicine and E/M.
    test: c => /^9\d{4}$/.test(c),
    profile: {
      description: 'Medical service',
      system: 'CPT',
      diagnoses: ['I10', 'E11.9', 'J06.9'],
    },
  },
]

const GENERIC: ProcedureProfile = {
  description: 'Covered medical service',
  system: 'HCPCS',
  diagnoses: ['I10', 'E11.9'],
}

export function profileFor(procCode: string): ProcedureProfile {
  const code = procCode.trim().toUpperCase()
  if (PROCEDURES[code]) return PROCEDURES[code]
  return FAMILY_FALLBACKS.find(f => f.test(code))?.profile ?? GENERIC
}

/**
 * Deterministic diagnosis selection for a given encounter, so re-running the
 * backfill is stable. Returns one to two codes — most real claims carry a
 * primary plus at most one secondary.
 */
export function diagnosesFor(procCode: string, seed: string): string[] {
  const { diagnoses } = profileFor(procCode)
  if (diagnoses.length === 0) return []
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 37 + seed.charCodeAt(i)) >>> 0
  const primary = diagnoses[h % diagnoses.length]
  // ~40% of claims carry a secondary diagnosis.
  if (diagnoses.length < 2 || h % 5 < 3) return [primary]
  const rest = diagnoses.filter(d => d !== primary)
  return [primary, rest[(h >>> 8) % rest.length]]
}

/** Is this ICD-10 code a routine-exam Z code? Used to assert the filler is gone. */
export function isRoutineExamCode(icd: string): boolean {
  return /^Z00\./.test(icd)
}

/**
 * Descriptions for every ICD-10 code this module can emit.
 *
 * There is no icd10_codes table in the schema, and a letter that recites a bare
 * code without naming the condition reads as machine output. Kept alongside the
 * pairings above so the two can never drift apart.
 */
export const ICD_DESCRIPTIONS: Record<string, string> = {
  'A56.02': 'Chlamydial vulvovaginitis',
  'D50.9': 'Iron deficiency anemia, unspecified',
  'D64.9': 'Anemia, unspecified',
  'E11.9': 'Type 2 diabetes mellitus without complications',
  'E11.40': 'Type 2 diabetes mellitus with diabetic neuropathy, unspecified',
  'E11.65': 'Type 2 diabetes mellitus with hyperglycemia',
  'E78.00': 'Pure hypercholesterolemia, unspecified',
  'E78.5': 'Hyperlipidemia, unspecified',
  'F10.20': 'Alcohol dependence, uncomplicated',
  'F11.20': 'Opioid dependence, uncomplicated',
  'F20.9': 'Schizophrenia, unspecified',
  'F31.9': 'Bipolar disorder, unspecified',
  'F32.0': 'Major depressive disorder, single episode, mild',
  'F32.1': 'Major depressive disorder, single episode, moderate',
  'F33.1': 'Major depressive disorder, recurrent, moderate',
  'F41.1': 'Generalized anxiety disorder',
  'F43.10': 'Post-traumatic stress disorder, unspecified',
  'F43.20': 'Adjustment disorder, unspecified',
  'F43.23': 'Adjustment disorder with mixed anxiety and depressed mood',
  'F72': 'Severe intellectual disabilities',
  'F80.0': 'Phonological disorder',
  'F80.1': 'Expressive language disorder',
  'F80.2': 'Mixed receptive-expressive language disorder',
  'F80.9': 'Developmental disorder of speech and language, unspecified',
  'F84.0': 'Autistic disorder',
  'F91.3': 'Oppositional defiant disorder',
  'G20': "Parkinson's disease",
  'G35': 'Multiple sclerosis',
  'G80.9': 'Cerebral palsy, unspecified',
  'G82.20': 'Paraplegia, unspecified',
  'G93.1': 'Anoxic brain damage, not elsewhere classified',
  'H66.90': 'Otitis media, unspecified, unspecified ear',
  'I10': 'Essential (primary) hypertension',
  'I21.9': 'Acute myocardial infarction, unspecified',
  'I50.32': 'Chronic diastolic (congestive) heart failure',
  'I50.9': 'Heart failure, unspecified',
  'I63.9': 'Cerebral infarction, unspecified',
  'I69.354': 'Hemiplegia and hemiparesis following cerebral infarction affecting left non-dominant side',
  'J02.0': 'Streptococcal pharyngitis',
  'J03.90': 'Acute tonsillitis, unspecified',
  'J06.9': 'Acute upper respiratory infection, unspecified',
  'J09.X2': 'Influenza due to identified novel influenza A virus with other respiratory manifestations',
  'J11.1': 'Influenza due to unidentified influenza virus with other respiratory manifestations',
  'J18.9': 'Pneumonia, unspecified organism',
  'J44.1': 'Chronic obstructive pulmonary disease with (acute) exacerbation',
  'J44.9': 'Chronic obstructive pulmonary disease, unspecified',
  'J45.901': 'Unspecified asthma with (acute) exacerbation',
  'J45.902': 'Unspecified asthma with status asthmaticus',
  'J96.01': 'Acute respiratory failure with hypoxia',
  'J96.10': 'Chronic respiratory failure, unspecified whether with hypoxia or hypercapnia',
  'K02.9': 'Dental caries, unspecified',
  'K04.7': 'Periapical abscess without sinus',
  'K05.10': 'Chronic gingivitis, plaque induced',
  'K76.0': 'Fatty (change of) liver, not elsewhere classified',
  'K92.1': 'Melena',
  'L03.115': 'Cellulitis of right lower limb',
  'L89.90': 'Pressure ulcer of unspecified site, unspecified stage',
  'M06.9': 'Rheumatoid arthritis, unspecified',
  'M25.511': 'Pain in right shoulder',
  'M25.561': 'Pain in right knee',
  'M54.2': 'Cervicalgia',
  'M54.50': 'Low back pain, unspecified',
  'M62.81': 'Muscle weakness (generalized)',
  'N18.3': 'Chronic kidney disease, stage 3 unspecified',
  'N18.4': 'Chronic kidney disease, stage 4 (severe)',
  'N18.6': 'End stage renal disease',
  'N20.0': 'Calculus of kidney',
  'N28.9': 'Disorder of kidney and ureter, unspecified',
  'N30.00': 'Acute cystitis without hematuria',
  'N39.0': 'Urinary tract infection, site not specified',
  'R05.9': 'Cough, unspecified',
  'R06.02': 'Shortness of breath',
  'R07.0': 'Pain in throat',
  'R07.9': 'Chest pain, unspecified',
  'R10.9': 'Unspecified abdominal pain',
  'R13.11': 'Dysphagia, oral phase',
  'R13.12': 'Dysphagia, oropharyngeal phase',
  'R31.9': 'Hematuria, unspecified',
  'R47.01': 'Aphasia',
  'R50.9': 'Fever, unspecified',
  'R53.83': 'Other fatigue',
  'R55': 'Syncope and collapse',
  'S06.0X0A': 'Concussion without loss of consciousness, initial encounter',
  'S61.409A': 'Unspecified open wound of unspecified hand, initial encounter',
  'S83.519A': 'Sprain of anterior cruciate ligament of unspecified knee, initial encounter',
  'U07.1': 'COVID-19',
  'Z00.00': 'Encounter for general adult medical examination without abnormal findings',
  'Z00.01': 'Encounter for general adult medical examination with abnormal findings',
  'Z00.121': 'Encounter for routine child health examination with abnormal findings',
  'Z00.129': 'Encounter for routine child health examination without abnormal findings',
  'Z01.20': 'Encounter for dental examination and cleaning without abnormal findings',
  'Z01.419': 'Encounter for gynecological examination without abnormal findings',
  'Z11.3': 'Encounter for screening for infections with a predominantly sexual mode of transmission',
  'Z12.4': 'Encounter for screening for malignant neoplasm of cervix',
  'Z13.42': 'Encounter for screening for global developmental delays (milestones)',
  'Z20.822': 'Contact with and (suspected) exposure to COVID-19',
  'Z23': 'Encounter for immunization',
  'Z63.0': 'Problems in relationship with spouse or partner',
  'Z79.899': 'Other long term (current) drug therapy',
  'Z93.0': 'Tracheostomy status',
  'Z99.11': 'Dependence on respirator [ventilator] status',
  'Z99.2': 'Dependence on renal dialysis',
}

export function describeIcd(code: string): string | null {
  return ICD_DESCRIPTIONS[code.trim().toUpperCase()] ?? null
}

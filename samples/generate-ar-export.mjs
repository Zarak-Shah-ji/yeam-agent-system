/**
 * Regenerates samples/sample-ar-export.csv.
 *
 *   node samples/generate-ar-export.mjs
 *
 * The output is deterministic — same seed, same file — so a regeneration shows
 * up in review as an intended change rather than 1,200 lines of churn.
 *
 * WHY A GENERATOR AND NOT A HAND-WRITTEN FIXTURE
 * The upload box is the first thing a billing manager touches, and a 42-row
 * sample makes every chart behind it look like a toy: one bar per month, an
 * aging report with four claims in it, a payer scorecard whose medians move if
 * you squint. 1,200 rows is the smallest file where the A/R aging buckets, the
 * revenue trend and the per-payer denial rates all read as a real practice.
 *
 * WHERE THE NUMBERS COME FROM
 * TX_ANCHORS below is real data: CMS Medicare Part B provider utilization for
 * Texas, aggregated per procedure code to (claim volume, mean paid per claim).
 * That gives two things no invented fixture has —
 *
 *   1. A believable procedure MIX. Codes appear in proportion to how often
 *      Texas providers actually bill them (sqrt-damped, or S5125 alone would be
 *      45% of the file).
 *   2. Believable MONEY. Each code's Medicare mean is the anchor; charges are
 *      that times a practice's markup, and allowed amounts are that times what
 *      the payer actually pays relative to Medicare. A coder reading 99213 at
 *      $38 allowed and $112 billed sees their own fee schedule.
 *
 * Only the aggregate survives — no NPI, name, address or any other provider
 * identifier from the source file is used or reproduced here. Patients are
 * wholly synthetic.
 *
 * The procedure→diagnosis pairings are read out of lib/billing/procedure-codes.ts
 * at generation time rather than copied, so the sample cannot drift from the
 * catalog the rest of the product codes against.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const ROW_COUNT = 1200
const SEED = 20260904

/** The snapshot's "as of" date. Nothing settles after this. */
const TODAY = new Date(Date.UTC(2026, 8, 4))
const FIRST_DOS = new Date(Date.UTC(2026, 0, 5))
const LAST_DOS = new Date(Date.UTC(2026, 7, 28))

/* ------------------------------------------------------- real TX anchors --- */

/**
 * [code, TX claim volume, mean Medicare paid per claim].
 *
 * Dental (D0120/D0220/D0230/D1120) is in the procedure catalog but not in a
 * family practice's A/R, so it is left out. G0101 is excluded too: 990 claims
 * and $24.50 paid across the whole state is a data artifact, not a rate.
 */
const TX_ANCHORS = [
  ['S5125', 265232256, 58.4], ['T1019', 64933873, 25.62], ['99213', 31089614, 38.28],
  ['99214', 17451327, 46.04], ['90460', 15099823, 9.51], ['T2003', 12009473, 5.59],
  ['92507', 11580936, 83.91], ['T1015', 10493091, 164.69], ['85025', 8459340, 5.5],
  ['92508', 8062288, 4.16], ['H2014', 7915832, 86.51], ['T1000', 6937681, 492.9],
  ['99283', 6919970, 89.77], ['80053', 6749586, 8.2], ['99284', 6641416, 164.56],
  ['71045', 6429176, 7.62], ['T1005', 6361418, 55.4], ['97530', 6160941, 69.4],
  ['36415', 5957005, 3.0], ['87804', 5941626, 13.47], ['87880', 5719738, 11.8],
  ['80061', 4724045, 5.92], ['97110', 4480864, 50.42], ['90461', 3897296, 4.01],
  ['96110', 3839772, 7.29], ['87426', 3765484, 31.8], ['99392', 3528733, 74.74],
  ['99212', 3480537, 33.96], ['99391', 3162777, 75.48], ['87491', 3115746, 20.35],
  ['99285', 3089924, 144.84], ['99393', 2792222, 78.14], ['81001', 2712380, 4.02],
  ['90471', 2550358, 7.72], ['90837', 2363093, 74.5], ['99000', 2294092, 8.09],
  ['90472', 1919765, 6.21], ['T2017', 1914996, 78.33], ['90834', 1753287, 39.62],
  ['T1502', 1718853, 5.56], ['99203', 1703526, 67.58], ['H2015', 1192138, 97.15],
  ['99215', 1047738, 70.45], ['90832', 1035786, 27.17], ['T1002', 1030125, 29.47],
  ['99204', 915603, 79.89], ['99051', 621381, 21.63], ['92526', 296140, 100.17],
  ['99395', 267648, 71.34], ['76770', 193845, 58.66], ['H0004', 176315, 53.11],
  ['97140', 168888, 17.44], ['90847', 165564, 64.84], ['99396', 21897, 69.46],
]

/* ---------------------------------------------------------------- payers --- */

/**
 * How each payer behaves, which is the whole point of a per-payer scorecard.
 *
 * `rate` is what the payer allows relative to Medicare — Texas Medicaid and its
 * MCOs below 1.0, commercial above. `days` is the median filing-to-remit lag.
 * `denial` is the share of that payer's claims that come back denied or
 * rejected. UnitedHealthcare is deliberately the outlier on both speed and
 * denials, and the Medicaid MCOs deny on prior authorisation, because a
 * scorecard where every row looks the same demonstrates nothing.
 *
 * Superior, Molina, Amerigroup and Self-Pay match no entry in PAYER_WINDOWS, so
 * they fall to the 90-day default and the worklist marks them as running on a
 * guess. That state is worth showing.
 *
 * The denial rates are spread wider than a real book of business would be. The
 * scorecard divides denials by ALL of a payer's claims, pending ones included,
 * so a configured 19% surfaces as about 10% — and at 40-odd claims, a small
 * payer's rate swings several points on one denial either way. Tuned until the
 * rendered scorecard, not the table below, puts UnitedHealthcare on top.
 */
const PAYERS = [
  { name: 'Texas Medicaid',                   share: 20, rate: 0.72, days: 32, spread: 12, denial: 0.15 },
  { name: 'Blue Cross Blue Shield of Texas',  share: 13, rate: 1.35, days: 24, spread: 9,  denial: 0.07 },
  { name: 'Medicare',                         share: 13, rate: 1.0,  days: 14, spread: 5,  denial: 0.04 },
  { name: 'UnitedHealthcare',                 share: 11, rate: 1.32, days: 48, spread: 18, denial: 0.34 },
  { name: 'Superior HealthPlan',              share: 10, rate: 0.7,  days: 38, spread: 14, denial: 0.25 },
  { name: 'Molina Healthcare of Texas',       share: 8,  rate: 0.7,  days: 41, spread: 15, denial: 0.23 },
  { name: 'Amerigroup Texas',                 share: 6,  rate: 0.71, days: 36, spread: 13, denial: 0.2 },
  { name: 'Aetna',                            share: 6,  rate: 1.3,  days: 28, spread: 10, denial: 0.07 },
  { name: 'Cigna',                            share: 5,  rate: 1.28, days: 30, spread: 11, denial: 0.08 },
  { name: 'Humana',                           share: 4,  rate: 1.22, days: 26, spread: 10, denial: 0.06 },
  { name: 'Self-Pay',                         share: 4,  rate: 1.0,  days: 21, spread: 10, denial: 0.0 },
]

/* ------------------------------------------------------------------ CARC --- */

/**
 * Reason codes, weighted, split by what they mean.
 *
 * Every code here is one lib/denials/triage.ts recognises, so each denied row
 * lands on a real remedy — appeal, corrected claim, reprocess or not
 * recoverable — instead of "Unrecognised reason code". The split matters: a
 * rejection is a clean-claim problem (CO-16, CO-11, bad modifier), a denial is
 * an adjudication problem (medical necessity, bundling, prior auth).
 */
const DENIAL_CARCS = [
  ['CO-197', 16], ['CO-50', 14], ['CO-97', 13], ['CO-151', 9], ['CO-16', 8],
  ['CO-96', 7], ['CO-11', 6], ['CO-45', 5], ['CO-29', 4], ['CO-167', 4],
  ['CO-B7', 3], ['CO-109', 3], ['CO-119', 3], ['CO-22', 2], ['CO-27', 2], ['CO-18', 2],
]
const REJECT_CARCS = [
  ['CO-16', 30], ['CO-11', 18], ['CO-31', 14], ['CO-18', 10],
  ['CO-4', 9], ['CO-5', 7], ['CO-6', 5], ['CO-8', 4], ['CO-15', 3],
]
/** Prior-auth and units denials cluster on the Medicaid LTSS codes. */
const LTSS_CARCS = [['CO-197', 34], ['CO-151', 24], ['CO-15', 12], ['CO-16', 12], ['CO-50', 10], ['CO-29', 8]]
/** UnitedHealthcare's signature: bundling and medical necessity. */
const UHC_CARCS = [['CO-97', 30], ['CO-50', 22], ['CO-197', 14], ['CO-151', 10], ['CO-16', 10], ['CO-96', 8], ['CO-45', 6]]
const PATIENT_CARCS = [['PR-2', 55], ['PR-1', 28], ['PR-3', 17]]

const LTSS = new Set(['S5125', 'T1019', 'T1005', 'T2003', 'T1502', 'T2017', 'T1002', 'T1000'])

/* -------------------------------------------------------------- patients --- */

const FIRST = [
  'Denise', 'Quentin', 'Jorge', 'Robert', 'Hector', 'Karen', 'Maria', 'Linda', 'Carlos',
  'Rosa', 'James', 'Grace', 'Aisha', 'Olivia', 'Priya', 'Monica', 'Luis', 'Nathan',
  'Elena', 'Marcus', 'Yolanda', 'Devon', 'Camila', 'Trevor', 'Nadia', 'Omar', 'Beatriz',
  'Isaac', 'Fatima', 'Andre', 'Lucia', 'Kwame', 'Sylvia', 'Rafael', 'Imani', 'Victor',
  'Renata', 'Dmitri', 'Anika', 'Curtis', 'Paloma', 'Bashir', 'Ingrid', 'Tomas', 'Neema',
]
const LAST = [
  'Brooks', 'Silva', 'Jackson', 'Quinn', 'Turner', 'Mensah', 'Patel', 'Huang', 'Edwards',
  'Alvarez', 'Ramirez', 'Lopez', 'Nguyen', 'Ibarra', 'Chen', 'Diaz', 'Flores', 'Garcia',
  'Okonkwo', 'Castillo', 'Whitfield', 'Barros', 'Haddad', 'Vasquez', 'Delgado', 'Osei',
  'Reyes', 'Kaur', 'Montoya', 'Bright', 'Salazar', 'Adeyemi', 'Cortez', 'Marsh', 'Villa',
]

/* ------------------------------------------------------------------ util --- */

/** mulberry32 — small, seeded, and identical across Node versions. */
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const rand = rng(SEED)
const pick = list => list[Math.floor(rand() * list.length)]
const between = (lo, hi) => lo + rand() * (hi - lo)
const intBetween = (lo, hi) => Math.floor(between(lo, hi + 1))

/** Weighted pick over [value, weight] pairs. */
function weighted(pairs) {
  const total = pairs.reduce((sum, [, w]) => sum + w, 0)
  let n = rand() * total
  for (const [value, w] of pairs) {
    n -= w
    if (n <= 0) return value
  }
  return pairs[pairs.length - 1][0]
}

const cents = n => Math.round(n * 100) / 100
const money = n => cents(n).toFixed(2)
const addDays = (date, days) => new Date(date.getTime() + days * 86_400_000)
const mdy = date =>
  `${String(date.getUTCMonth() + 1).padStart(2, '0')}/${String(date.getUTCDate()).padStart(2, '0')}/${date.getUTCFullYear()}`

/* ------------------------------------------- diagnoses, from the catalog --- */

/**
 * Pull each code's clinically valid diagnoses out of lib/billing/procedure-codes.ts.
 *
 * Read rather than duplicated: the catalog's first rule is that every pairing is
 * one a coder would accept, and a copy here would quietly stop honouring it the
 * first time someone corrects a code upstream.
 */
function loadDiagnoses() {
  const src = readFileSync(join(ROOT, 'lib/billing/procedure-codes.ts'), 'utf8')
  const body = src.slice(src.indexOf('export const PROCEDURES'))
  const out = {}

  // Brace-balanced rather than regex-delimited: entries in the catalog are
  // written both one-per-line and spread over five, and a pattern anchored on a
  // closing "  }," silently welds a single-line entry onto the one after it.
  for (const open of body.matchAll(/^\s{2}'?([A-Z0-9]{5})'?:\s*\{/gm)) {
    const code = open[1]
    let depth = 0
    let end = open.index + open[0].length - 1
    for (let i = end; i < body.length; i += 1) {
      if (body[i] === '{') depth += 1
      else if (body[i] === '}' && (depth -= 1) === 0) {
        end = i
        break
      }
    }
    const inner = body.slice(open.index, end)
    const list = inner.match(/diagnoses:\s*\[([^\]]*)\]/)
    if (!list) continue
    const codes = [...list[1].matchAll(/'([^']+)'/g)].map(m => m[1])
    if (codes.length) out[code] = codes
  }
  return out
}

const DIAGNOSES = loadDiagnoses()

const missing = TX_ANCHORS.filter(([code]) => !DIAGNOSES[code]).map(([code]) => code)
if (missing.length) {
  throw new Error(`No diagnoses in the procedure catalog for: ${missing.join(', ')}`)
}

/* ------------------------------------------------------------ generation --- */

/**
 * sqrt damping, not raw volume. S5125 outsells 99213 eight to one statewide
 * because it bills in 15-minute units; reproducing that ratio would bury the
 * office visits that make the file legible as a clinic's A/R.
 */
const CODE_WEIGHTS = TX_ANCHORS.map(([code, volume]) => [code, Math.sqrt(volume)])
const MEDICARE_RATE = Object.fromEntries(TX_ANCHORS.map(([code, , rate]) => [code, rate]))
const PAYER_WEIGHTS = PAYERS.map(p => [p, p.share])

const patients = Array.from({ length: 380 }, () => ({
  name: `${pick(FIRST)} ${pick(LAST)}`,
  memberId: `M${intBetween(100000000, 999999999)}`,
  dob: mdy(new Date(Date.UTC(intBetween(1938, 2019), intBetween(0, 11), intBetween(1, 28)))),
}))

const DOS_SPAN = Math.round((LAST_DOS - FIRST_DOS) / 86_400_000)

const rows = []
for (let i = 0; i < ROW_COUNT; i += 1) {
  const payer = weighted(PAYER_WEIGHTS)
  const code = weighted(CODE_WEIGHTS)
  const patient = pick(patients)

  // Slight recency bias: a real export has more of the last quarter in it.
  const dos = addDays(FIRST_DOS, Math.round(DOS_SPAN * Math.pow(rand(), 0.82)))
  const submitted = addDays(dos, intBetween(1, 9))

  const dxList = DIAGNOSES[code]
  // Index 0 is the most typical pairing, so weight toward the front.
  const icd10 = dxList[Math.min(dxList.length - 1, Math.floor(Math.pow(rand(), 2) * dxList.length))]

  const units = LTSS.has(code) ? intBetween(1, 6) : 1
  const medicare = MEDICARE_RATE[code] * units
  const billed = Math.max(12, medicare * between(2.4, 3.2))

  // Would the payer have answered by now?
  const lag = Math.max(3, Math.round(payer.days + between(-payer.spread, payer.spread)))
  const remit = addDays(submitted, lag)
  const answered = remit <= TODAY
  const selfPay = payer.name === 'Self-Pay'

  let status
  let carc = ''
  let allowed = 0
  let paid = 0
  let patientResp = 0
  let adjustment = 0

  if (!answered) {
    status = 'Pending'
  } else if (selfPay) {
    // No contract, so nothing is contractually adjusted away and the whole
    // charge is the patient's. Some of it collects, some ages into bad debt.
    // This is the row that gives the scorecard a null net collection rate,
    // which is correct: there is no allowed amount to measure against.
    allowed = billed
    const roll = rand()
    if (roll < 0.34) {
      paid = billed
      status = 'Paid'
    } else if (roll < 0.56) {
      paid = billed * between(0.2, 0.7)
      patientResp = billed - paid
      status = 'Partially Paid'
      carc = 'PR-3'
    } else if (roll < 0.74) {
      allowed = 0
      adjustment = billed
      status = 'Written Off'
      carc = 'CO-45'
    } else {
      allowed = 0
      status = 'Pending'
    }
  } else if (rand() < payer.denial) {
    // A quarter of the bad outcomes are clean-claim rejections, not denials.
    const rejected = rand() < 0.26
    status = rejected ? 'Rejected' : 'Denied'
    carc = rejected
      ? weighted(REJECT_CARCS)
      : weighted(
          LTSS.has(code) ? LTSS_CARCS : payer.name === 'UnitedHealthcare' ? UHC_CARCS : DENIAL_CARCS,
        )
  } else if (rand() < 0.055) {
    // Given up on: small balances and stale timely-filing losses.
    status = 'Written Off'
    carc = rand() < 0.6 ? 'CO-45' : 'CO-29'
    adjustment = billed
  } else {
    allowed = Math.min(billed, medicare * payer.rate * between(0.92, 1.08))
    adjustment = billed - allowed

    // Coinsurance and deductibles are a commercial and Medicare phenomenon;
    // Texas Medicaid members almost never carry one.
    const medicaid = /medicaid|superior|molina|amerigroup/i.test(payer.name)
    const hasPatientShare = rand() < (medicaid ? 0.06 : 0.34)
    patientResp = hasPatientShare ? allowed * between(0.1, 0.3) : 0
    paid = allowed - patientResp
    status = patientResp > 0.005 ? 'Partially Paid' : 'Paid'
    if (patientResp > 0.005) carc = weighted(PATIENT_CARCS)
  }

  // Quantise to cents FIRST, then derive the dependent amounts from the
  // quantised ones. Rounding each of allowed/paid/responsibility independently
  // leaves rows where paid + responsibility misses allowed by a penny, and a
  // penny is exactly the kind of thing a billing manager checks first.
  const B = cents(billed)
  const A = Math.min(B, cents(allowed))
  const PR = cents(patientResp)
  const P = cents(A - PR)
  const ADJ = adjustment === 0 ? 0 : cents(B - A)

  rows.push([
    `CLM-2026-${4100 + i}`,
    patient.name,
    patient.memberId,
    patient.dob,
    payer.name,
    mdy(dos),
    mdy(submitted),
    answered && status !== 'Pending' && status !== 'Rejected' ? mdy(remit) : '',
    code,
    icd10,
    B.toFixed(2),
    A.toFixed(2),
    P.toFixed(2),
    PR.toFixed(2),
    ADJ.toFixed(2),
    status,
    carc,
  ])
}

const HEADER = [
  'Claim Number', 'Patient Name', 'Member ID', 'DOB', 'Payer', 'DOS', 'Date Submitted',
  'Paid Date', 'CPT', 'ICD-10', 'Billed Amount', 'Allowed Amount', 'Paid Amount',
  'Patient Responsibility', 'Adjustment', 'Claim Status', 'CARC',
]

const out = join(ROOT, 'samples/sample-ar-export.csv')
writeFileSync(out, [HEADER, ...rows].map(r => r.join(',')).join('\n') + '\n')

/* ------------------------------------------------------------- summary --- */

const tally = key => {
  const counts = new Map()
  for (const row of rows) counts.set(row[key], (counts.get(row[key]) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1])
}
const sum = col => rows.reduce((n, r) => n + Number(r[col]), 0)

console.log(`Wrote ${rows.length} rows to ${out}`)
console.log(`  billed ${money(sum(10))}  paid ${money(sum(12))}  outstanding ${money(sum(10) - sum(12) - sum(14))}`)
console.log(`  statuses: ${tally(15).map(([s, n]) => `${s} ${n}`).join(', ')}`)
console.log(`  payers:   ${tally(4).length}, codes: ${tally(8).length}, patients: ${new Set(rows.map(r => r[1])).size}`)

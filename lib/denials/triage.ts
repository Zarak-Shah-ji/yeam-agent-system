/**
 * Denial triage: the deterministic part of what Yeam knows.
 *
 * Rules, not AI. Deciding whether a denial wants a corrected claim, a
 * reprocessing request or an appeal — and how many days are left to send it —
 * is a lookup against the payer's own rules. A general chat model will write a
 * competent appeal letter for one denial. It will not tell you that the CO-11
 * sitting next to it must NOT be appealed: it needs a corrected claim, and
 * appealing it burns the filing window on a coding error. And it will not hold
 * 143 deadlines.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS FILE HAS A TWIN. It is a deliberate copy of lib/triage.ts in the
 * yeam_website repo, which runs the same rules client-side for the free
 * worklist. That copy must stay in the browser — the promise on the marketing
 * page is that the visitor's file never leaves their machine, so it cannot
 * become a call to this one.
 *
 * The two will drift silently if nobody is looking. When you change a CARC
 * mapping or a filing window here, change it there, and run both test suites.
 * The saved worklist telling a customer something different from the free tool
 * that sold them is the specific failure this note exists to prevent.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type Remedy =
  | "corrected_claim"
  | "reprocess"
  | "appeal"
  | "not_recoverable"
  | "unknown";

export const REMEDY_LABEL: Record<Remedy, string> = {
  corrected_claim: "Corrected claim",
  reprocess: "Reprocessing request",
  appeal: "Appeal",
  not_recoverable: "Not payer-recoverable",
  unknown: "Needs review",
};

type CarcEntry = {
  remedy: Remedy;
  /** What the payer said. */
  label: string;
  /** What to actually do about it. Shown per row — this is the useful part. */
  note: string;
};

/**
 * Claim Adjustment Reason Codes, keyed without the group prefix.
 *
 * Payers are inconsistent about whether they send CO-50, PR-50 or bare 50 for
 * the same adjustment, so the group is stripped before lookup and only used to
 * disambiguate the handful of codes whose meaning genuinely depends on it.
 *
 * The CO-11/16/18, CO-45/204, CO-50/97/151/197 assignments mirror the routing
 * already published on /architecture, which working billing managers reviewed.
 */
const CARC: Record<string, CarcEntry> = {
  "4": {
    remedy: "corrected_claim",
    label: "Procedure inconsistent with the modifier used",
    note: "Add or fix the modifier and resubmit. This is not an appeal.",
  },
  "5": {
    remedy: "corrected_claim",
    label: "Procedure inconsistent with the place of service",
    note: "Correct the POS code and resubmit.",
  },
  "6": {
    remedy: "corrected_claim",
    label: "Procedure inconsistent with the patient's age",
    note: "Check the code against the patient's age, correct and resubmit.",
  },
  "8": {
    remedy: "corrected_claim",
    label: "Procedure inconsistent with the provider type",
    note: "Verify the rendering provider and taxonomy, then resubmit.",
  },
  "11": {
    remedy: "corrected_claim",
    label: "Diagnosis inconsistent with the procedure",
    note: "Recode the diagnosis to support the procedure and resubmit. Appealing this wastes the filing window.",
  },
  "15": {
    remedy: "corrected_claim",
    label: "Authorization number missing or invalid",
    note: "Attach the correct auth number and resubmit.",
  },
  "16": {
    remedy: "corrected_claim",
    label: "Claim lacks information needed for adjudication",
    note: "Read the accompanying remark code for what is missing, then resubmit. Not an appeal.",
  },
  "18": {
    remedy: "corrected_claim",
    label: "Exact duplicate claim or service",
    note: "Confirm whether the original paid. If the services were genuinely distinct, resubmit with the appropriate modifier.",
  },
  "22": {
    remedy: "reprocess",
    label: "Covered by another payer — coordination of benefits",
    note: "Bill the primary payer first, then resubmit with the primary's EOB.",
  },
  "23": {
    remedy: "reprocess",
    label: "Prior payer's adjudication affected this payment",
    note: "Resubmit with the prior payer's remittance attached.",
  },
  "26": {
    remedy: "not_recoverable",
    label: "Expenses incurred prior to coverage",
    note: "Coverage had not started. Verify eligibility, then bill the patient or the correct payer.",
  },
  "27": {
    remedy: "not_recoverable",
    label: "Expenses incurred after coverage terminated",
    note: "Coverage had ended. Verify eligibility, then bill the patient or the correct payer.",
  },
  "29": {
    remedy: "not_recoverable",
    label: "Time limit for filing has expired",
    note: "Timely filing was missed. Only a documented proof-of-timely-filing appeal can recover this.",
  },
  "31": {
    remedy: "corrected_claim",
    label: "Patient cannot be identified as our insured",
    note: "Re-verify eligibility and the member ID, then resubmit.",
  },
  "45": {
    remedy: "reprocess",
    label: "Charge exceeds the fee schedule or contracted amount",
    note: "Usually a contractual write-off. Worth a reprocessing request only if it underpays your contracted rate.",
  },
  "50": {
    remedy: "appeal",
    label: "Not deemed medically necessary",
    note: "Appeal with the clinical documentation supporting medical necessity.",
  },
  "96": {
    remedy: "appeal",
    label: "Non-covered charges",
    note: "Check the remark code. Appeal with the plan language if the service should be covered.",
  },
  "97": {
    remedy: "appeal",
    label: "Benefit is included in another service already adjudicated",
    note: "Appeal with documentation that the service was separately identifiable.",
  },
  "109": {
    remedy: "reprocess",
    label: "Claim not covered by this payer or contractor",
    note: "Send it to the correct payer. Not an appeal against this one.",
  },
  "119": {
    remedy: "not_recoverable",
    label: "Benefit maximum for this period has been reached",
    note: "The benefit is exhausted. Bill the patient if your contract allows.",
  },
  "151": {
    remedy: "appeal",
    label: "Payer deems the information does not support this many services",
    note: "Appeal with documentation justifying the frequency or units billed.",
  },
  "167": {
    remedy: "appeal",
    label: "Diagnosis is not covered",
    note: "Appeal with the plan's coverage policy, or recode if the diagnosis was wrong.",
  },
  "197": {
    remedy: "appeal",
    label: "Precertification or authorization absent",
    note: "Appeal citing retro-authorization or the emergent nature of the service.",
  },
  "B7": {
    remedy: "appeal",
    label: "Provider not certified or eligible for this procedure on this date",
    note: "Appeal with credentialing and effective-date evidence.",
  },
  "B15": {
    remedy: "corrected_claim",
    label: "Requires a qualifying service that was not received or adjudicated",
    note: "Submit the qualifying service first, then resubmit this one.",
  },
};

/** Codes whose meaning depends on the group prefix. */
const CARC_BY_GROUP: Record<string, CarcEntry> = {
  "PR-1": {
    remedy: "not_recoverable",
    label: "Deductible",
    note: "Patient responsibility. Bill the patient — there is nothing to appeal.",
  },
  "PR-2": {
    remedy: "not_recoverable",
    label: "Coinsurance",
    note: "Patient responsibility. Bill the patient.",
  },
  "PR-3": {
    remedy: "not_recoverable",
    label: "Copay",
    note: "Patient responsibility. Bill the patient.",
  },
  "PR-204": {
    remedy: "reprocess",
    label: "Not covered under the patient's current benefit plan",
    note: "Re-verify the plan and benefit, then request reprocessing under the correct plan.",
  },
  "CO-204": {
    remedy: "reprocess",
    label: "Not covered under the patient's current benefit plan",
    note: "Re-verify the plan and benefit, then request reprocessing under the correct plan.",
  },
};

/**
 * Normalize a CARC as it appears in the wild: "CO-50", "co50", "PR 204", " 50 ".
 * Returns the group (may be empty) and the bare code, both upper-cased.
 */
export function normalizeCarc(raw: string): { group: string; code: string } {
  const cleaned = (raw ?? "").trim().toUpperCase().replace(/\s+/g, "");
  const m = cleaned.match(/^(CO|PR|OA|PI)?[-–—]?([A-Z]?\d{1,3})$/);
  if (!m) return { group: "", code: cleaned.replace(/^(CO|PR|OA|PI)[-–—]?/, "") };
  return { group: m[1] ?? "", code: m[2] };
}

export function lookupCarc(raw: string): CarcEntry | null {
  const { group, code } = normalizeCarc(raw);
  if (group && CARC_BY_GROUP[`${group}-${code}`]) return CARC_BY_GROUP[`${group}-${code}`];
  // A bare code that only has a group-specific meaning can't be resolved safely.
  if (!group && (code === "1" || code === "2" || code === "3")) return null;
  return CARC[code] ?? null;
}

/**
 * Appeal filing windows, in days from the remittance date.
 *
 * Deliberately conservative: the fallback is the shortest common window, not the
 * longest, so an unmatched payer reads as more urgent than it is rather than
 * less. A window that is wrong in the generous direction loses real money.
 * `source` lets the UI say which rows are running on a guess.
 */
const PAYER_WINDOWS: { match: RegExp; days: number; name: string }[] = [
  { match: /medicare/i, days: 120, name: "Medicare" },
  { match: /medicaid/i, days: 90, name: "Medicaid" },
  { match: /aetna/i, days: 180, name: "Aetna" },
  { match: /united|uhc|optum/i, days: 180, name: "UnitedHealthcare" },
  { match: /cigna/i, days: 180, name: "Cigna" },
  { match: /humana/i, days: 180, name: "Humana" },
  { match: /blue\s*cross|blue\s*shield|bcbs|anthem/i, days: 180, name: "BCBS" },
];

export const DEFAULT_WINDOW_DAYS = 90;
export const EXPIRING_SOON_DAYS = 14;

export function filingWindow(payer: string | undefined): {
  days: number;
  source: "payer" | "default";
  name: string;
} {
  const hit = PAYER_WINDOWS.find((p) => p.match.test(payer ?? ""));
  return hit
    ? { days: hit.days, source: "payer", name: hit.name }
    : { days: DEFAULT_WINDOW_DAYS, source: "default", name: payer || "Unknown payer" };
}

const MS_PER_DAY = 86_400_000;

/** Whole days between two dates, ignoring time of day. */
function daysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b - a) / MS_PER_DAY);
}

/**
 * Days remaining to file. `today` is always injected — never read the clock in
 * here, or every deadline test rots the moment it is written.
 */
export function daysLeft(
  denialDate: Date | null,
  payer: string | undefined,
  today: Date,
): number | null {
  if (!denialDate || Number.isNaN(denialDate.getTime())) return null;
  const { days } = filingWindow(payer);
  return days - daysBetween(denialDate, today);
}

export type ClaimRow = {
  claimNumber?: string;
  payer?: string;
  carc: string;
  billed: number;
  /** Remittance date where available, service date as the fallback. */
  denialDate: Date | null;
  cpt?: string;
  icd10?: string;
  reason?: string;
};

export type TriagedRow = ClaimRow & {
  remedy: Remedy;
  remedyLabel: string;
  carcLabel: string;
  note: string;
  daysLeft: number | null;
  windowDays: number;
  windowSource: "payer" | "default";
  expired: boolean;
  /** Worth someone's time today: a real remedy, still inside the window. */
  actionable: boolean;
};

export type Worklist = {
  rows: TriagedRow[];
  total: number;
  totalBilled: number;
  /** Billed total of the actionable rows only — the honest "at stake" number. */
  atStake: number;
  actionable: number;
  expiringSoon: number;
  expiringSoonBilled: number;
  notRecoverable: number;
  expired: number;
  unknown: number;
  byRemedy: Record<Remedy, { count: number; billed: number }>;
};

function emptyByRemedy(): Record<Remedy, { count: number; billed: number }> {
  return {
    corrected_claim: { count: 0, billed: 0 },
    reprocess: { count: 0, billed: 0 },
    appeal: { count: 0, billed: 0 },
    not_recoverable: { count: 0, billed: 0 },
    unknown: { count: 0, billed: 0 },
  };
}

export function triageRow(row: ClaimRow, today: Date): TriagedRow {
  const entry = lookupCarc(row.carc);
  const window = filingWindow(row.payer);
  const left = daysLeft(row.denialDate, row.payer, today);
  const remedy: Remedy = entry?.remedy ?? "unknown";

  // A missing date is not an expiry. Unknown deadlines stay actionable and get
  // surfaced as unknown, because silently burying them is how claims die.
  const expired = left !== null && left < 0;
  const recoverable = remedy === "corrected_claim" || remedy === "reprocess" || remedy === "appeal";

  return {
    ...row,
    remedy,
    remedyLabel: REMEDY_LABEL[remedy],
    carcLabel: entry?.label ?? row.reason ?? "Unrecognised reason code",
    note:
      entry?.note ??
      "This code is not in the public rule set. Check the remittance advice and route it by hand.",
    daysLeft: left,
    windowDays: window.days,
    windowSource: window.source,
    expired,
    actionable: recoverable && !expired,
  };
}

export function triage(rows: ClaimRow[], today: Date): Worklist {
  const triaged = rows.map((r) => triageRow(r, today));
  const byRemedy = emptyByRemedy();

  let totalBilled = 0;
  let atStake = 0;
  let actionable = 0;
  let expiringSoon = 0;
  let expiringSoonBilled = 0;
  let notRecoverable = 0;
  let expired = 0;
  let unknown = 0;

  for (const r of triaged) {
    totalBilled += r.billed;
    byRemedy[r.remedy].count += 1;
    byRemedy[r.remedy].billed += r.billed;

    if (r.remedy === "unknown") unknown += 1;
    if (r.remedy === "not_recoverable") notRecoverable += 1;
    if (r.expired) expired += 1;

    if (r.actionable) {
      actionable += 1;
      atStake += r.billed;
      if (r.daysLeft !== null && r.daysLeft <= EXPIRING_SOON_DAYS) {
        expiringSoon += 1;
        expiringSoonBilled += r.billed;
      }
    }
  }

  // Soonest deadline first — the only default sort that matches the job. Rows
  // with no date sort last rather than to the top as a fake emergency.
  triaged.sort((a, b) => {
    if (a.daysLeft === null && b.daysLeft === null) return b.billed - a.billed;
    if (a.daysLeft === null) return 1;
    if (b.daysLeft === null) return -1;
    if (a.daysLeft !== b.daysLeft) return a.daysLeft - b.daysLeft;
    return b.billed - a.billed;
  });

  return {
    rows: triaged,
    total: triaged.length,
    totalBilled,
    atStake,
    actionable,
    expiringSoon,
    expiringSoonBilled,
    notRecoverable,
    expired,
    unknown,
    byRemedy,
  };
}

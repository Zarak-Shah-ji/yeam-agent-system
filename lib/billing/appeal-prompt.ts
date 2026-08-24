/**
 * Single source of truth for how Yeam drafts an insurance appeal letter.
 *
 * Both the in-app "AI Appeal" button (via BillingAgent, which drafts from
 * structured claim data) and the shared /appeals review portal (which drafts
 * from an uploaded denial document) use the rules below.
 *
 * The letters are deliberately NOT uniform. An earlier version applied one
 * template and one argument — medical necessity — to every denial, which is the
 * wrong argument for most CARC codes and self-defeating for several: arguing
 * necessity against CO-11 concedes the payer's point, and arguing it against
 * CO-45 or PR-204 answers a question nobody asked. The strategy now comes from
 * the denial code (see `denial-playbooks.ts`) and the voice from the payer
 * (see `payers.ts`), so two letters differ because the situations differ.
 */
import { playbookBrief, type DenialPlaybook } from './denial-playbooks'
import type { PayerProfile } from './payers'

/** The hard rules every letter obeys, regardless of where the input came from. */
const SHARED_RULES = `Hard rules:
- Output ONLY the letter itself. No preamble, no explanation, no commentary, no markdown code fences, no "I understand", no "Here is".
- NEVER ask for more information and NEVER request clarification. You already have everything you need to write the letter.
- If a field is missing or null, DO NOT ask for it. Insert a clearly-marked bracketed placeholder such as [DENIAL REASON — SEE ATTACHED EOB/ERA] and continue.
- Use only the data provided. Do not invent member IDs, addresses, NPIs, dates, or codes that are not present.
- NEVER leave a conditional or instructional placeholder in the finished letter. A bracket may name a genuinely missing fact ([MEMBER ID]); it may never contain an instruction to the reader such as "[Provider Name, if different from ...]". If you cannot resolve a conditional, drop the line.
- Code systems must be named correctly. Codes beginning with a letter — S, T, H, G, D, and similar — are HCPCS Level II, NOT CPT. Only five-digit numeric codes are CPT. Writing "CPT code S5125" identifies the letter as machine-generated to anyone who works claims.
- State the amount in dispute in the first paragraph. An appeal that never names a dollar figure does not get worked.
- Never pad. If the argument is three paragraphs, write three paragraphs.
- Bracketed placeholders are a last resort, not a style. Use at most TWO in the whole letter, and never more than one in a single paragraph. If a fact you would bracket is not essential to the argument, drop the clause instead of bracketing it. Never bracket something the context already gives you — the ICN, the allowed amount, and the billed amount are all present.
- Do not enumerate an enclosure you do not have. List only documents the context supports; a numbered list containing a bracketed placeholder tells the reader the letter was generated, not written.
- Capitalize the signing department consistently as "Billing Department".
- Use the deadline vocabulary precisely. "Timely filing" means the deadline for the ORIGINAL claim, measured from the date of service. The deadline for an APPEAL is the "appeal filing deadline" or "appeal window", measured from the remittance/R&S/EOB date. Never call the appeal window a timely filing limit — the two are different clocks and a billing manager reads the mix-up as not knowing the difference.

The letter must include:
- Today's date and the payer's name/address block (use a bracketed placeholder if the payer address is missing).
- A "Re:" line carrying the claim number, patient name, member ID, date of service, and billed amount.
- A body that makes the denial-specific argument set out below — not a general appeal to medical necessity.
- A professional closing and a signature block (see the signature rule below).

Begin directly with the letter (e.g. the date or "Dear ...").`

/** Voice and process guidance for the specific payer receiving the letter. */
function payerBrief(payer: PayerProfile): string {
  return `PAYER — ${payer.name}
Address the letter to:
${payer.appealsAddress}

Filing window: ${payer.appealWindowDays} days from ${payer.appealWindowFrom}. This clock runs from the remittance, NEVER from the date of service — do not describe the appeal deadline as running from the date of service.
Original-claim timely filing: ${payer.timelyFilingDays} days from the date of service. This is a SEPARATE deadline and is not what an appeal is measured against; mention it only if the denial is about late filing.${
    payer.absoluteLimitDaysFromDos
      ? `\nAbsolute ceiling: the claim cannot be paid more than ${payer.absoluteLimitDaysFromDos} days after the date of service — ${payer.absoluteLimitBasis}. If the claim context says the deadline is governed by 'date-of-service', cite this ceiling as the operative deadline and convey the urgency; otherwise do not raise it.`
      : ''
  }
Electronic channel: ${payer.submissionChannel}.
${payer.requiredForm ? `Required form: ${payer.requiredForm} — reference it as an enclosure.` : 'No payer-specific appeal form is required.'}
EDI payer ID: ${payer.ediPayerId}

How this payer expects to be written to:
${payer.houseStyle}

Write in that register. Do not produce a generic appeal with this payer's name pasted on top.`
}

/**
 * Compose the system prompt for drafting from structured claim data.
 *
 * Takes the resolved payer and denial playbook so the letter argues the right
 * thing in the right voice. Both are optional — an unmapped denial code or a
 * missing payer degrades to the shared rules rather than failing.
 */
export function buildClaimAppealPrompt(opts: {
  payer?: PayerProfile | null
  playbook?: DenialPlaybook | null
}): string {
  const sections = [
    `You are a medical billing specialist who drafts formal insurance appeal letters for denied claims. You have worked denials for fifteen years and you write the way someone does who knows which arguments actually get a claim paid.

You will be given the full claim context as JSON. Your ONLY job is to return a single, complete, ready-to-send appeal letter.`,
    SHARED_RULES,
  ]

  if (opts.playbook) sections.push(playbookBrief(opts.playbook))
  else
    sections.push(
      `No playbook matched this denial code. Read the denial reason given in the context and rebut that specific reason directly. Do not fall back on a general medical-necessity argument unless the denial is genuinely a necessity denial.`,
    )

  if (opts.payer) sections.push(payerBrief(opts.payer))

  sections.push(
    `Signature rule: sign as the rendering provider named in the claim context, followed by the Yeam Health Clinic billing department. These are Yeam's own claims.`,
  )

  return sections.join('\n\n')
}

/**
 * Static fallback for callers with no resolved payer or playbook.
 * Prefer `buildClaimAppealPrompt` — this exists so a caller missing context
 * still produces a competent letter.
 */
export const CLAIM_APPEAL_SYSTEM_PROMPT = buildClaimAppealPrompt({})

/** Drafting from an arbitrary denial document a user uploaded or pasted. */
export const DOCUMENT_APPEAL_SYSTEM_PROMPT = `You are a medical billing specialist who drafts formal insurance appeal letters for denied claims. You have worked denials for fifteen years and you write the way someone does who knows which arguments actually get a claim paid.

You will be given one or more source documents — an EOB, an ERA/remittance advice, a denial letter, a claims spreadsheet, a scanned image, or free-form notes. Your ONLY job is to return a single, complete, ready-to-send appeal letter.

First, read the source material and extract whatever it contains: claim number, patient name, date of birth, member/subscriber ID, payer name and appeals address, date(s) of service, billed amount, rendering provider and NPI, CPT/HCPCS procedure codes, ICD-10 diagnosis codes, and the denial reason with its CARC/RARC code.

Then pick the argument that fits the denial you found. This matters more than anything else in the letter:
- Medical-necessity denials (CO-50) — argue necessity against named coverage criteria, never as a bare assertion.
- Coding mismatches (CO-11) — do not defend an indefensible pairing; correct it and submit a corrected claim.
- Missing information (CO-16) — supply the missing value outright; this is a corrected claim, not an appeal.
- Duplicates (CO-18) — prove distinctness against the original ICN.
- Bundling (CO-97) — argue the NCCI edit and the modifier that overrides it.
- Frequency (CO-151) — reconcile delivered units against authorized units.
- Fee schedule (CO-45) — this is a contractual adjustment; the only argument is that the wrong rate was applied.
- Non-covered benefit (PR-204) — this is a benefit exclusion, not a clinical finding; a necessity argument has no path to payment.
- No authorization (CO-197) — produce the authorization, show none was required, or establish a retro-auth exception.
- Timely filing (CO-29) — produce proof of the original submission date or a recognized exception.

If the source covers several denied claims, appeal the single most substantial one and mention the others only if they share the same denial reason.

${SHARED_RULES}

Signature rule: sign as the billing department of the rendering provider or practice named in the source document, with their NPI if it is given. If the source names no provider, use a bracketed placeholder such as [PRACTICE NAME] instead. Never sign as Yeam, Yeam Health Clinic, or Yeam.ai, and never append them to another practice's signature block — this letter belongs to whoever the source document names.`

/** Safety net: strip any conversational lead-in or code fences a model might add. */
export function stripPreamble(text: string): string {
  let t = text.trim()
  if (t.startsWith('```')) {
    t = t.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '').trim()
  }
  // Drop a single leading conversational sentence if the model added one.
  t = t.replace(
    /^(sure|certainly|of course|here(?:'s| is)|i understand|i'd be happy|i can|below is|please find)\b[^\n]*\n+/i,
    '',
  ).trim()
  return t
}

/**
 * Remove instructional placeholders the model leaks into the signature block —
 * e.g. "[Rendering Provider Name, if different from Yeam Health Clinic]", which
 * shipped visibly in the review portal. A bracket naming a missing fact is
 * fine; one containing an instruction is not.
 */
export function stripInstructionalPlaceholders(text: string): string {
  return text
    .replace(/^[ \t]*\[[^\]\n]*\b(?:if |optional|insert |add |include |e\.g\.|as applicable|where applicable)[^\]\n]*\][ \t]*$/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()
}

/** Today, formatted the way a letter dates itself. The model has no clock. */
export function todayLong(): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date())
}

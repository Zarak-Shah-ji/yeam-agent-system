import { GEMINI_AVAILABLE, getModel } from '@/lib/ai/gemini-client'
import {
  ARTIFACT_LABELS,
  artifactFor,
  buildClaimAppealPrompt,
  stripInstructionalPlaceholders,
  stripPreamble,
  todayLong,
} from '@/lib/billing/appeal-prompt'
import { getPlaybook } from '@/lib/billing/denial-playbooks'
import { PAYERS, type PayerProfile } from '@/lib/billing/payers'
import { refineDenial, refinementBrief } from './rarc'
import { triageRow, type ClaimRow } from './triage'

/**
 * Drafting the right document for one row of a saved worklist.
 *
 * The in-app "AI Appeal" button drafts from a Claim row via buildAppealContext,
 * which reads patient name, member ID and the full clinical record. A worklist
 * row has none of that on purpose — see lib/denials/parse-claims.ts. So this
 * composes the same prompt from what a de-identified row does carry, and is
 * explicit with the model about why the identifiers are absent.
 */

/**
 * Bind a free-text payer name to a payer profile — but only when it is safe to.
 *
 * The profiles in lib/billing/payers.ts are Texas plans, carrying Texas appeals
 * addresses, windows and forms. A CSV that says "Blue Cross" might be BCBS of
 * Michigan, and putting a Texas PO box on that appeal sends it into a void. A
 * letter with no address block is recoverable; one with a confidently wrong
 * address is not, and the biller has no reason to double-check it.
 *
 * So: match only when the row names the state or the plan itself. Everything
 * else drafts without a payer profile, which the prompt already degrades to.
 */
const TEXAS_HINT = /\b(texas|tx|tmhp|star\+?plus|star\s*kids)\b/i

const PAYER_FAMILIES: { key: string; match: RegExp }[] = [
  { key: 'TX_MEDICAID', match: /\b(medicaid|tmhp|star)\b/i },
  { key: 'BCBSTX', match: /\b(blue\s*cross|blue\s*shield|bcbs)\b/i },
  { key: 'AETNA_TX', match: /\baetna\b/i },
  { key: 'UHC_TX', match: /\b(united\s*health|unitedhealthcare|uhc)\b/i },
  { key: 'CIGNA', match: /\bcigna\b/i },
]

export function resolveTexasPayer(payerName: string | null | undefined): PayerProfile | null {
  const name = payerName?.trim()
  if (!name) return null

  const family = PAYER_FAMILIES.find(f => f.match.test(name))
  if (!family) return null

  // Cigna's profile carries no state-specific appeals routing, so a bare
  // "Cigna" is safe. The rest must say Texas before we assert a Texas address.
  if (family.key !== 'CIGNA' && !TEXAS_HINT.test(name)) return null

  return PAYERS.find(p => p.key === family.key) ?? null
}

/**
 * The identifiers this workspace deliberately does not hold.
 *
 * Without this the model obeys the shared two-placeholder cap, and quietly drops
 * the patient identifier block to stay under it — producing a letter no payer
 * can match to a claim. Here the brackets are the correct output, and the biller
 * fills them from their own system before sending.
 */
const DEIDENTIFIED_ADDENDUM = `
DE-IDENTIFIED SOURCE — READ BEFORE DRAFTING.
This claim comes from a worklist that holds no patient identifiers by design: no
name, no member ID, no date of birth. Their absence is a deliberate privacy
property of the source, NOT an oversight and NOT something to comment on.

Therefore, for this document only:
- Include the normal identifier block and use bracketed placeholders for exactly
  the identifiers that are missing: [PATIENT NAME], [MEMBER ID], [DATE OF BIRTH]
  if the document type calls for it, and [PRACTICE NAME] in the signature.
- The "at most two bracketed placeholders" rule does NOT apply to that block.
  It still applies everywhere else: never bracket a fact the context gives you,
  and never bracket an instruction.
- Do not remark on the missing identifiers, do not add a note explaining them,
  and do not ask for them. Draft as though they will be filled in before sending.
`

export interface DenialRowFacts {
  claimNumber?: string | null
  payer?: string | null
  carc: string
  billed: number
  denialDate: Date | null
  cpt?: string | null
  icd10?: string | null
  reason?: string | null
}

export interface DraftedResponse {
  artifact: string
  artifactLabel: string
  body: string
  summary: {
    claimNumber: string | null
    payerName: string | null
    denialCode: string
    denialReason: string | null
    billedAmount: number
    daysRemaining: number | null
    remedy: string
    artifactType: string
    artifactLabel: string
  }
}

function toClaimRow(row: DenialRowFacts): ClaimRow {
  return {
    claimNumber: row.claimNumber ?? undefined,
    payer: row.payer ?? undefined,
    carc: row.carc,
    billed: row.billed,
    denialDate: row.denialDate,
    cpt: row.cpt ?? undefined,
    icd10: row.icd10 ?? undefined,
    reason: row.reason ?? undefined,
  }
}

/**
 * Draft the document this denial actually calls for.
 *
 * artifactFor() decides which instrument from the denial code — a CO-11 gets a
 * corrected claim, not an appeal. Sending the wrong one burns the filing window,
 * which is the failure the whole product exists to prevent.
 */
export async function draftResponseForRow(
  row: DenialRowFacts,
  today: Date = new Date(),
): Promise<DraftedResponse> {
  if (!GEMINI_AVAILABLE) {
    throw new Error('Drafting is not configured on this deployment (missing GEMINI_API_KEY).')
  }

  const triaged = triageRow(toClaimRow(row), today)
  const playbook = getPlaybook(row.carc)
  const payer = resolveTexasPayer(row.payer)
  const artifact = artifactFor(playbook)
  const artifactLabel = ARTIFACT_LABELS[artifact]

  // What the remittance said underneath a vague code. Without this a CO-16
  // transmittal says "information was missing" when the remark code said which
  // information — which is the difference between a document a payer can act on
  // and one that gets denied again the same way.
  const refinement = refineDenial({ carc: row.carc, reason: row.reason })

  const context = {
    claimNumber: row.claimNumber ?? null,
    payer: payer?.name ?? row.payer ?? null,
    payerProfileResolved: Boolean(payer),
    denialCode: row.carc,
    denialReason: row.reason ?? triaged.carcLabel,
    // Null unless the remittance actually resolved the vagueness. The prompt
    // must not be handed a guess dressed as a finding.
    resolvedDefect: refinementBrief(refinement),
    remarkCode: refinement?.rarc ?? null,
    payerAllowsAppeal: refinement?.noAppealRights ? false : null,
    billedAmount: row.billed,
    dateOfService: row.denialDate ? row.denialDate.toISOString().slice(0, 10) : null,
    procedureCode: row.cpt ?? null,
    diagnosisCode: row.icd10 ?? null,
    remedy: triaged.remedyLabel,
    filingWindowDays: triaged.windowDays,
    // The number that makes a biller act today rather than next month.
    daysRemainingToFile: triaged.daysLeft,
    deadlineIsEstimated: triaged.windowSource === 'default',
  }

  const model = getModel(buildClaimAppealPrompt({ payer, playbook }) + DEIDENTIFIED_ADDENDUM)
  const result = await model.generateContent({
    contents: [
      {
        role: 'user',
        parts: [
          {
            text:
              `Today's date is ${todayLong()}. Use it as the document date.\n\n` +
              `Draft the ${artifactLabel.toLowerCase()} now from this claim context. ` +
              `Output the document text only — do not ask any questions.\n\n` +
              JSON.stringify(context, null, 2),
          },
        ],
      },
    ],
    generationConfig: { temperature: 0.3 },
  })

  const body = stripInstructionalPlaceholders(stripPreamble(result.response.text()))

  return {
    artifact,
    artifactLabel,
    body,
    summary: {
      claimNumber: row.claimNumber ?? null,
      payerName: payer?.name ?? row.payer ?? null,
      denialCode: row.carc,
      denialReason: row.reason ?? triaged.carcLabel,
      billedAmount: row.billed,
      daysRemaining: triaged.daysLeft,
      remedy: triaged.remedyLabel,
      artifactType: artifact,
      artifactLabel,
    },
  }
}

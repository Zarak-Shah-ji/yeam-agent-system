import { GEMINI_AVAILABLE, getModel } from '@/lib/ai/gemini-client'
import { stripPreamble } from '@/lib/billing/appeal-prompt'
import type { CodeSignals } from './code-signals'

/**
 * Reading one claim's coding back to a biller, in words.
 *
 * The model narrates; it does not decide. Everything it is allowed to say has
 * already been computed by lib/claims/code-signals.ts from the practice's own
 * settled claims and from what the payer said on the remittance. The prompt's
 * whole job is keeping it inside that: a model handed a CPT and an ICD-10 will
 * cheerfully opine on whether they belong together, and in a billing product
 * that opinion is indistinguishable from advice to upcode.
 *
 * The hard limit, stated to the model and stated on screen: this server holds no
 * clinical documentation. No chart note, no PHI — by design, see the schema
 * header. So nothing here can know what was actually done at the visit, and
 * every suggestion is a candidate for a coder to check against the chart.
 */

const SYSTEM_PROMPT = `You are a certified medical coder reviewing one claim line for a billing team.

WHAT YOU ARE GIVEN
A JSON object of facts already computed from this practice's own claims data and
from the payer's remittance. It is the only evidence you have.

WHAT YOU MUST NOT DO
- Do not suggest any CPT or ICD-10 code that is not in the facts you were given.
  You have no chart note, no clinical documentation and no patient record — you
  cannot know what was performed, so you cannot propose a code from knowledge.
- Do not state or imply that a code is wrong unless the payer's own reason code
  says so, or this practice's own data shows that pairing being denied.
- Do not quote a rate without the number of claims behind it.
- Do not recommend a higher-paying code on the grounds that it pays more. If the
  data supports a different diagnosis, say what the data shows and stop there.
- Never say a claim "should" be recoded. Say what the evidence shows and leave
  the decision with the coder.

WHAT TO WRITE
Four short sections, plain text, no markdown headers, no preamble:

1. What happened — one or two sentences on this claim's status and, if it was
   denied, what the payer said in plain English.
2. What the data shows — the practice's own history for this procedure and payer.
   Always with sample sizes. If the sample is thin, lead with that.
3. Codes worth checking — the candidate diagnoses from the facts, each with its
   paid rate and sample size, and a sentence on why it is listed. If there are
   none, say so rather than inventing any.
4. What to do next — the concrete next action. If the payer named a defect, the
   remedy from the playbook is the action. If nothing in the evidence supports a
   change, say the coding looks supported and move on.

Under 220 words. Write for a working biller: direct, no hedging language, no
consultant register. End with one line reminding them the chart is the authority
and this review never saw it.`

export type ClaimReviewContext = {
  claimNumber: string | null
  status: string
  billed: number
  paid: number | null
  allowed: number | null
  balance: number
  signals: CodeSignals
  /** What the payer said, when it said anything. Already resolved by the router. */
  denial: {
    code: string
    label: string | null
    note: string | null
    remedy: string | null
    payerPosition: string | null
    strategy: string | null
    avoid: string | null
    daysLeft: number | null
  } | null
}

export class ReviewUnavailableError extends Error {}

/**
 * Ask the model to read the computed facts back.
 *
 * Non-streaming and temperature 0.3, matching every other generation path in
 * the app — a review that reads differently each time it is opened is a review
 * nobody trusts.
 */
export async function reviewClaim(context: ClaimReviewContext): Promise<string> {
  if (!GEMINI_AVAILABLE) {
    throw new ReviewUnavailableError(
      'Code review is not configured on this deployment (missing GEMINI_API_KEY).',
    )
  }

  const model = getModel(SYSTEM_PROMPT)
  const result = await model.generateContent({
    contents: [
      {
        role: 'user',
        parts: [
          {
            text:
              'Review this claim from the facts below. Use nothing else.\n\n' +
              JSON.stringify(context, null, 2),
          },
        ],
      },
    ],
    generationConfig: { temperature: 0.3 },
  })

  return stripPreamble(result.response.text()).trim()
}

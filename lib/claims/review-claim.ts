import { GEMINI_AVAILABLE, getModel } from '@/lib/ai/gemini-client'
import { stripPreamble } from '@/lib/billing/appeal-prompt'
import type { CodeSignals } from './code-signals'
import { LEAVE_AS_BILLED, type Verdict } from './predict'

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

export const SYSTEM_PROMPT = `You are a certified medical coder reviewing one claim line for a billing team.

WHAT YOU ARE GIVEN
A JSON object of facts already computed from this practice's own claims data and
from the payer's remittance. It is the only evidence you have.

THE VERDICT IS NOT YOURS TO MAKE
When the facts carry a \`verdict\`, that is the decision, and it was not made by a
model that could invent an answer: it was made by a constrained model that could
only return one of a fixed set of options built from this practice's own settled
claims. Your job is to explain it to a biller, not to check it.

- The only ICD-10 codes you may write are the ones in \`verdict.allowedCodes\`.
  Not a candidate outside that list, not one from the history, not one you know
  from training. If a code is not in that list, it does not appear in your answer.
- Say what the verdict says. If \`verdict.bestIcd10.choice\` is ${LEAVE_AS_BILLED},
  the diagnosis as billed stands — do not then go on to offer an alternative.
- \`verdict.denyAgain.probability\` is a chance, not an outcome. Write it as a
  chance, in words, and never round it into a certainty.
- \`verdict.remedy\` is the recommended remedy. Where the reason-code playbook in
  \`denial.remedy\` points somewhere else, say both and say they disagree. Do not
  quietly pick one.
- A judgment marked \`asked: false\` was not answered because the evidence it
  needs does not exist. Repeat its \`because\` line and stop. Do not answer it
  yourself from anything else in the facts.
- With no \`verdict\` at all, say in one line that no prediction was available,
  then describe only the computed facts. Absence of a verdict is not licence to
  supply one.

WHAT YOU MUST NOT DO
- Do not suggest any CPT or ICD-10 code that is not in \`verdict.allowedCodes\` —
  or, when there is no verdict, not in the facts you were given. You have no
  chart note, no clinical documentation and no patient record — you cannot know
  what was performed, so you cannot propose a code from knowledge.
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
3. The verdict — what the constrained model chose and how confident it was, in
   that order, with the sample sizes behind the option it chose. If the
   diagnosis question was not asked, say why in one sentence and move on.
4. What to do next — the concrete next action. If the payer named a defect, the
   remedy from the playbook is the action. If nothing in the evidence supports a
   change, say the coding looks supported and move on.

Under 220 words. Write for a working biller: direct, no hedging language, no
consultant register. End with one line reminding them the chart is the authority
and this review never saw it.`

export type ClaimReviewContext = {
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
  /**
   * The decision this prose explains. Null when TypeSafe is unconfigured or the
   * call failed — the prompt has a branch for that, and it is today's behaviour,
   * correctly labelled rather than silently the same.
   */
  verdict: Verdict | null
}

export class ReviewUnavailableError extends Error {}

/**
 * The model wrote a code it was not allowed to write, twice.
 *
 * Separate from ReviewUnavailableError because it means something different: the
 * feature is configured and working, and the output was rejected. The router
 * must not cache a body that broke the constraint — a review served from cache
 * for a month is exactly how one bad suggestion becomes a habit.
 */
export class ReviewOffMapError extends Error {}

/**
 * ICD-10-CM shape: a letter (never U, which is reserved), a digit, an
 * alphanumeric, then optionally a dot and up to four more.
 *
 * Deliberately cannot match the things that legitimately appear in this prose:
 * a CPT is five digits, a CARC renders as "CO-11", and a dollar figure has no
 * leading letter. The cost of a false positive here is a spurious retry; the
 * cost of a false negative is an invented diagnosis on a corrected claim.
 */
const ICD10 = /\b[A-TV-Z][0-9][0-9A-Z](?:\.[0-9A-Z]{1,4})?\b/g

/**
 * Codes in the prose that the verdict never authorised.
 *
 * The prompt above asks the model not to do this. This is what checks. A
 * constraint that lives only in a prompt is a request, and the entire point of
 * routing the decision through a bounded model was to stop relying on requests.
 */
export function offMapCodes(body: string, allowed: string[]): string[] {
  const permitted = new Set(allowed.map(c => c.toUpperCase()))
  const found = body.toUpperCase().match(ICD10) ?? []
  return [...new Set(found.filter(code => !permitted.has(code)))]
}

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

  const ask = async (correction?: string) => {
    const result = await model.generateContent({
      contents: [
        {
          role: 'user',
          parts: [
            {
              text:
                'Review this claim from the facts below. Use nothing else.\n\n' +
                JSON.stringify(context, null, 2) +
                (correction ? `\n\n${correction}` : ''),
            },
          ],
        },
      ],
      generationConfig: { temperature: 0.3 },
    })
    return stripPreamble(result.response.text()).trim()
  }

  const body = await ask()

  // No verdict, nothing to check against: the prompt's no-verdict branch asks
  // it to describe only the computed facts, which is the behaviour this path
  // has always had.
  if (!context.verdict) return body

  const stray = offMapCodes(body, context.verdict.allowedCodes)
  if (stray.length === 0) return body

  // Once. A model that names a code it was not given usually drops it when the
  // specific code is quoted back; a second failure is a real one, and guessing
  // a third time just spends tokens on the same answer.
  const retry = await ask(
    `Your previous answer named ${stray.join(', ')}, which ${stray.length === 1 ? 'is' : 'are'} ` +
      `not in verdict.allowedCodes. Rewrite it using only these codes: ` +
      `${context.verdict.allowedCodes.join(', ') || 'none — name no ICD-10 code at all'}.`,
  )

  if (offMapCodes(retry, context.verdict.allowedCodes).length > 0) {
    throw new ReviewOffMapError(
      'The written review could not be kept to the codes in your own history. The computed figures and the prediction above are unaffected.',
    )
  }

  return retry
}

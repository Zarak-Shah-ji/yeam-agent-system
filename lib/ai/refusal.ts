import { FinishReason } from '@google/generative-ai'

/**
 * Telling a refusal apart from an answer.
 *
 * The assistant is the one surface where the model talks to a customer in its
 * own voice, and two different things can come back looking like prose: an
 * answer, and the model explaining that it will not give one. Only the first is
 * worth showing without a way out.
 *
 * This lives here rather than in lib/billing/appeal-prompt.ts on purpose.
 * stripPreamble() there does a related job for letters — it removes a
 * conversational opener from a document — and it is covered by
 * __tests__/revise-appeal.test.ts. Widening its regex to catch refusals would
 * put the drafting path at risk to fix a chat problem. Two small functions, two
 * blast radii.
 */

/**
 * Openers that mean the model declined, rather than answered.
 *
 * Deliberately anchored to the start of the text and to the first person. A
 * letter that contains "the payer cannot deny this on CO-50" is an answer; a
 * reply that opens "I cannot look up patient records" is not. Matching anywhere
 * in the body would flag the first one, which is the answer we most want.
 */
const REFUSAL_OPENER =
  /^\W*(?:i(?:'m| am)?\s+(?:cannot|can't|can not|unable|not able|afraid)|i\s+do\s?n[o']t\s+have\s+(?:access|the|any)|unfortunately,?\s+i|as an ai|sorry,?\s+(?:but\s+)?i\s+(?:cannot|can't|do))/i

/**
 * True when a reply reads as a refusal rather than an answer.
 *
 * Used to mark the turn as an error so the Retry affordance appears. It is not
 * used to suppress or rewrite the text — the user still sees exactly what came
 * back, they just get a way to ask again.
 */
export function looksLikeRefusal(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  // Only the opening sentence decides. A long answer that ends with a caveat
  // about what the data cannot show is a good answer.
  return REFUSAL_OPENER.test(trimmed)
}

/**
 * Why a generation stopped, in words a biller can act on — or null when it
 * stopped normally.
 *
 * Nothing inspected finishReason before this, so a blocked or truncated
 * generation arrived as an empty string and was stored as the assistant's
 * answer. An empty bubble with no error and no retry is the worst of the three
 * possible outcomes, because it looks like the product has nothing to say.
 */
export function finishReasonMessage(reason: FinishReason | undefined): string | null {
  switch (reason) {
    case undefined:
    case FinishReason.STOP:
    case FinishReason.FINISH_REASON_UNSPECIFIED:
      return null
    case FinishReason.MAX_TOKENS:
      return 'The answer ran past its length limit. Ask for a narrower slice — one payer, or one denial code.'
    case FinishReason.SAFETY:
    case FinishReason.PROHIBITED_CONTENT:
    case FinishReason.BLOCKLIST:
      return 'The model stopped on a content filter. Clinical wording in a denial can trip it — try rephrasing the question.'
    case FinishReason.SPII:
      return 'The model stopped because the reply looked like it carried personal identifiers. This workspace holds none, so this is worth reporting.'
    case FinishReason.RECITATION:
      return 'The model stopped because the reply was reproducing source material. Try asking for it in your own framing.'
    case FinishReason.MALFORMED_FUNCTION_CALL:
      return 'The model built a malformed request to the workspace. Retrying usually clears it.'
    default:
      return 'The model stopped before finishing. Retrying usually clears it.'
  }
}

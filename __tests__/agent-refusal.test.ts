import { describe, it, expect } from 'vitest'
import { FinishReason } from '@google/generative-ai'
import { looksLikeRefusal, finishReasonMessage } from '@/lib/ai/refusal'

describe('looksLikeRefusal', () => {
  it('catches the openers a declining model actually uses', () => {
    for (const text of [
      "I cannot look up individual patients in this workspace.",
      "I can't help with that.",
      "I'm unable to access the patient record.",
      "I am not able to modify claims.",
      "I don't have access to that information.",
      "I do not have the ability to send an appeal.",
      "Unfortunately, I can only read the data.",
      "As an AI, I cannot give medical advice.",
      "Sorry, but I cannot mark that row as worked.",
    ]) {
      expect(looksLikeRefusal(text), text).toBe(true)
    }
  })

  it('leaves real answers alone', () => {
    for (const text of [
      'Aetna denied 14 claims for $8,420. Work CLM-4471 first — it expires Friday.',
      'The workspace has no rows matching "Cigna". Import a file on the Connect data page.',
      'Nothing expires in the next 7 days.',
      '0 denials are currently at stake.',
    ]) {
      expect(looksLikeRefusal(text), text).toBe(false)
    }
  })

  it('does not flag an answer that merely mentions what a payer cannot do', () => {
    // The word "cannot" belongs in denial work. Only a first-person opener counts.
    expect(
      looksLikeRefusal('The payer cannot deny this on CO-50 once the policy criteria are cited.'),
    ).toBe(false)
  })

  it('does not flag a good answer that ends with a caveat', () => {
    expect(
      looksLikeRefusal(
        'Aetna is your worst payer at a 31% denial rate. I cannot break that down by provider — the export carries no provider column.',
      ),
    ).toBe(false)
  })

  it('treats empty text as not-a-refusal, so the empty-answer path owns it', () => {
    expect(looksLikeRefusal('')).toBe(false)
    expect(looksLikeRefusal('   \n  ')).toBe(false)
  })
})

describe('finishReasonMessage', () => {
  it('stays silent when the model stopped normally', () => {
    expect(finishReasonMessage(undefined)).toBeNull()
    expect(finishReasonMessage(FinishReason.STOP)).toBeNull()
    expect(finishReasonMessage(FinishReason.FINISH_REASON_UNSPECIFIED)).toBeNull()
  })

  it('explains every abnormal stop rather than returning an empty answer', () => {
    for (const reason of [
      FinishReason.MAX_TOKENS,
      FinishReason.SAFETY,
      FinishReason.RECITATION,
      FinishReason.BLOCKLIST,
      FinishReason.PROHIBITED_CONTENT,
      FinishReason.SPII,
      FinishReason.MALFORMED_FUNCTION_CALL,
      FinishReason.OTHER,
      FinishReason.LANGUAGE,
    ]) {
      const message = finishReasonMessage(reason)
      expect(message, reason).toBeTruthy()
      expect(message!.length, reason).toBeGreaterThan(20)
    }
  })
})

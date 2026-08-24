import { GEMINI_AVAILABLE, getModel } from '@/lib/agents/gemini-client'
import { DOCUMENT_APPEAL_SYSTEM_PROMPT, stripPreamble, todayLong } from './appeal-prompt'

/** A chunk of source material handed to the model: extracted text or a raw file. */
export type SourcePart =
  | { kind: 'text'; label: string; text: string }
  | { kind: 'media'; label: string; mimeType: string; data: string }

export interface DraftFromDocumentInput {
  parts: SourcePart[]
  /** Free-form notes the reviewer typed alongside (or instead of) a file. */
  notes?: string
}

/**
 * Draft an appeal letter from arbitrary uploaded source material.
 *
 * Mirrors the model configuration BillingAgent uses for claim-based appeals
 * (gemini-2.5-flash, temperature 0.3, same output contract) so a letter drafted
 * here is indistinguishable from one drafted by the in-app "AI Appeal" button.
 */
export async function draftAppealFromDocument({
  parts,
  notes,
}: DraftFromDocumentInput): Promise<string> {
  if (!GEMINI_AVAILABLE) {
    throw new Error('Appeal drafting is not configured on this deployment (missing GEMINI_API_KEY).')
  }
  if (parts.length === 0 && !notes?.trim()) {
    throw new Error('Provide a file or some notes to draft an appeal from.')
  }

  const contentParts: ({ text: string } | { inlineData: { mimeType: string; data: string } })[] = [
    {
      text:
        `Today's date is ${todayLong()}. Use it as the letter date.\n\n` +
        'Draft the appeal letter now from the source material below. ' +
        'Output the letter text only — do not ask any questions.',
    },
  ]

  for (const part of parts) {
    if (part.kind === 'text') {
      contentParts.push({ text: `\n--- SOURCE: ${part.label} ---\n${part.text}` })
    } else {
      contentParts.push({ text: `\n--- SOURCE: ${part.label} ---` })
      contentParts.push({ inlineData: { mimeType: part.mimeType, data: part.data } })
    }
  }

  if (notes?.trim()) {
    contentParts.push({ text: `\n--- ADDITIONAL NOTES FROM THE BILLING TEAM ---\n${notes.trim()}` })
  }

  const model = getModel(DOCUMENT_APPEAL_SYSTEM_PROMPT)
  const result = await model.generateContent({
    contents: [{ role: 'user', parts: contentParts }],
    generationConfig: { temperature: 0.3 },
  })

  const letter = stripPreamble(result.response.text())
  if (!letter) throw new Error('The model returned an empty letter. Try again with clearer source material.')
  return letter
}

import { GoogleGenerativeAI } from '@google/generative-ai'

/**
 * The one place a Gemini model is constructed.
 *
 * There used to be three factories here — getModel, getFlashModel and
 * getProModel — and all three returned gemini-2.5-flash. getProModel was
 * documented as the "high-capability model" and was not one, which is the kind
 * of thing that gets reasoned about for an hour when output quality drops.
 * getFlashModel existed for the chat route's intent classifier, which is gone.
 *
 * One model, named after what it actually is. Change MODEL here and every
 * drafting path moves together.
 */

export const GEMINI_AVAILABLE = !!process.env.GEMINI_API_KEY

const MODEL = 'gemini-2.5-flash'

let client: GoogleGenerativeAI | null = null

export function getModel(systemInstruction: string) {
  if (!client) client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
  return client.getGenerativeModel({ model: MODEL, systemInstruction })
}

import {
  GoogleGenerativeAI,
  HarmBlockThreshold,
  HarmCategory,
  type GenerationConfig,
  type SafetySetting,
} from '@google/generative-ai'

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

/**
 * Generation defaults, set here rather than per call site.
 *
 * Every drafting path already passed `temperature: 0.3` by hand and the chat
 * route passed nothing at all — so the one surface a customer talks to ran at
 * the provider default of roughly 1.0 while everything else ran at 0.3. That is
 * a setting you can only forget once per call site, so it stops being a call
 * site's business.
 *
 * maxOutputTokens is generous rather than tuned: an appeal letter runs to a few
 * thousand tokens and a truncated letter is worse than a slow one. It exists so
 * a runaway generation has a ceiling, not to shape the output.
 */
const DEFAULT_GENERATION: GenerationConfig = {
  temperature: 0.3,
  maxOutputTokens: 8192,
}

/**
 * Denial work is written in the vocabulary of injury, drugs and death, because
 * that is what the claims are for. At Gemini's default thresholds a legitimate
 * appeal for an opioid-dependence or self-harm admission can come back blocked —
 * a candidate with no parts, which reads downstream as an empty answer rather
 * than as an error. BLOCK_ONLY_HIGH keeps the genuinely abusive cases blocked
 * and stops clinical language from tripping the filter.
 */
const SAFETY: SafetySetting[] = [
  HarmCategory.HARM_CATEGORY_HARASSMENT,
  HarmCategory.HARM_CATEGORY_HATE_SPEECH,
  HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
  HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
].map(category => ({ category, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH }))

let client: GoogleGenerativeAI | null = null

export function getModel(
  systemInstruction: string,
  generationConfig: Partial<GenerationConfig> = {},
) {
  if (!client) client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
  return client.getGenerativeModel({
    model: MODEL,
    systemInstruction,
    generationConfig: { ...DEFAULT_GENERATION, ...generationConfig },
    safetySettings: SAFETY,
  })
}

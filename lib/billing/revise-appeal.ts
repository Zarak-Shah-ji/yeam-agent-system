import { GEMINI_AVAILABLE, getModel } from '@/lib/agents/gemini-client'
import {
  DOCUMENT_APPEAL_REVISE_PROMPT,
  REVISE_MARKER,
  stripInstructionalPlaceholders,
  stripPreamble,
  todayLong,
} from './appeal-prompt'

/** One turn of the conversation about a draft. */
export interface ReviseTurn {
  role: 'user' | 'assistant'
  text: string
}

export interface ReviseAppealInput {
  /** The current full draft. Replaced wholesale by the result. */
  letter: string
  /** What the caller wants changed. */
  instruction: string
  /** Earlier turns, oldest first, so "make that shorter too" resolves. */
  history?: ReviseTurn[]
}

export interface ReviseAppealResult {
  letter: string
  /** One line for the chat thread. Empty when the model omitted it. */
  reply: string
}

/** Turns kept for context; the caller trims too, this is the backstop. */
const MAX_HISTORY = 12

/**
 * Split the model's reply into its summary line and the letter.
 *
 * The marker is the only structure asked for, and a model that ignores it
 * still produces a usable letter — so a missing marker is treated as "the
 * whole thing is the letter" rather than an error. Shipping a letter with no
 * chat line beats failing a revision the biller can already read.
 */
export function splitRevision(raw: string): ReviseAppealResult {
  const at = raw.indexOf(REVISE_MARKER)
  if (at === -1) {
    return { letter: stripPreamble(raw), reply: '' }
  }
  const head = raw.slice(0, at)
  const body = raw.slice(at + REVISE_MARKER.length)
  const reply = head.replace(/^\s*SUMMARY:\s*/i, '').trim()
  return { letter: stripPreamble(body), reply }
}

/**
 * Apply one instruction to an existing draft and return the next version.
 *
 * Mirrors draftAppealFromDocument's model configuration so a revised letter is
 * held to the same standard as the first draft — same model, same temperature,
 * same output cleanup.
 */
export async function reviseAppealLetter({
  letter,
  instruction,
  history = [],
}: ReviseAppealInput): Promise<ReviseAppealResult> {
  if (!GEMINI_AVAILABLE) {
    throw new Error('Appeal drafting is not configured on this deployment (missing GEMINI_API_KEY).')
  }
  if (!letter.trim()) throw new Error('Provide the draft to revise.')
  if (!instruction.trim()) throw new Error('Provide an instruction describing the change.')

  const priorTurns = history
    .slice(-MAX_HISTORY)
    .map(t => `${t.role === 'user' ? 'Colleague' : 'You'}: ${t.text}`)
    .join('\n')

  const prompt =
    `Today's date is ${todayLong()}. Keep the letter dated today.\n\n` +
    (priorTurns ? `--- EARLIER IN THIS CONVERSATION ---\n${priorTurns}\n\n` : '') +
    `--- CURRENT DRAFT ---\n${letter.trim()}\n\n` +
    `--- REQUESTED CHANGE ---\n${instruction.trim()}`

  const model = getModel(DOCUMENT_APPEAL_REVISE_PROMPT)
  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.3 },
  })

  const split = splitRevision(result.response.text())
  const revised = stripInstructionalPlaceholders(split.letter)
  if (!revised) {
    throw new Error('The model returned an empty letter. Try the instruction again.')
  }
  return { letter: revised, reply: split.reply }
}

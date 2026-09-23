/**
 * The same two facts, written for a model that is revising rather than drafting.
 *
 * A revision only ever sees the letter and the instruction, so without this the
 * note is invisible to every version after the first — the biller who wrote down
 * what the payer said, then asked for the letter to be shorter, would get a
 * shorter letter that had forgotten the call.
 *
 * Returns null when there is nothing to say, so the prompt omits the section
 * rather than carrying a heading over an empty body.
 *
 * Alone in its own file, with no imports, for two reasons. The router needs it
 * and so does the browser: the "Note is in the prompt" chip in the work panel
 * reveals on hover the exact text that will be sent, and "exact" is only
 * truthful if it is this function and not a second rendering of the same idea
 * that drifts from it. draft-response.ts, where this used to live, pulls in the
 * Gemini client and cannot be imported by a client component.
 */
export function standingContext(row: {
  note: string | null
  followUpAt: Date | null
}): string | null {
  const parts: string[] = []
  const note = row.note?.trim()
  if (note) parts.push(`Note from the biller working this claim:\n${note}`)
  if (row.followUpAt) {
    parts.push(
      `The practice intends to follow up on ${row.followUpAt.toISOString().slice(0, 10)}. ` +
        `This is their own diary date, not a deadline the payer agreed to.`,
    )
  }
  return parts.length ? parts.join('\n\n') : null
}

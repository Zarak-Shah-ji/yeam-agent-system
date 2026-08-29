import { describe, it, expect } from 'vitest'
import { splitRevision } from '@/lib/billing/revise-appeal'
import { REVISE_MARKER } from '@/lib/billing/appeal-prompt'

describe('splitRevision', () => {
  it('separates the summary line from the letter', () => {
    const raw = [
      'SUMMARY: Cut the third paragraph and tightened the closing.',
      REVISE_MARKER,
      'March 3, 2026',
      '',
      'Dear Appeals Department,',
    ].join('\n')

    const { letter, reply } = splitRevision(raw)
    expect(reply).toBe('Cut the third paragraph and tightened the closing.')
    expect(letter.startsWith('March 3, 2026')).toBe(true)
    expect(letter).not.toContain(REVISE_MARKER)
    expect(letter).not.toContain('SUMMARY')
  })

  it('treats the whole reply as the letter when the marker is missing', () => {
    // A model that ignores the output contract still produced a usable letter.
    // Failing the revision over a missing marker would be worse than shipping
    // it with no chat line.
    const raw = 'March 3, 2026\n\nDear Appeals Department,'
    const { letter, reply } = splitRevision(raw)
    expect(reply).toBe('')
    expect(letter).toBe(raw)
  })

  it('tolerates a missing SUMMARY prefix before the marker', () => {
    const raw = `Tightened the closing.\n${REVISE_MARKER}\nDear Appeals Department,`
    expect(splitRevision(raw).reply).toBe('Tightened the closing.')
  })

  it('strips a code fence the model wrapped the letter in', () => {
    const raw = `SUMMARY: Shortened it.\n${REVISE_MARKER}\n\`\`\`\nDear Appeals Department,\n\`\`\``
    expect(splitRevision(raw).letter).toBe('Dear Appeals Department,')
  })

  it('yields an empty letter when there is nothing after the marker', () => {
    // The caller turns this into a 502 rather than handing back a blank draft.
    expect(splitRevision(`SUMMARY: nothing\n${REVISE_MARKER}\n   `).letter).toBe('')
  })
})

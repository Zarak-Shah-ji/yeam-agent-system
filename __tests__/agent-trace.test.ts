import { describe, it, expect } from 'vitest'
import { buildTraceStep, parseTrace } from '@/lib/ai/trace'
import { titleFrom } from '@/lib/ai/conversations'

/**
 * The trace is the claim the UI makes about where an answer came from, so it
 * has to be read off the tool result and never inferred. These assert the two
 * ways that goes wrong: a number that was not returned, and a source named for
 * a tool that does not have one.
 */

describe('buildTraceStep', () => {
  it('reports the arguments the model chose', () => {
    const step = buildTraceStep(
      'worklist_rows',
      { payer: 'Aetna', search: 'CO-97', limit: 10 },
      { rows: [{}, {}, {}], totalMatched: 23 },
    )

    expect(step.args).toEqual([
      { name: 'payer', value: 'Aetna' },
      { name: 'search', value: 'CO-97' },
      { name: 'limit', value: '10' },
    ])
    expect(step.count).toBe(3)
    expect(step.total).toBe(23)
  })

  it('omits the total when it adds nothing', () => {
    // "10 of 10" is noise, and worse, reads as if something were held back.
    const step = buildTraceStep('worklist_rows', {}, { rows: Array(10).fill({}), totalMatched: 10 })
    expect(step.total).toBeNull()
  })

  it('leaves out arguments the model did not pass', () => {
    const step = buildTraceStep('worklist_rows', { payer: '', limit: undefined }, { rows: [] })
    expect(step.args).toEqual([])
  })

  it('names the import only for the tool that reads a snapshot', () => {
    const overview = buildTraceStep(
      'workspace_overview',
      {},
      { snapshotFilename: 'ar_aging.csv', snapshotAt: new Date('2026-08-12T00:00:00Z') },
    )
    // Kept as an ISO string so the rail can format it in the reader's
    // timezone; formatting here would use the server's, which is UTC in prod.
    expect(overview.source).toEqual({
      filename: 'ar_aging.csv',
      at: '2026-08-12T00:00:00.000Z',
    })

    // worklist_rows spans every batch. Naming one file would be a lie of
    // specificity, so there is no source line at all.
    const rows = buildTraceStep('worklist_rows', {}, { rows: [{}] })
    expect(rows.source).toBeNull()
  })

  it('survives a snapshot date that did not serialize as a Date', () => {
    const step = buildTraceStep(
      'workspace_overview',
      {},
      { snapshotFilename: 'ar_aging.csv', snapshotAt: '2026-08-12T00:00:00Z' },
    )
    expect(step.source?.at).toBe('2026-08-12T00:00:00.000Z')
  })

  it('still names the file when the snapshot has no usable date', () => {
    const step = buildTraceStep(
      'workspace_overview',
      {},
      { snapshotFilename: 'ar_aging.csv', snapshotAt: 'not a date' },
    )
    expect(step.source).toEqual({ filename: 'ar_aging.csv', at: null })
  })

  it('carries the truncation caveat rather than presenting a floor as a total', () => {
    const step = buildTraceStep('workspace_overview', {}, { partial: true })
    expect(step.caveat).toMatch(/floor/)
  })

  it('says a search found nothing, quoting what was searched for', () => {
    const step = buildTraceStep(
      'worklist_rows',
      { search: 'A-9999' },
      { rows: [], totalMatched: 0, searchedFor: 'a-9999' },
    )
    expect(step.count).toBe(0)
    expect(step.caveat).toContain('a-9999')
  })
})

describe('parseTrace', () => {
  it('round-trips what buildTraceStep produced', () => {
    const step = buildTraceStep('top_denial_reasons', { limit: 5 }, { reasons: [{}, {}] })
    expect(parseTrace(JSON.parse(JSON.stringify([step])))).toHaveLength(1)
  })

  it('returns nothing for a column that was never written or holds junk', () => {
    // Prisma types a Json column as unknown, and rows predating the trace have
    // null there. Neither may throw on the way to the screen.
    expect(parseTrace(null)).toEqual([])
    expect(parseTrace({ tool: 'worklist_rows' })).toEqual([])
    expect(parseTrace([{ nope: true }, 'string'])).toEqual([])
  })
})

describe('titleFrom', () => {
  it('uses the question as asked when it is short', () => {
    expect(titleFrom('  what should I work on today? ')).toBe('what should I work on today?')
  })

  it('cuts a long question at a word boundary', () => {
    const title = titleFrom(
      'which payer is denying the most money this quarter and what is the single biggest reason',
    )
    expect(title.length).toBeLessThanOrEqual(61)
    expect(title.endsWith('…')).toBe(true)
    expect(title).not.toMatch(/\s…$/)
  })

  it('cuts mid-word rather than throwing most of the title away', () => {
    // One 80-character word has no boundary to cut at. Truncating to the last
    // space would leave an empty title.
    expect(titleFrom('a'.repeat(80))).toBe(`${'a'.repeat(60)}…`)
  })

  it('names an empty question rather than titling a conversation with nothing', () => {
    expect(titleFrom('   ')).toBe('New conversation')
  })

  it('flattens newlines, which a textarea makes easy to paste in', () => {
    expect(titleFrom('why was\n\nA-1042   denied')).toBe('why was A-1042 denied')
  })
})

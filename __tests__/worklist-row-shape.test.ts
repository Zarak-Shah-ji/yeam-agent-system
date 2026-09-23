import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildWorklistRow,
  compareWorklistRows,
  WORKLIST_ROW_KEYS,
  type PersistedDenialRow,
} from '@/lib/denials/worklist-row'

/**
 * The compiler cannot guard this seam.
 *
 * components/worklist/types.ts declares WorklistRow by hand, and WorklistView
 * casts the query result through `as unknown as WorklistRow[]`. A field added to
 * the builder and forgotten in the type is invisible to TypeScript and arrives
 * as `undefined` in a table cell. These tests are the substitute.
 */

const ROW: PersistedDenialRow = {
  id: 'row_1',
  status: 'TO_WORK',
  note: 'Called Aetna, they want the op note',
  claimNumber: 'AET-2026-90114',
  payer: 'Aetna',
  carc: 'CO-50',
  billed: 1240.5,
  denialDate: new Date('2026-08-01'),
  cpt: '99213',
  icd10: 'M54.5',
  reason: 'Not medically necessary',
  lastTouchedAt: new Date('2026-09-01'),
  reconciledAt: null,
  practiceId: null,
  followUpAt: new Date('2026-10-01'),
}

const TODAY = new Date('2026-09-15')

const build = (over: Partial<PersistedDenialRow> = {}, draftCount = 0) =>
  buildWorklistRow({ ...ROW, ...over }, { today: TODAY, payerMedianDaysToPay: 30, draftCount })

describe('buildWorklistRow', () => {
  it('emits exactly the keys WORKLIST_ROW_KEYS declares', () => {
    const actual = Object.keys(build()).sort()
    const declared = [...WORKLIST_ROW_KEYS].sort()
    expect(actual).toEqual(declared)
  })

  it('matches the hand-written client type field for field', () => {
    // The whole reason this file exists. If this fails, the router and
    // components/worklist/types.ts have drifted and the cast is hiding it.
    const source = readFileSync(
      join(process.cwd(), 'components/worklist/types.ts'),
      'utf8',
    )
    const body = source.slice(source.indexOf('export type WorklistRow = {'))
    const declared = [...body.matchAll(/^\s{2}(\w+)\??:/gm)].map(m => m[1])

    expect(new Set(declared)).toEqual(new Set(WORKLIST_ROW_KEYS))
  })

  it('keeps the biller note and the CARC guidance as separate fields', () => {
    // `note` from triageRow is remedy guidance; `userNote` is what the biller
    // typed. Collapsing them would put boilerplate in the letter prompt.
    const row = build()
    expect(row.userNote).toBe('Called Aetna, they want the op note')
    expect(row.note).not.toBe(row.userNote)
    expect(row.note.length).toBeGreaterThan(0)
  })

  it('carries the draft count it was handed', () => {
    expect(build({}, 3).draftCount).toBe(3)
  })

  it('reports the later of the two clocks as changedAt', () => {
    // A human touch and a machine reconcile answer different questions
    // everywhere else in the product. For "has this moved since I looked" they
    // are the same question, and the later one is the answer.
    const human = new Date('2026-09-01')
    const machine = new Date('2026-09-10')
    expect(build({ lastTouchedAt: human, reconciledAt: machine }).changedAt).toEqual(machine)
    expect(build({ lastTouchedAt: machine, reconciledAt: human }).changedAt).toEqual(machine)
    expect(build({ lastTouchedAt: null, reconciledAt: machine }).changedAt).toEqual(machine)
    expect(build({ lastTouchedAt: human, reconciledAt: null }).changedAt).toEqual(human)
    expect(build({ lastTouchedAt: null, reconciledAt: null }).changedAt).toBeNull()
  })
})

describe('compareWorklistRows', () => {
  const row = (score: number, daysLeft: number | null, billed: number, id: string) =>
    ({ score, daysLeft, billed, id })

  it('ranks by score first', () => {
    expect(compareWorklistRows(row(80, 5, 100, 'a'), row(40, 1, 999, 'b'))).toBeLessThan(0)
  })

  it('breaks a score tie on the nearer deadline, then on money', () => {
    expect(compareWorklistRows(row(50, 3, 100, 'a'), row(50, 9, 100, 'b'))).toBeLessThan(0)
    expect(compareWorklistRows(row(50, 3, 900, 'a'), row(50, 3, 100, 'b'))).toBeLessThan(0)
  })

  it('sinks rows with no known deadline below rows that have one', () => {
    expect(compareWorklistRows(row(50, null, 100, 'a'), row(50, 30, 100, 'b'))).toBeGreaterThan(0)
    expect(compareWorklistRows(row(50, 30, 100, 'a'), row(50, null, 100, 'b'))).toBeLessThan(0)
  })

  it('is a TOTAL order — id breaks every remaining tie', () => {
    // Without this, paging over the sorted array skips and duplicates rows.
    expect(compareWorklistRows(row(50, 3, 100, 'a'), row(50, 3, 100, 'b'))).toBeLessThan(0)
    expect(compareWorklistRows(row(50, 3, 100, 'b'), row(50, 3, 100, 'a'))).toBeGreaterThan(0)
    expect(compareWorklistRows(row(50, 3, 100, 'a'), row(50, 3, 100, 'a'))).toBe(0)
  })

  it('never returns 0 for two genuinely different rows', () => {
    const rows = [
      row(50, null, 100, 'a'),
      row(50, null, 100, 'b'),
      row(50, 3, 100, 'c'),
      row(70, 3, 100, 'd'),
    ]
    for (const x of rows) {
      for (const y of rows) {
        if (x.id !== y.id) expect(compareWorklistRows(x, y), `${x.id} vs ${y.id}`).not.toBe(0)
      }
    }
  })

  it('sorts a list stably into the same order regardless of input order', () => {
    const rows = [
      row(50, 3, 100, 'c'), row(70, 9, 50, 'a'), row(50, null, 800, 'd'), row(50, 3, 100, 'b'),
    ]
    const forward = [...rows].sort(compareWorklistRows).map(r => r.id)
    const backward = [...rows].reverse().sort(compareWorklistRows).map(r => r.id)
    expect(forward).toEqual(backward)
    expect(forward).toEqual(['a', 'b', 'c', 'd'])
  })
})

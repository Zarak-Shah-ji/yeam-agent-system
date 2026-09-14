import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  SEARCHABLE_FIELDS,
  looksConversational,
  matchesSearch,
  normalizeQuery,
  searchWhere,
  type SearchableField,
} from '@/lib/denials/search'

/**
 * The worklist filters in SQL; the assistant filters the facts it already has.
 * Two notions of "matches" that disagree would have the assistant reporting a
 * claim as missing while the table renders it, so the agreement is pinned here
 * rather than left to whoever edits one of them next.
 */

type Row = Partial<Record<SearchableField, string | null>>

/** Evaluate the Prisma fragment the way Postgres would, so both halves can be compared. */
function sqlWouldMatch(row: Row, q: string): boolean {
  const where = searchWhere(q)
  if (!('OR' in where)) return true // no query: the fragment adds no predicate
  return where.OR.some(clause => {
    const [field, filter] = Object.entries(clause)[0] as [SearchableField, { contains: string }]
    return (row[field] ?? '').toLowerCase().includes(filter.contains.toLowerCase())
  })
}

const ROWS: Row[] = [
  { claimNumber: 'CLM-10422', payer: 'Aetna Better Health', carc: 'CO-197', cpt: '99213', icd10: 'M54.5', reason: 'Precertification absent' },
  { claimNumber: 'clm-99001', payer: 'UnitedHealthcare', carc: 'CO-16', cpt: '20610', icd10: null, reason: null },
  { claimNumber: null, payer: null, carc: 'PR-204', cpt: null, icd10: null, reason: 'Not covered under the plan' },
]

const QUERIES = ['CLM-10422', 'clm', 'aetna', 'CO-16', '99213', 'm54', 'precert', 'plan', 'zzz', '', '   ']

describe('the SQL filter and the in-memory filter agree', () => {
  it.each(QUERIES)('%j selects the same rows either way', q => {
    for (const row of ROWS) {
      expect({ q, row: row.carc, sql: sqlWouldMatch(row, q) }).toEqual({
        q,
        row: row.carc,
        sql: matchesSearch(row, q),
      })
    }
  })

  it('reads every searchable column and only those', () => {
    const where = searchWhere('x')
    expect('OR' in where && where.OR.map(c => Object.keys(c)[0])).toEqual([...SEARCHABLE_FIELDS])
  })
})

describe('searchWhere is safe to spread into a scoped where clause', () => {
  it('adds no predicate at all for an empty query', () => {
    // It must not narrow to nothing, and it must never be the only thing in a
    // where clause — the orgId filter it is spread beside is the tenant boundary.
    for (const blank of ['', '   ', null, undefined]) {
      expect(searchWhere(blank)).toEqual({})
    }
  })

  it('matches case-insensitively on a substring', () => {
    const where = searchWhere('AeTnA')
    expect('OR' in where && where.OR[1]).toEqual({
      payer: { contains: 'AeTnA', mode: 'insensitive' },
    })
  })
})

describe('normalizeQuery', () => {
  it('trims, collapses whitespace and caps the length', () => {
    expect(normalizeQuery('  CLM  10422 ')).toBe('CLM 10422')
    expect(normalizeQuery(null)).toBe('')
    expect(normalizeQuery('x'.repeat(500))).toHaveLength(120)
  })
})

describe('looksConversational tells a question from an identifier', () => {
  it.each(['CLM-10422', 'aetna', 'CO-197', 'united healthcare', '99213'])(
    '%j is something to filter by',
    q => expect(looksConversational(q)).toBe(false),
  )

  it.each([
    'why is aetna denying us?',
    'which payer costs us the most',
    'show me everything expiring this week',
    'what should I work on first',
    'find claim CLM-10422',
  ])('%j is something to ask', q => expect(looksConversational(q)).toBe(true))

  it('offers nothing for an empty box', () => {
    expect(looksConversational('  ')).toBe(false)
  })
})

describe('the searchable columns exist on the row they filter', () => {
  // A field renamed in the schema would make every search on it silently miss
  // rather than fail, which is the worst way for a search box to break.
  const SCHEMA = readFileSync(join(__dirname, '..', 'prisma', 'schema.prisma'), 'utf8')
  const body = SCHEMA.match(/\nmodel DenialRow \{([\s\S]*?)\n\}/)![1]

  it.each(SEARCHABLE_FIELDS)('DenialRow.%s is a string column', field => {
    expect(body).toMatch(new RegExp(`^\\s*${field}\\s+String\\??\\s*$`, 'm'))
  })
})

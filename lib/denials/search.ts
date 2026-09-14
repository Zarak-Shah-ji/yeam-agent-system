/**
 * What "search" means on the worklist.
 *
 * A biller looking for one claim knows one thing about it — the claim number
 * off a payer letter, the payer's name, a CARC they were told to appeal. This
 * matches any of those against the columns the row actually has.
 *
 * There are two callers and they must agree. The Worklist page filters in SQL,
 * because a claim outside the top-priority slice still has to be findable; the
 * assistant filters in memory, over the facts it already loaded. Two
 * hand-written notions of "matches" would drift the first time a column is
 * added, and the symptom would be the assistant swearing a claim does not exist
 * while the table two inches away is showing it. So both read SEARCHABLE_FIELDS
 * and both go through this file.
 *
 * Every field here is de-identified by construction — a claim number, a plan, a
 * code. There is deliberately no patient name to search on, which is the whole
 * reason the workspace needs no BAA; see __tests__/no-phi-columns.test.ts.
 */

/** The columns a search reads. Both filters below are derived from this list. */
export const SEARCHABLE_FIELDS = [
  'claimNumber',
  'payer',
  'carc',
  'cpt',
  'icd10',
  'reason',
] as const

export type SearchableField = (typeof SEARCHABLE_FIELDS)[number]

/** Long enough for a denial reason fragment, short enough not to be a payload. */
const MAX_QUERY = 120

/**
 * Trim, collapse the whitespace, cap the length.
 *
 * Returns '' for anything that carries no query, so callers have one thing to
 * test rather than juggling undefined, null and '   '.
 */
export function normalizeQuery(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY)
}

type Insensitive = { contains: string; mode: 'insensitive' }

/**
 * The SQL half: a Prisma `where` fragment, or nothing at all.
 *
 * Spread into an existing where clause — it never carries an orgId and must
 * never be the only thing in one. Case-insensitive substring on every
 * searchable column, which is what someone typing half a payer name expects.
 */
export function searchWhere(
  raw: string | null | undefined,
): { OR: Array<Partial<Record<SearchableField, Insensitive>>> } | Record<string, never> {
  const q = normalizeQuery(raw)
  if (!q) return {}
  return {
    OR: SEARCHABLE_FIELDS.map(field => ({
      [field]: { contains: q, mode: 'insensitive' as const },
    })),
  }
}

/** The in-memory half. Same fields, same case-insensitive substring rule. */
export function matchesSearch(
  row: Partial<Record<SearchableField, string | null | undefined>>,
  raw: string | null | undefined,
): boolean {
  const q = normalizeQuery(raw).toLowerCase()
  if (!q) return true
  return SEARCHABLE_FIELDS.some(field => (row[field] ?? '').toLowerCase().includes(q))
}

/**
 * Words that open a question rather than name a thing.
 *
 * "aetna" is a filter. "why is aetna denying us" is not — no substring match
 * will ever answer it, and leaving the biller staring at an empty table is the
 * failure this exists to catch.
 */
const OPENERS = new Set([
  'why', 'what', 'which', 'who', 'when', 'where', 'how',
  'show', 'find', 'list', 'give', 'tell', 'explain', 'summarize', 'summarise',
  'is', 'are', 'do', 'does', 'did', 'can', 'should', 'any', 'top',
])

/**
 * Does this read as a question rather than an identifier?
 *
 * The worklist asks this to decide whether to offer the handoff to the
 * assistant. It is a hint, never a redirect: the literal filter runs on every
 * keystroke either way, so a false positive costs one muted line of UI and a
 * false negative still leaves the offer that appears when nothing matched.
 */
export function looksConversational(raw: string | null | undefined): boolean {
  const q = normalizeQuery(raw)
  if (!q) return false
  if (q.includes('?')) return true
  const words = q.split(' ')
  if (words.length >= 4) return true
  return words.length >= 2 && OPENERS.has(words[0].toLowerCase())
}

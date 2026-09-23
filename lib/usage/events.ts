/**
 * What may be recorded about how the product is used, and nothing else.
 *
 * The claim detail dialog was built on an argument rather than a measurement:
 * that a biller opening a claim is asking "is this worth my next twenty
 * minutes", and that the balance, the filing clock and whether a colleague has
 * already chased it are the three facts that answer it. That argument may be
 * wrong. If most opened claims end at the drafter without a section ever being
 * expanded, the dialog is a speed bump on the way there and the fix is routing,
 * not wording.
 *
 * Nothing in the product could tell the difference. This is the smallest thing
 * that can.
 *
 * TWO RULES, both enforced here rather than trusted to callers:
 *
 *  1. THE NAME IS A CLOSED ENUM. It is `UsageEventName` in the schema, so the
 *     database itself refuses an event nobody planned for.
 *  2. THE DETAIL IS A CLOSED LIST PER NAME. This is the half a schema cannot
 *     do. `detail` is a String column, one careless call away from carrying a
 *     claim number — which is the one thing this table must never hold, because
 *     a counter that can be joined back to named people is not a counter any
 *     more. `permittedDetail` is the whitelist, and the router drops a row
 *     whose detail is not on it rather than storing it.
 *
 * Pure and dependency-free so the rule is testable without a database, the same
 * way lib/claims/section-summary.ts is.
 */

/** Mirrors `enum UsageEventName` in prisma/schema.prisma. */
export type UsageEventName = 'CLAIM_OPENED' | 'CLAIM_SECTION_OPENED' | 'CLAIM_TO_DRAFTER'

/**
 * Every value `detail` is allowed to take, per event.
 *
 * An empty list means the event carries no detail at all — `CLAIM_OPENED` is
 * just a count, and a qualifier on it would only ever be a claim.
 *
 * The section ids match `SectionId` in components/claims/detail/types.ts plus
 * `figures`, which is the "All the figures" disclosure on the money line. That
 * one is not a section in the URL sense but it is the single most diagnostic
 * click on the screen: somebody opening the figures grid is reconciling against
 * a payer portal, not triaging, and those two jobs want different layouts.
 */
export const PERMITTED_DETAIL: Record<UsageEventName, readonly string[]> = {
  CLAIM_OPENED: [],
  CLAIM_SECTION_OPENED: ['denial', 'codes', 'work', 'figures', 'history'],
  // Where the jump started. `list` is a click straight from a table row,
  // `detail` is the button inside the dialog. The ratio between them is the
  // whole reason this table exists.
  CLAIM_TO_DRAFTER: ['list', 'detail'],
}

/**
 * Whether this pair may be stored.
 *
 * A name with no permitted details accepts a missing detail and nothing else. A
 * name with a list accepts exactly those strings — not a prefix, not a
 * lowercased match, not a trimmed one. Anything approximate here is a way for
 * an identifier to arrive slightly misspelled and be kept.
 */
export function isRecordable(name: string, detail: string | null | undefined): boolean {
  // Object.hasOwn, not `in`: `'toString' in PERMITTED_DETAIL` is true through
  // the prototype chain, and Function.prototype.toString has a `length` of 0 —
  // so the whitelist lookup below would find it, read it as "takes no detail",
  // and record an event named after a built-in.
  if (!Object.hasOwn(PERMITTED_DETAIL, name)) return false
  const allowed = PERMITTED_DETAIL[name as UsageEventName]
  if (detail === null || detail === undefined) return allowed.length === 0
  return allowed.includes(detail)
}

/**
 * What the assistant actually did, in a form the rail can render.
 *
 * The chat used to show a fixed string per tool name — "📋 Looking up claims..."
 * — which said that *a* tool ran and nothing about what it was asked or what
 * came back. A biller acting on "you have 23 Aetna denials at CO-97" needs to
 * see the query that produced 23 and the import those rows are from, because
 * the answer is only as current as the file someone last uploaded.
 *
 * Every field here is read off the tool call and its result. Nothing is the
 * model's account of its own thinking: a paraphrase that sounds like reasoning
 * but is generated after the fact is worse than no trace, because it cannot be
 * checked against anything.
 */
export interface TraceStep {
  tool: string
  /** Past tense, because by the time this renders the call has returned. */
  label: string
  /** The arguments the model chose, rendered for display. */
  args: Array<{ name: string; value: string }>
  /** Rows or reasons handed back. Null when the tool returns a single object. */
  count: number | null
  /** Everything that matched, when the tool returned only the first page. */
  total: number | null
  /**
   * Which upload the numbers came from.
   *
   * The timestamp stays an ISO string rather than a formatted date because
   * this is built on the server — in production, a server running in UTC. A
   * file uploaded at 5pm Pacific would render as the following day. The
   * component formats it in the reader's own timezone.
   */
  source: { filename: string; at: string | null } | null
  /** Why the result is less than the whole truth. */
  caveat: string | null
}

const LABELS: Record<string, string> = {
  workspace_overview: 'Read the workspace totals',
  top_denial_reasons: 'Ranked denial reasons by money',
  worklist_rows: 'Read the worklist',
}

/** The same label mid-flight, before there is a result to build a step from. */
export function labelFor(tool: string): string {
  return LABELS[tool] ?? `Called ${tool}`
}

/** Arguments worth showing, in display order, with the label a biller reads. */
const ARG_LABELS: Record<string, string> = {
  payer: 'payer',
  search: 'search',
  limit: 'limit',
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function arrayLength(value: unknown): number | null {
  return Array.isArray(value) ? value.length : null
}

/**
 * The upload the numbers came from.
 *
 * Only `workspace_overview` carries the snapshot, because it is the only tool
 * whose answer is a point-in-time total. The worklist tools read every batch,
 * so naming one file there would be a lie of specificity.
 */
function sourceOf(result: Record<string, unknown>): TraceStep['source'] {
  const filename = str(result.snapshotFilename)
  if (!filename) return null

  const raw = result.snapshotAt
  const date = raw instanceof Date ? raw : typeof raw === 'string' ? new Date(raw) : null
  const at = date && !Number.isNaN(date.getTime()) ? date.toISOString() : null

  return { filename, at }
}

function caveatOf(tool: string, result: Record<string, unknown>): string | null {
  if (result.partial === true) {
    return 'The import was truncated — these totals are a floor, not a total.'
  }
  if (tool === 'top_denial_reasons' && arrayLength(result.reasons) === 0) {
    return 'No denials imported yet.'
  }
  if (tool === 'worklist_rows' && arrayLength(result.rows) === 0) {
    return str(result.searchedFor)
      ? `Nothing in the worklist matches "${str(result.searchedFor)}".`
      : 'No open denials in the worklist.'
  }
  return null
}

/** Turn one executed tool call into the step the UI shows under the answer. */
export function buildTraceStep(
  tool: string,
  args: Record<string, unknown>,
  result: Record<string, unknown>,
): TraceStep {
  const returned = arrayLength(result.rows) ?? arrayLength(result.reasons)
  const total = num(result.totalMatched)

  return {
    tool,
    label: labelFor(tool),
    args: Object.entries(ARG_LABELS)
      .filter(([key]) => args[key] !== undefined && args[key] !== null && args[key] !== '')
      .map(([key, label]) => ({ name: label, value: String(args[key]) })),
    count: returned,
    // Only when it adds something: "10 of 10" is noise.
    total: total !== null && returned !== null && total > returned ? total : null,
    source: sourceOf(result),
    caveat: caveatOf(tool, result),
  }
}

/** Narrow the Json column back to steps. Shape-checked, since Prisma types it `unknown`. */
export function parseTrace(value: unknown): TraceStep[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (step): step is TraceStep =>
      !!step &&
      typeof step === 'object' &&
      typeof (step as TraceStep).tool === 'string' &&
      typeof (step as TraceStep).label === 'string' &&
      Array.isArray((step as TraceStep).args),
  )
}

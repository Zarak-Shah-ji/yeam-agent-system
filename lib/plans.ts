/**
 * What a plan can do.
 *
 * OrgPlan has existed in the schema since workspaces shipped and gated nothing.
 * This is its first consumer: file upload is on every plan, direct database and
 * EHR connections are not, because each one is an integration someone has to
 * build and maintain for a specific customer.
 */

export type Plan = 'TRIAGE' | 'PRACTICE' | 'GROUP' | 'NETWORK'

export const PLAN_LABEL: Record<Plan, string> = {
  TRIAGE: 'Triage',
  PRACTICE: 'Practice',
  GROUP: 'Group',
  NETWORK: 'Network',
}

/**
 * Direct connections are a custom-plan feature.
 *
 * Deliberately a denylist of the self-serve tiers rather than an allowlist, so a
 * plan added later is gated by default and someone has to decide to open it.
 */
export function canUseDirectConnections(plan: string): boolean {
  return plan !== 'TRIAGE' && plan !== 'PRACTICE'
}

export type Connector = {
  id: string
  name: string
  category: 'EHR' | 'Database' | 'File feed'
  blurb: string
}

/** What a customer can ask to be connected to. */
export const CONNECTORS: Connector[] = [
  { id: 'athenahealth', name: 'athenahealth', category: 'EHR', blurb: 'Pull denials and A/R straight from athenaCollector.' },
  { id: 'ecw', name: 'eClinicalWorks', category: 'EHR', blurb: 'Scheduled export of claims and remittances from eCW.' },
  { id: 'advancedmd', name: 'AdvancedMD', category: 'EHR', blurb: 'Nightly claims and denial feed from AdvancedMD.' },
  { id: 'kareo', name: 'Tebra (Kareo)', category: 'EHR', blurb: 'Read the A/R ledger without exporting by hand.' },
  { id: 'postgres', name: 'PostgreSQL / MySQL', category: 'Database', blurb: 'Read-only credentials against your own reporting database.' },
  { id: 'snowflake', name: 'Snowflake / BigQuery', category: 'Database', blurb: 'Query the warehouse your billing data already lands in.' },
  { id: 'sftp835', name: 'SFTP 835 drop', category: 'File feed', blurb: 'Drop raw remittance files and have them read on arrival.' },
]

/**
 * How many denials a plan may work per calendar month. null = uncapped.
 *
 * A denial is "worked" once a document has been drafted for it, which
 * DenialWorkedEvent already records once per row no matter how many times the
 * letter is redrafted. That is the meter because it is the thing that costs a
 * model call and the thing the customer is actually buying — not rows uploaded.
 * Capping the import instead would wall the largest practices first, before
 * they had recovered a dollar, and would truncate the analytics into numbers
 * that understate their own book.
 */
export const DENIALS_PER_MONTH: Record<Plan, number | null> = {
  TRIAGE: 10,
  PRACTICE: null,
  GROUP: null,
  NETWORK: null,
}

/**
 * The AI code review is a paid model call. TRIAGE keeps claims.signals, which
 * is the same evidence computed with no model call at all, so the free tier
 * loses the prose and none of the substance.
 */
export function canReviewCodes(plan: string): boolean {
  return plan !== 'TRIAGE'
}

export type Allowance = {
  plan: Plan
  limit: number | null
  used: number
  remaining: number | null
  atLimit: boolean
}

/**
 * What is left this month. Pure — the count and the plan are both injected, so
 * this holds no clock and no database and can be read straight in a test.
 *
 * An unknown plan string falls back to the free allowance rather than to
 * uncapped: a plan we cannot recognise must not be a way to buy nothing and get
 * everything.
 */
export function draftAllowance(plan: string, used: number): Allowance {
  const known = (plan in DENIALS_PER_MONTH ? plan : 'TRIAGE') as Plan
  const limit = DENIALS_PER_MONTH[known]
  return {
    plan: known,
    limit,
    used,
    remaining: limit === null ? null : Math.max(0, limit - used),
    atLimit: limit !== null && used >= limit,
  }
}

/**
 * Marker prefix on every refusal that a payment would fix.
 *
 * The client needs to tell "upgrade to continue" apart from every other error,
 * and a tRPC code cannot carry that on its own: FORBIDDEN is already claimed by
 * isNoWorkspace() (components/insights/NoWorkspace.tsx), which would render an
 * entitlement wall as "this account has no workspace" — wrong, and not something
 * the reader could act on. So the intent travels in the message, explicitly.
 *
 * Routers build the TRPCError themselves; this module is imported by client
 * components and must not pull @trpc/server into the browser bundle.
 */
export const UPGRADE_REQUIRED = 'UPGRADE_REQUIRED'

/** Prefix a refusal so isUpgradeRequired() can find it on the other side. */
export function upgradeMessage(reason: string): string {
  return `${UPGRADE_REQUIRED}: ${reason}`
}

/** True when a tRPC error is an entitlement wall rather than a real failure. */
export function isUpgradeRequired(
  error: { message?: string | null } | null | undefined,
): boolean {
  return typeof error?.message === 'string' && error.message.startsWith(`${UPGRADE_REQUIRED}:`)
}

/** The refusal without its machine-readable prefix, for display. */
export function upgradeReason(error: { message?: string | null } | null | undefined): string {
  if (!isUpgradeRequired(error)) return ''
  return (error?.message ?? '').slice(UPGRADE_REQUIRED.length + 2)
}

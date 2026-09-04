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

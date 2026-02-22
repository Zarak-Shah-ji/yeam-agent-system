export type AgentName = 'front-desk' | 'clinical-doc' | 'claim-scrubber' | 'billing' | 'analytics'

export interface AgentTask {
  id: string
  intent: string
  context: Record<string, unknown>
  userId: string
  sessionId: string
}

export type AgentEventStatus = 'thinking' | 'working' | 'complete' | 'escalated' | 'error'

export interface AgentEvent {
  taskId: string
  agentName: AgentName
  status: AgentEventStatus
  message: string
  data?: unknown
  confidence?: number
  reasoning?: string
  timestamp: Date
}

export interface Agent {
  name: AgentName
  canHandle(task: AgentTask): boolean
  execute(task: AgentTask): AsyncGenerator<AgentEvent>
}

// Map to Prisma enum values
export const agentNameToPrisma: Record<AgentName, string> = {
  'front-desk': 'FRONT_DESK',
  'clinical-doc': 'CLINICAL_DOC',
  'claim-scrubber': 'CLAIM_SCRUBBER',
  'billing': 'BILLING',
  'analytics': 'ANALYTICS',
}

export const agentStatusToPrisma: Record<AgentEventStatus, string> = {
  'thinking': 'THINKING',
  'working': 'WORKING',
  'complete': 'COMPLETE',
  'escalated': 'ESCALATED',
  'error': 'ERROR',
}

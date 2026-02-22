import { randomUUID } from 'crypto'
import type { Agent, AgentEvent, AgentTask } from './types'
import { FrontDeskAgent } from './front-desk-agent'
import { AnalyticsAgent } from './analytics-agent'
import { ClinicalDocAgent } from './clinical-doc-agent'
import { ClaimScrubberAgent } from './claim-scrubber-agent'
import { BillingAgent } from './billing-agent'

// Priority order: most specific first, catch-all (FrontDesk) last
const agents: Agent[] = [
  new AnalyticsAgent(),
  new ClinicalDocAgent(),
  new ClaimScrubberAgent(),
  new BillingAgent(),
  new FrontDeskAgent(),
]

export async function dispatch(
  intent: string,
  context: Record<string, unknown> = {},
  userId: string = 'anonymous',
  sessionId: string = randomUUID(),
): Promise<AsyncGenerator<AgentEvent>> {
  const task: AgentTask = { id: randomUUID(), intent, context, userId, sessionId }
  const agent = agents.find(a => a.canHandle(task))

  if (!agent) {
    return (async function* (): AsyncGenerator<AgentEvent> {
      yield {
        taskId: task.id,
        agentName: 'front-desk',
        status: 'escalated',
        message: `No agent available for "${intent}". Logged for review.`,
        timestamp: new Date(),
      }
    })()
  }

  return agent.execute(task)
}

import { prisma } from '@/lib/db'
import type { Agent, AgentEvent, AgentTask, AgentEventStatus, AgentName } from './types'
import { agentNameToPrisma, agentStatusToPrisma } from './types'

export abstract class BaseAgent implements Agent {
  abstract name: AgentName
  abstract canHandle(task: AgentTask): boolean
  protected abstract _execute(task: AgentTask): AsyncGenerator<AgentEvent>

  async *execute(task: AgentTask): AsyncGenerator<AgentEvent> {
    const startTime = Date.now()
    let lastEvent: AgentEvent | null = null

    try {
      for await (const event of this._execute(task)) {
        lastEvent = event

        // Log to DB (fire-and-forget, don't block streaming)
        this.logEvent(event, task, Date.now() - startTime).catch(console.error)

        yield event

        // Gate on confidence: escalate if too low
        if (
          event.confidence !== undefined &&
          event.confidence < 0.6 &&
          event.status !== 'escalated' &&
          event.status !== 'error'
        ) {
          const escalation: AgentEvent = {
            taskId: task.id,
            agentName: this.name,
            status: 'escalated',
            message: `Low confidence (${(event.confidence * 100).toFixed(0)}%) — escalating to human review`,
            confidence: event.confidence,
            reasoning: event.reasoning,
            timestamp: new Date(),
          }
          this.logEvent(escalation, task, Date.now() - startTime).catch(console.error)
          yield escalation
          return
        }
      }
    } catch (err) {
      const errorEvent: AgentEvent = {
        taskId: task.id,
        agentName: this.name,
        status: 'error',
        message: err instanceof Error ? err.message : 'Unknown error occurred',
        timestamp: new Date(),
      }
      this.logEvent(errorEvent, task, Date.now() - startTime).catch(console.error)
      yield errorEvent
    }
  }

  private async logEvent(event: AgentEvent, task: AgentTask, durationMs: number) {
    try {
      await prisma.agentLog.create({
        data: {
          taskId: task.id,
          agentName: agentNameToPrisma[event.agentName] as Parameters<typeof prisma.agentLog.create>[0]['data']['agentName'],
          status: agentStatusToPrisma[event.status] as Parameters<typeof prisma.agentLog.create>[0]['data']['status'],
          intent: task.intent,
          message: event.message,
          reasoning: event.reasoning ?? null,
          confidence: event.confidence ?? null,
          data: event.data ? (event.data as object) : undefined,
          userId: task.userId || null,
          sessionId: task.sessionId || null,
          durationMs,
        },
      })
    } catch {
      // Logging failures should never crash the agent
    }
  }
}

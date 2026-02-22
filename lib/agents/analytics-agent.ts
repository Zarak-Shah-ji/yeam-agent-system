import { BaseAgent } from './base-agent'
import { GEMINI_AVAILABLE, getModel } from './gemini-client'
import type { AgentEvent, AgentName, AgentTask } from './types'

const SYSTEM_PROMPT = `You are a healthcare analytics AI for Molina Family Health Clinic. Analyze clinic performance metrics and provide actionable insights.

When given metrics, you:
1. Identify key trends and anomalies
2. Compare against benchmarks (industry denial rate ~8-10%, collection rate ~95%)
3. Provide 2-3 specific, actionable recommendations
4. Keep responses concise (max 4-5 sentences)

Lead with the most important insight, then give recommendations.`

const KEYWORDS = ['metrics', 'report', 'analytics', 'revenue', 'denial', 'ar ', 'stats', 'trend', 'performance', 'rate', 'collection', 'benchmark', 'insight', 'data', 'numbers', 'query-metrics']

export class AnalyticsAgent extends BaseAgent {
  name: AgentName = 'analytics'

  canHandle(task: AgentTask): boolean {
    const intent = task.intent.toLowerCase()
    return KEYWORDS.some(kw => intent.includes(kw))
  }

  protected async *_execute(task: AgentTask): AsyncGenerator<AgentEvent> {
    yield { taskId: task.id, agentName: this.name, status: 'thinking', message: 'Querying clinic metrics...', timestamp: new Date() }
    await new Promise(r => setTimeout(r, 300))

    if (!GEMINI_AVAILABLE) {
      yield { taskId: task.id, agentName: this.name, status: 'working', message: 'Aggregating data...', timestamp: new Date() }
      await new Promise(r => setTimeout(r, 500))
      yield {
        taskId: task.id, agentName: this.name, status: 'complete',
        message: 'Metrics: 8 patients today, $2,150 pending claims, 12% denial rate (above 8% benchmark). Recommend: Review top denial reasons and resubmit corrected claims within 30 days.',
        data: { patientsToday: 8, pendingClaims: 2150, denialRate: 0.12 },
        confidence: 0.88, reasoning: 'Stub (no GEMINI_API_KEY)', timestamp: new Date(),
      }
      return
    }

    yield { taskId: task.id, agentName: this.name, status: 'working', message: 'Generating insights with Gemini...', timestamp: new Date() }
    const userContent = Object.keys(task.context).length > 0
      ? `Query: ${task.intent}\nData: ${JSON.stringify(task.context, null, 2)}`
      : `Query: ${task.intent}`

    const model = getModel(SYSTEM_PROMPT)
    const result = await model.generateContent(userContent)
    const text = result.response.text()

    yield { taskId: task.id, agentName: this.name, status: 'complete', message: text, confidence: 0.94, reasoning: 'Gemini 2.0 Flash analytics', timestamp: new Date() }
  }
}

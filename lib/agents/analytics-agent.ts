import { BaseAgent } from './base-agent'
import { GEMINI_AVAILABLE, getModel } from './gemini-client'
import { prisma } from '@/lib/db'
import type { AgentEvent, AgentName, AgentTask } from './types'

const SYSTEM_PROMPT = `You are a healthcare analytics AI for Yeam Health Clinic. Analyze clinic performance metrics and provide actionable insights.

When given metrics, you:
1. Identify key trends and anomalies
2. Compare against benchmarks (industry denial rate ~8-10%, collection rate ~95%)
3. Provide 2-3 specific, actionable recommendations
4. Keep responses concise (max 4-5 sentences)

Lead with the most important insight, then give recommendations.`

const KEYWORDS = ['metrics', 'report', 'analytics', 'revenue', 'denial', 'ar ', 'stats', 'trend', 'performance', 'rate', 'collection', 'benchmark', 'insight', 'data', 'numbers', 'query-metrics']

async function fetchMetrics() {
  const [encounters, denied, revenueAgg] = await Promise.all([
    prisma.medicaidEncounter.count(),
    prisma.medicaidEncounter.count({ where: { claimStatus: 'denied' } }),
    prisma.medicaidEncounter.aggregate({ _sum: { paidAmount: true } }),
  ])
  const totalCollected = revenueAgg._sum.paidAmount?.toNumber() ?? 0
  const denialRate = encounters > 0 ? denied / encounters : 0
  return { encounters, denied, denialRate, totalCollected }
}

export class AnalyticsAgent extends BaseAgent {
  name: AgentName = 'analytics'

  canHandle(task: AgentTask): boolean {
    const intent = task.intent.toLowerCase()
    return KEYWORDS.some(kw => intent.includes(kw))
  }

  protected async *_execute(task: AgentTask): AsyncGenerator<AgentEvent> {
    yield { taskId: task.id, agentName: this.name, status: 'thinking', message: 'Querying clinic metrics...', timestamp: new Date() }
    await new Promise(r => setTimeout(r, 300))

    const metrics = await fetchMetrics()

    if (!GEMINI_AVAILABLE) {
      yield { taskId: task.id, agentName: this.name, status: 'working', message: 'Aggregating data...', timestamp: new Date() }
      await new Promise(r => setTimeout(r, 500))
      yield {
        taskId: task.id, agentName: this.name, status: 'complete',
        message: `Metrics: ${metrics.encounters.toLocaleString()} encounters, denial rate ${(metrics.denialRate * 100).toFixed(1)}%, $${metrics.totalCollected.toLocaleString('en-US', { minimumFractionDigits: 2 })} collected. ${metrics.denialRate > 0.1 ? 'Denial rate is above benchmark — review flagged claims.' : 'Denial rate is within benchmark.'}`,
        data: {
          encounters: metrics.encounters,
          denied: metrics.denied,
          denialRate: metrics.denialRate,
          totalCollected: metrics.totalCollected,
        },
        confidence: 0.88, reasoning: 'Live DB query (no GEMINI_API_KEY)', timestamp: new Date(),
      }
      return
    }

    yield { taskId: task.id, agentName: this.name, status: 'working', message: 'Generating insights with Gemini...', timestamp: new Date() }
    const metricsContext = `Clinic Metrics:\n- Total encounters: ${metrics.encounters}\n- Denied: ${metrics.denied} (${(metrics.denialRate * 100).toFixed(1)}%)\n- Total collected: $${metrics.totalCollected.toFixed(2)}`
    const userContent = `Query: ${task.intent}\n${metricsContext}${Object.keys(task.context).length > 0 ? `\nAdditional context: ${JSON.stringify(task.context)}` : ''}`

    const model = getModel(SYSTEM_PROMPT)
    const result = await model.generateContent(userContent)
    const text = result.response.text()

    yield {
      taskId: task.id, agentName: this.name, status: 'complete', message: text,
      data: { encounters: metrics.encounters, denied: metrics.denied, denialRate: metrics.denialRate, totalCollected: metrics.totalCollected },
      confidence: 0.94, reasoning: 'Gemini 2.0 Flash analytics', timestamp: new Date(),
    }
  }
}

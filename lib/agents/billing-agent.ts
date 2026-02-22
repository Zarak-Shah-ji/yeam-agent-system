import { BaseAgent } from './base-agent'
import { GEMINI_AVAILABLE, getModel } from './gemini-client'
import type { AgentEvent, AgentName, AgentTask } from './types'

const SYSTEM_PROMPT = `You are a medical billing specialist AI for Molina Family Health Clinic. You help with:
- Drafting insurance appeal letters for denied claims
- Explaining denial reasons and remediation steps
- ERA/remittance advice interpretation
- Payment posting guidance

For appeal letters include: claim reference, date of service, clinical justification, regulatory references (CMS LCD if applicable), and request for reconsideration. Be professional, concise, and clinically accurate.`

const KEYWORDS = ['appeal', 'denial', 'denied', 'payment', 'era', 'remittance', 'post payment', 'write off', 'void', 'resubmit', 'reconsider', 'appeal-denial', 'draft-appeal']

export class BillingAgent extends BaseAgent {
  name: AgentName = 'billing'

  canHandle(task: AgentTask): boolean {
    const intent = task.intent.toLowerCase()
    return KEYWORDS.some(kw => intent.includes(kw))
  }

  protected async *_execute(task: AgentTask): AsyncGenerator<AgentEvent> {
    yield { taskId: task.id, agentName: this.name, status: 'thinking', message: 'Reviewing billing information...', timestamp: new Date() }
    await new Promise(r => setTimeout(r, 300))

    if (!GEMINI_AVAILABLE) {
      yield { taskId: task.id, agentName: this.name, status: 'working', message: 'Processing billing request...', timestamp: new Date() }
      await new Promise(r => setTimeout(r, 400))
      const ctx = task.context as Record<string, string>
      const claimNum = ctx.claimNumber ?? 'CLM-XXXX'
      const reason = ctx.denialReason ?? 'unspecified reason'
      yield {
        taskId: task.id, agentName: this.name, status: 'complete',
        message: `Appeal drafted for ${claimNum}. Denial: ${reason}. Action: Obtain supporting documentation and resubmit within 180 days.`,
        data: {
          appealLetter: `Dear Claims Review Department,\n\nRe: Appeal for Claim ${claimNum}\n\nWe are writing to appeal the denial of the above-referenced claim for services rendered. The denial reason provided was: "${reason}."\n\nThe services billed were medically necessary and clinically appropriate for the patient's documented condition. We respectfully request reconsideration and attach supporting clinical documentation.\n\nPlease contact our billing department at billing@molinaclinic.demo with any questions.\n\nSincerely,\nMolina Family Health Clinic — Billing Department`,
          recommendedAction: 'Attach medical records and resubmit within 180 days of denial date',
        },
        confidence: 0.80, reasoning: 'Stub (no GEMINI_API_KEY)', timestamp: new Date(),
      }
      return
    }

    yield { taskId: task.id, agentName: this.name, status: 'working', message: 'Drafting with Gemini...', timestamp: new Date() }

    const model = getModel(SYSTEM_PROMPT)
    const result = await model.generateContent(
      `Request: ${task.intent}\nContext: ${JSON.stringify(task.context, null, 2)}`
    )
    const text = result.response.text()

    yield {
      taskId: task.id, agentName: this.name, status: 'complete',
      message: text.slice(0, 200) + (text.length > 200 ? '...' : ''),
      data: { appealLetter: text },
      confidence: 0.91, reasoning: 'Gemini 2.0 Flash billing', timestamp: new Date(),
    }
  }
}

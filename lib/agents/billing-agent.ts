import { BaseAgent } from './base-agent'
import { GEMINI_AVAILABLE, getModel } from './gemini-client'
import { buildAppealContext } from '@/lib/billing/appeal-context'
import { CLAIM_APPEAL_SYSTEM_PROMPT, stripPreamble, todayLong } from '@/lib/billing/appeal-prompt'
import type { AgentEvent, AgentName, AgentTask } from './types'

const KEYWORDS = ['appeal', 'denial', 'denied', 'payment', 'era', 'remittance', 'post payment', 'write off', 'void', 'resubmit', 'reconsider', 'appeal-denial', 'draft-appeal']

const DENIAL_PLACEHOLDER = '[DENIAL REASON — SEE ATTACHED EOB/ERA]'

export class BillingAgent extends BaseAgent {
  name: AgentName = 'billing'

  canHandle(task: AgentTask): boolean {
    const intent = task.intent.toLowerCase()
    return KEYWORDS.some(kw => intent.includes(kw))
  }

  protected async *_execute(task: AgentTask): AsyncGenerator<AgentEvent> {
    yield { taskId: task.id, agentName: this.name, status: 'thinking', message: 'Gathering claim details...', timestamp: new Date() }
    await new Promise(r => setTimeout(r, 300))

    // Fetch the full claim context server-side before drafting. The client
    // passes claimId; everything else falls back to whatever it also sent.
    const incoming = task.context as Record<string, unknown>
    let ctx: Record<string, unknown> = incoming
    const claimId = typeof incoming.claimId === 'string' ? incoming.claimId : null
    if (claimId) {
      try {
        const appeal = await buildAppealContext(claimId)
        if (appeal) ctx = { ...incoming, ...appeal }
      } catch (err) {
        console.error('buildAppealContext failed', err)
      }
    }

    const claimNum = (ctx.claimNumber as string) || 'CLM-XXXX'

    // Summary fields persisted alongside the letter so downstream readers (the
    // /appeals review portal) can render a card without re-parsing the prose.
    const patientCtx = ctx.patient as { name?: string; memberId?: string } | undefined
    const payerCtx = ctx.payer as { name?: string } | undefined
    const summary = {
      claimNumber: claimNum,
      patientName: patientCtx?.name || (ctx.patientName as string) || null,
      payerName: payerCtx?.name || (typeof ctx.payer === 'string' ? ctx.payer : null),
      serviceDate: (ctx.serviceDate as string) || null,
      denialReason: (ctx.denialReason as string) || null,
      denialCode: (ctx.denialCode as string) || null,
    }

    if (!GEMINI_AVAILABLE) {
      yield { taskId: task.id, agentName: this.name, status: 'working', message: 'Drafting appeal letter...', timestamp: new Date() }
      await new Promise(r => setTimeout(r, 400))

      const patientName = summary.patientName || '[PATIENT NAME]'
      const memberId = patientCtx?.memberId || '[MEMBER ID]'
      const payerName = summary.payerName || '[PAYER NAME]'
      const serviceDate = (ctx.serviceDate as string) || '[DATE OF SERVICE]'
      const reason = (ctx.denialReason as string) || DENIAL_PLACEHOLDER
      const today = todayLong()

      const appealLetter = `${today}

${payerName}
Claims Review Department
[PAYER APPEALS ADDRESS]

Re: Appeal of Denied Claim
Claim Number: ${claimNum}
Patient: ${patientName}
Member ID: ${memberId}
Date of Service: ${serviceDate}

Dear Claims Review Department,

We are formally requesting reconsideration of the above-referenced claim, which was denied. Denial reason: ${reason}.

The services rendered on ${serviceDate} were medically necessary and clinically appropriate for the patient's documented condition. The procedure and diagnosis codes submitted accurately reflect the care provided, and supporting clinical documentation is attached for your review.

We respectfully request that this claim be reprocessed and paid in accordance with the member's benefits. Please contact our billing department at billing@yeam.demo with any questions.

Sincerely,

Yeam Health Clinic — Billing Department`

      yield {
        taskId: task.id, agentName: this.name, status: 'complete',
        message: `Appeal letter drafted for ${claimNum}.`,
        data: {
          ...summary,
          appealLetter,
          recommendedAction: 'Attach medical records and resubmit within 180 days of the denial date',
        },
        confidence: 0.80, reasoning: 'Stub (no GEMINI_API_KEY)', timestamp: new Date(),
      }
      return
    }

    yield { taskId: task.id, agentName: this.name, status: 'working', message: 'Drafting appeal letter...', timestamp: new Date() }

    const model = getModel(CLAIM_APPEAL_SYSTEM_PROMPT)
    const result = await model.generateContent({
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `Today's date is ${todayLong()}. Use it as the letter date.\n\nDraft the appeal letter now using this claim context. Output the letter text only — do not ask any questions.\n\n${JSON.stringify(ctx, null, 2)}`,
            },
          ],
        },
      ],
      generationConfig: { temperature: 0.3 },
    })
    const appealLetter = stripPreamble(result.response.text())

    yield {
      taskId: task.id, agentName: this.name, status: 'complete',
      message: `Appeal letter drafted for ${claimNum}.`,
      data: { ...summary, appealLetter },
      confidence: 0.91, reasoning: 'Gemini 2.5 Flash billing', timestamp: new Date(),
    }
  }
}

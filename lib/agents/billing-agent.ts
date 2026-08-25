import { BaseAgent } from './base-agent'
import { GEMINI_AVAILABLE, getModel } from './gemini-client'
import { buildAppealContext } from '@/lib/billing/appeal-context'
import {
  ARTIFACT_LABELS,
  artifactFor,
  buildClaimAppealPrompt,
  stripInstructionalPlaceholders,
  stripPreamble,
  todayLong,
} from '@/lib/billing/appeal-prompt'
import type { PayerProfile } from '@/lib/billing/payers'
import type { DenialPlaybook } from '@/lib/billing/denial-playbooks'
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

    // The denial code decides which document to send, not just what to argue.
    // A CO-11 diagnosis mismatch gets a corrected claim; CO-50 gets an appeal.
    const playbook = (ctx.playbook as DenialPlaybook | undefined) ?? null
    const artifact = artifactFor(playbook)
    const artifactLabel = ARTIFACT_LABELS[artifact]

    // Summary fields persisted alongside the letter so downstream readers (the
    // /appeals review portal) can render a card without re-parsing the prose.
    const patientCtx = ctx.patient as { name?: string; memberId?: string } | undefined
    const payerCtx = ctx.payer as PayerProfile | undefined
    const summary = {
      claimNumber: claimNum,
      patientName: patientCtx?.name || (ctx.patientName as string) || null,
      payerName: payerCtx?.name || (typeof ctx.payer === 'string' ? ctx.payer : null),
      serviceDate: (ctx.serviceDate as string) || null,
      denialReason: (ctx.denialReason as string) || null,
      denialCode: (ctx.denialCode as string) || null,
      // Surfaced on the review portal card so a reader can judge the claim
      // without opening the letter.
      billedAmount: (ctx.billedAmount as number) ?? null,
      appealDeadline: (ctx.appealDeadline as string) || null,
      daysRemaining: (ctx.daysRemaining as number) ?? null,
      deadlineGovernedBy: (ctx.deadlineGovernedBy as string) || null,
      procedureCode: (ctx.procedure as { code?: string } | undefined)?.code ?? null,
      // Which instrument this is, so the review portal can label it rather than
      // calling every generated document an "appeal letter".
      artifactType: artifact,
      artifactLabel,
    }

    if (!GEMINI_AVAILABLE) {
      // The stub body below is a generic appeal regardless of denial code, so it
      // is labelled as one rather than inheriting the resolved artifact.
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
          artifactType: 'appeal-letter',
          artifactLabel: 'Appeal letter',
          appealLetter,
          recommendedAction: payerCtx
            ? `Submit via ${payerCtx.submissionChannel} within ${payerCtx.appealWindowDays} days of ${payerCtx.appealWindowFrom}`
            : 'Attach medical records and resubmit within the payer\'s filing window',
        },
        confidence: 0.80, reasoning: 'Stub (no GEMINI_API_KEY)', timestamp: new Date(),
      }
      return
    }

    yield { taskId: task.id, agentName: this.name, status: 'working', message: `Drafting ${artifactLabel.toLowerCase()}...`, timestamp: new Date() }

    // The instrument, the argument and the voice all come from the claim: the
    // denial code picks the document type and the strategy, the payer picks the
    // register. So the prompt is composed per claim, not shared across them.
    const model = getModel(
      buildClaimAppealPrompt({ payer: payerCtx ?? null, playbook }),
    )
    const result = await model.generateContent({
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `Today's date is ${todayLong()}. Use it as the document date.\n\nDraft the ${artifactLabel.toLowerCase()} now using this claim context. Output the document text only — do not ask any questions.\n\n${JSON.stringify(ctx, null, 2)}`,
            },
          ],
        },
      ],
      generationConfig: { temperature: 0.3 },
    })
    const appealLetter = stripInstructionalPlaceholders(stripPreamble(result.response.text()))

    yield {
      taskId: task.id, agentName: this.name, status: 'complete',
      message: `${artifactLabel} drafted for ${claimNum}.`,
      data: { ...summary, appealLetter },
      confidence: 0.91, reasoning: 'Gemini 2.5 Flash billing', timestamp: new Date(),
    }
  }
}

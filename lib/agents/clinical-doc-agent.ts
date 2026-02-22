import { BaseAgent } from './base-agent'
import { GEMINI_AVAILABLE, getModel } from './gemini-client'
import type { AgentEvent, AgentName, AgentTask } from './types'

const SYSTEM_PROMPT = `You are a clinical documentation AI for a family medicine clinic. Generate SOAP note suggestions and coding recommendations.

SOAP sections:
- Subjective: Chief complaint, HPI, symptoms
- Objective: Vitals, physical exam, lab findings
- Assessment: Clinical impression + ICD-10 codes
- Plan: Treatment, meds, orders, follow-up

Return JSON ONLY with this exact structure:
{
  "subjective": "...",
  "objective": "...",
  "assessment": "...",
  "plan": "...",
  "suggestedCodes": [
    { "type": "ICD-10", "code": "...", "description": "..." },
    { "type": "CPT", "code": "...", "description": "..." }
  ]
}

Be concise, clinically accurate, use standard medical terminology. This is a draft for provider review.`

const KEYWORDS = ['soap', 'note', 'document', 'clinical', 'encounter', 'diagnosis', 'assess', 'subjective', 'objective', 'plan', 'icd', 'cpt', 'code suggest', 'soap-assist']

export class ClinicalDocAgent extends BaseAgent {
  name: AgentName = 'clinical-doc'

  canHandle(task: AgentTask): boolean {
    const intent = task.intent.toLowerCase()
    return KEYWORDS.some(kw => intent.includes(kw))
  }

  protected async *_execute(task: AgentTask): AsyncGenerator<AgentEvent> {
    yield { taskId: task.id, agentName: this.name, status: 'thinking', message: 'Reviewing clinical context...', timestamp: new Date() }
    await new Promise(r => setTimeout(r, 300))

    if (!GEMINI_AVAILABLE) {
      yield { taskId: task.id, agentName: this.name, status: 'working', message: 'Generating SOAP note suggestions...', timestamp: new Date() }
      await new Promise(r => setTimeout(r, 600))
      const ctx = task.context as Record<string, string>
      const complaint = ctx.chiefComplaint ?? 'presenting concern'
      yield {
        taskId: task.id, agentName: this.name, status: 'complete',
        message: 'SOAP note suggestions generated. Review and edit before signing.',
        data: {
          subjective: `Patient presents with ${complaint}. Onset approximately 3 days ago, moderate severity. No known alleviating or aggravating factors identified.`,
          objective: 'Vitals stable. Alert and oriented x3. No acute distress. Physical examination within normal limits.',
          assessment: `1. ${complaint} — clinical evaluation completed.\n2. Monitor for symptom progression or complications.`,
          plan: `1. Symptomatic management as discussed with patient.\n2. Diagnostic labs ordered per protocol.\n3. Return to clinic in 2 weeks or sooner if symptoms worsen.\n4. Patient education provided regarding diagnosis and warning signs.`,
          suggestedCodes: [
            { type: 'ICD-10', code: 'Z00.00', description: 'Encounter for general adult medical exam without abnormal findings' },
            { type: 'CPT', code: '99213', description: 'Office visit, established patient, moderate complexity' },
          ],
        },
        confidence: 0.75, reasoning: 'Stub (no GEMINI_API_KEY)', timestamp: new Date(),
      }
      return
    }

    yield { taskId: task.id, agentName: this.name, status: 'working', message: 'Generating clinical documentation with Gemini...', timestamp: new Date() }

    const model = getModel(SYSTEM_PROMPT)
    const result = await model.generateContent(
      `Encounter context:\n${JSON.stringify(task.context, null, 2)}\n\nIntent: ${task.intent}`
    )
    const text = result.response.text()

    type SoapData = { subjective: string; objective: string; assessment: string; plan: string; suggestedCodes: Array<{ type: string; code: string; description: string }> }
    let data: SoapData = { subjective: '', objective: '', assessment: '', plan: '', suggestedCodes: [] }
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (jsonMatch) data = JSON.parse(jsonMatch[0]) as SoapData
    } catch {
      data.plan = text
    }

    yield {
      taskId: task.id, agentName: this.name, status: 'complete',
      message: 'SOAP note suggestions ready. Review and edit before signing.',
      data, confidence: 0.88, reasoning: 'Gemini 2.0 Flash clinical doc', timestamp: new Date(),
    }
  }
}

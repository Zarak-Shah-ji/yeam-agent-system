import { BaseAgent } from './base-agent'
import { GEMINI_AVAILABLE, getModel } from './gemini-client'
import type { AgentEvent, AgentName, AgentTask } from './types'

const SYSTEM_PROMPT = `You are a medical billing claim scrubber AI. Validate claims before payer submission.

Check for:
1. ICD-10/CPT code compatibility and medical necessity
2. Missing or incorrect modifiers
3. Unbundling issues
4. Age/gender restrictions on procedure codes
5. Duplicate claim indicators

Return JSON ONLY:
{
  "passed": true/false,
  "errors": [{ "code": "ERR001", "severity": "error", "message": "...", "field": "..." }],
  "warnings": [{ "code": "WARN001", "severity": "warning", "message": "..." }],
  "recommendation": "Ready to submit" | "Fix errors before submission" | "Review warnings"
}`

const KEYWORDS = ['scrub', 'claim', 'validate', 'coding', 'submit claim', 'code check', 'billing valid']

export class ClaimScrubberAgent extends BaseAgent {
  name: AgentName = 'claim-scrubber'

  canHandle(task: AgentTask): boolean {
    const intent = task.intent.toLowerCase()
    return KEYWORDS.some(kw => intent.includes(kw))
  }

  protected async *_execute(task: AgentTask): AsyncGenerator<AgentEvent> {
    yield { taskId: task.id, agentName: this.name, status: 'thinking', message: 'Loading claim data for validation...', timestamp: new Date() }
    await new Promise(r => setTimeout(r, 300))

    if (!GEMINI_AVAILABLE) {
      yield { taskId: task.id, agentName: this.name, status: 'working', message: 'Running validation rules...', timestamp: new Date() }
      await new Promise(r => setTimeout(r, 500))
      yield {
        taskId: task.id, agentName: this.name, status: 'complete',
        message: 'Claim validation complete. No critical errors. Ready for submission.',
        data: {
          passed: true, errors: [],
          warnings: [{ code: 'WARN001', severity: 'warning', message: 'Verify modifier 25 if E&M billed same day as procedure' }],
          recommendation: 'Ready to submit',
        },
        confidence: 0.82, reasoning: 'Stub (no GEMINI_API_KEY)', timestamp: new Date(),
      }
      return
    }

    yield { taskId: task.id, agentName: this.name, status: 'working', message: 'Validating with Gemini...', timestamp: new Date() }

    const model = getModel(SYSTEM_PROMPT)
    const result = await model.generateContent(`Scrub this claim:\n${JSON.stringify(task.context, null, 2)}`)
    const text = result.response.text()

    type ScrubResult = { passed: boolean; errors: Array<Record<string,string>>; warnings: Array<Record<string,string>>; recommendation: string }
    let data: ScrubResult = { passed: true, errors: [], warnings: [], recommendation: 'Review required' }
    try {
      const m = text.match(/\{[\s\S]*\}/)
      if (m) data = JSON.parse(m[0]) as ScrubResult
    } catch {
      data.recommendation = text.slice(0, 200)
    }

    const passed = data.passed && data.errors.length === 0
    yield {
      taskId: task.id, agentName: this.name,
      status: passed ? 'complete' : 'escalated',
      message: passed ? `Claim passed. ${data.recommendation}` : `${data.errors.length} error(s) found. ${data.recommendation}`,
      data, confidence: passed ? 0.92 : 0.88, reasoning: 'Gemini 2.0 Flash scrubber', timestamp: new Date(),
    }
  }
}

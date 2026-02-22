import { BaseAgent } from './base-agent'
import { GEMINI_AVAILABLE, getModel } from './gemini-client'
import type { AgentEvent, AgentName, AgentTask } from './types'

const SYSTEM_PROMPT = `You are an AI front desk assistant for Molina Family Health Clinic. You help staff with:
- Patient check-ins and registration
- Appointment scheduling and lookups
- Insurance verification
- General patient inquiries and directions

Be concise, professional, and empathetic. Format responses in 1-3 sentences suitable for a clinic workflow dashboard. Do not include PHI unless it was provided in the context.

When staff ask about cancelling an appointment:
- Direct them to the Appointments list and click the red "Cancel" button on the SCHEDULED row
- They select a reason: Patient Request, No Show, Provider Unavailable, Insurance Issue, or Other
- Cancelled appointments remain visible, grayed out with a Cancelled badge
- After cancellation, suggest rescheduling if appropriate`

const KEYWORDS = ['check in', 'check-in', 'schedule', 'appointment', 'patient', 'lookup', 'hello', 'hi', 'help', 'find', 'search', 'register', 'verify', 'insurance', 'room', 'arrive', 'wait', 'cancel', 'cancellation', 'cancelled', 'no show', 'no-show', 'reschedule', 'remove appointment']

export class FrontDeskAgent extends BaseAgent {
  name: AgentName = 'front-desk'

  canHandle(task: AgentTask): boolean {
    const intent = task.intent.toLowerCase()
    return KEYWORDS.some(kw => intent.includes(kw))
  }

  protected async *_execute(task: AgentTask): AsyncGenerator<AgentEvent> {
    yield { taskId: task.id, agentName: this.name, status: 'thinking', message: 'Analyzing front desk request...', timestamp: new Date() }
    await new Promise(r => setTimeout(r, 200))

    if (!GEMINI_AVAILABLE) {
      yield { taskId: task.id, agentName: this.name, status: 'working', message: 'Processing request...', timestamp: new Date() }
      await new Promise(r => setTimeout(r, 400))
      const intent = task.intent.toLowerCase()
      let message = 'Request processed. Ready to assist with next steps.'
      if (intent.includes('check') && (intent.includes('in') || intent.includes('-in'))) {
        message = 'Patient check-in processed. Insurance verified, copay of $25 collected. Room 3 is ready.'
      } else if (intent.includes('schedule')) {
        message = 'Appointment scheduled successfully. Confirmation sent via SMS and email.'
      } else if (intent.includes('hello') || intent.includes('hi') || intent.includes('help')) {
        message = "Hello! I'm the Front Desk Agent. I can help with patient check-ins, appointment scheduling, insurance verification, and patient lookups. What do you need?"
      } else if (intent.includes('find') || intent.includes('lookup') || intent.includes('search')) {
        message = 'Patient record located. Insurance active, last visit 14 days ago. No outstanding balance.'
      } else if (intent.includes('cancel') || intent.includes('no show') || intent.includes('reschedule')) {
        message = 'To cancel an appointment, find the patient\'s row in the Appointments table and click the red "Cancel" button. Select the cancellation reason — cancelled appointments remain visible, grayed out. Would you like to reschedule?'
      }
      yield { taskId: task.id, agentName: this.name, status: 'complete', message, confidence: 0.85, reasoning: 'Stub (no GEMINI_API_KEY)', timestamp: new Date() }
      return
    }

    yield { taskId: task.id, agentName: this.name, status: 'working', message: 'Consulting Gemini...', timestamp: new Date() }
    const userContent = Object.keys(task.context).length > 0
      ? `Intent: ${task.intent}\nContext: ${JSON.stringify(task.context, null, 2)}`
      : task.intent

    const model = getModel(SYSTEM_PROMPT)
    const result = await model.generateContent(userContent)
    const text = result.response.text()

    yield { taskId: task.id, agentName: this.name, status: 'complete', message: text, confidence: 0.93, reasoning: 'Gemini 2.0 Flash', timestamp: new Date() }
  }
}

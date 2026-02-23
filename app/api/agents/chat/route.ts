import { NextRequest } from 'next/server'
import { SchemaType, type Content, type Part, type FunctionDeclarationsTool } from '@google/generative-ai'
import { type Prisma } from '@prisma/client'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { GEMINI_AVAILABLE, getFlashModel, getProModel } from '@/lib/agents/gemini-client'
import { medicaidFunctionDeclarations } from '@/lib/ai/medicaid-tools'
import { executeMedicaidFunction } from '@/lib/ai/tool-executor'
import { startOfDay, endOfDay } from 'date-fns'

export const runtime = 'nodejs'

// ─── Agent routing ────────────────────────────────────────────────────────────

type AgentName = 'front-desk' | 'clinical-doc' | 'claim-scrubber' | 'billing' | 'analytics'

const AGENT_LABELS: Record<AgentName, string> = {
  'front-desk': 'Front Desk',
  'clinical-doc': 'Clinical Documentation',
  'claim-scrubber': 'Claim Scrubber',
  'billing': 'Billing',
  'analytics': 'Analytics',
}

const PRISMA_AGENT_NAME: Record<AgentName, string> = {
  'front-desk': 'FRONT_DESK',
  'clinical-doc': 'CLINICAL_DOC',
  'claim-scrubber': 'CLAIM_SCRUBBER',
  'billing': 'BILLING',
  'analytics': 'ANALYTICS',
}

const SYSTEM_PROMPTS: Record<AgentName, string> = {
  'front-desk': `You are the Front Desk Agent for Molina Family Health Clinic. Help staff with patient check-ins, appointment scheduling and cancellations, insurance verification, and patient lookups. Be concise and professional. Use the available tools to look up real data. When cancelling appointments via the tool, confirm the action with the staff member first.`,

  'clinical-doc': `You are the Clinical Documentation Agent for Molina Family Health Clinic. Assist providers with SOAP note documentation, encounter lookups, ICD-10 diagnosis coding, and CPT procedure coding. Be precise and clinically accurate. Use tools to look up patient encounters and claims.`,

  'claim-scrubber': `You are the Claim Scrubbing Agent for Molina Family Health Clinic. Validate insurance claims for accuracy, check ICD-10/CPT code combinations, verify claim status, and identify billing errors. Use the available tools to look up real claim data.`,

  'billing': `You are the Billing Agent for Molina Family Health Clinic. Handle denied claims, advise on appeal strategies, track payments, and support revenue cycle operations. Use claim_lookup to find denied or pending claims and advise on next steps.`,

  'analytics': `You are the Analytics Agent for Molina Family Health Clinic. Generate reports on denial rates, revenue, claim counts, and other key metrics. You also have access to statewide Texas Medicaid data covering 11M+ claims from 2018-2024. Use get_medicaid_dashboard, get_provider_analytics, search_providers, detect_anomalies, and get_procedure_info to answer questions about statewide provider trends, procedure costs, and billing patterns. Use metrics_query for clinic-specific EHR data.`,
}

const CLASSIFY_PROMPT = `You are an intent router for a medical clinic EHR system.
Given a staff message, respond with ONLY one of these agent names — no punctuation, no explanation:

front-desk   → patient check-in, appointment scheduling/cancellation, patient lookup, registration, insurance verification, room assignments
clinical-doc → SOAP notes, encounter documentation, ICD-10/CPT coding, clinical questions
claim-scrubber → claim validation, scrubbing, status checks, billing code review
billing      → denied claims, payments, appeals, outstanding balances, revenue cycle
analytics    → reports, metrics, denial rates, revenue statistics, trends, Medicaid provider analysis, statewide billing data, procedure code costs, provider anomalies, top billers

Message: `

// ─── Gemini function tools ────────────────────────────────────────────────────

const TOOLS: FunctionDeclarationsTool[] = [{
  functionDeclarations: [
    ...medicaidFunctionDeclarations,
    {
      name: 'patient_lookup',
      description: 'Look up a patient by name or MRN. Returns matching patient records.',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          query: { type: SchemaType.STRING, description: 'Patient name or MRN to search for' },
        },
        required: ['query'],
      },
    },
    {
      name: 'appointment_list',
      description: 'List appointments, optionally filtered by date or patient ID.',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          date: { type: SchemaType.STRING, description: 'Date in YYYY-MM-DD format' },
          patient_id: { type: SchemaType.STRING, description: 'Patient ID to filter by' },
        },
      },
    },
    {
      name: 'appointment_cancel',
      description: 'Cancel a scheduled appointment. Only works on SCHEDULED appointments.',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          appointment_id: { type: SchemaType.STRING, description: 'The appointment ID to cancel' },
          reason: { type: SchemaType.STRING, description: 'Reason for cancellation (e.g. Patient Request, No Show, Other)' },
        },
        required: ['appointment_id', 'reason'],
      },
    },
    {
      name: 'insurance_verify',
      description: 'Check insurance coverage status and plan details for a patient.',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          patient_id: { type: SchemaType.STRING, description: 'The patient ID to check coverage for' },
        },
        required: ['patient_id'],
      },
    },
    {
      name: 'claim_lookup',
      description: 'Look up claims filtered by status and/or patient.',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          status: { type: SchemaType.STRING, description: 'Claim status: PENDING, SUBMITTED, DENIED, PAID, APPEALED, etc.' },
          patient_id: { type: SchemaType.STRING, description: 'Patient ID to filter by' },
        },
      },
    },
    {
      name: 'metrics_query',
      description: 'Run analytics queries for clinic metrics like denial rate, revenue, and claims count.',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          metric: { type: SchemaType.STRING, description: 'Metric to query: denial_rate, revenue, or claims_count' },
          period: { type: SchemaType.STRING, description: 'Time period: today, this_week, or this_month (default: this_month)' },
        },
        required: ['metric'],
      },
    },
  ],
}]

// ─── Function execution ───────────────────────────────────────────────────────

async function executeFunction(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'patient_lookup': {
      const query = String(args.query ?? '').trim()
      const patients = await prisma.patient.findMany({
        where: {
          OR: [
            { firstName: { contains: query, mode: 'insensitive' } },
            { lastName: { contains: query, mode: 'insensitive' } },
            { mrn: { equals: query } },
          ],
        },
        select: {
          id: true, firstName: true, lastName: true, mrn: true,
          dateOfBirth: true, phone: true, email: true, active: true,
        },
        take: 5,
      })
      return {
        patients: patients.map(p => ({
          ...p,
          dateOfBirth: p.dateOfBirth.toISOString().split('T')[0],
        })),
        total: patients.length,
      }
    }

    case 'appointment_list': {
      const date = args.date as string | undefined
      const patientId = args.patient_id as string | undefined

      const where: Prisma.AppointmentWhereInput = {}
      if (date) {
        const d = new Date(date + 'T00:00:00')
        where.scheduledAt = { gte: startOfDay(d), lte: endOfDay(d) }
      }
      if (patientId) where.patientId = patientId

      const appointments = await prisma.appointment.findMany({
        where,
        include: {
          patient: { select: { firstName: true, lastName: true, mrn: true } },
          provider: { select: { firstName: true, lastName: true, credential: true } },
        },
        orderBy: { scheduledAt: 'asc' },
        take: 20,
      })
      return {
        appointments: appointments.map(a => ({
          id: a.id,
          patient: `${a.patient.firstName} ${a.patient.lastName} (${a.patient.mrn})`,
          provider: `${a.provider.firstName} ${a.provider.lastName}${a.provider.credential ? `, ${a.provider.credential}` : ''}`,
          scheduledAt: a.scheduledAt.toISOString(),
          status: a.status,
          appointmentType: a.appointmentType ?? 'unspecified',
          chiefComplaint: a.chiefComplaint ?? null,
        })),
        total: appointments.length,
      }
    }

    case 'appointment_cancel': {
      const appointmentId = String(args.appointment_id ?? '').trim()
      const reason = String(args.reason ?? 'Other').trim()

      const appt = await prisma.appointment.findUnique({ where: { id: appointmentId } })
      if (!appt) return { success: false, error: 'Appointment not found.' }
      if (appt.status !== 'SCHEDULED')
        return { success: false, error: `Cannot cancel — appointment is already ${appt.status}.` }

      await prisma.appointment.update({
        where: { id: appointmentId },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancellationReason: reason },
      })
      return { success: true, message: `Appointment ${appointmentId} cancelled. Reason: ${reason}` }
    }

    case 'insurance_verify': {
      const patientId = String(args.patient_id ?? '').trim()
      const coverages = await prisma.insuranceCoverage.findMany({
        where: { patientId, active: true },
        include: { payer: { select: { name: true, planType: true } } },
        orderBy: { isPrimary: 'desc' },
      })
      return {
        coverages: coverages.map(c => ({
          payer: c.payer.name,
          planType: c.payer.planType,
          memberId: c.memberId,
          groupNumber: c.groupNumber,
          planName: c.planName,
          isPrimary: c.isPrimary,
          effectiveDate: c.effectiveDate.toISOString().split('T')[0],
          terminationDate: c.terminationDate?.toISOString().split('T')[0] ?? null,
          copay: c.copay?.toNumber() ?? null,
          deductible: c.deductible?.toNumber() ?? null,
          deductibleMet: c.deductibleMet?.toNumber() ?? null,
        })),
        total: coverages.length,
      }
    }

    case 'claim_lookup': {
      const status = args.status as string | undefined
      const patientId = args.patient_id as string | undefined

      const claims = await prisma.claim.findMany({
        where: {
          ...(status ? { status: status as Prisma.EnumClaimStatusFilter } : {}),
          ...(patientId ? { patientId } : {}),
        },
        include: {
          patient: { select: { firstName: true, lastName: true, mrn: true } },
          payer: { select: { name: true } },
        },
        orderBy: { serviceDate: 'desc' },
        take: 10,
      })
      return {
        claims: claims.map(c => ({
          id: c.id,
          claimNumber: c.claimNumber,
          patient: `${c.patient.firstName} ${c.patient.lastName} (${c.patient.mrn})`,
          payer: c.payer.name,
          status: c.status,
          totalCharge: c.totalCharge.toNumber(),
          paidAmount: c.paidAmount?.toNumber() ?? null,
          serviceDate: c.serviceDate.toISOString().split('T')[0],
          denialReason: c.denialReason ?? null,
        })),
        total: claims.length,
      }
    }

    case 'metrics_query': {
      const metric = String(args.metric ?? '').trim()
      const period = String(args.period ?? 'this_month').trim()

      const now = new Date()
      let startDate: Date
      if (period === 'today') startDate = startOfDay(now)
      else if (period === 'this_week') startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
      else startDate = new Date(now.getFullYear(), now.getMonth(), 1)

      if (metric === 'denial_rate') {
        const [total, denied] = await Promise.all([
          prisma.claim.count({ where: { serviceDate: { gte: startDate } } }),
          prisma.claim.count({ where: { serviceDate: { gte: startDate }, status: 'DENIED' } }),
        ])
        return {
          metric: 'denial_rate', period,
          value: total > 0 ? `${(denied / total * 100).toFixed(1)}%` : '0%',
          denied, total,
        }
      }

      if (metric === 'revenue') {
        const result = await prisma.claim.aggregate({
          where: { serviceDate: { gte: startDate }, status: 'PAID' },
          _sum: { paidAmount: true },
          _count: true,
        })
        const amount = result._sum.paidAmount?.toNumber() ?? 0
        return {
          metric: 'revenue', period,
          value: `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
          claimCount: result._count,
        }
      }

      if (metric === 'claims_count') {
        const grouped = await prisma.claim.groupBy({
          by: ['status'],
          where: { serviceDate: { gte: startDate } },
          _count: true,
        })
        const total = grouped.reduce((sum, g) => sum + g._count, 0)
        return {
          metric: 'claims_count', period,
          total,
          breakdown: grouped.map(g => ({ status: g.status, count: g._count })),
        }
      }

      return { error: `Unknown metric "${metric}". Supported: denial_rate, revenue, claims_count` }
    }

    default: {
      // Fall through to Medicaid tool executor
      const medicaidResult = await executeMedicaidFunction(name, args)
      if (medicaidResult !== null) return medicaidResult
      return { error: `Unknown function: ${name}` }
    }
  }
}

// ─── SSE helpers ──────────────────────────────────────────────────────────────

type SSEEvent =
  | { type: 'routing'; message: string }
  | { type: 'agent'; name: string; message: string }
  | { type: 'tool_call'; tool: string }
  | { type: 'tool_result'; tool: string; count?: number }
  | { type: 'text'; content: string }
  | { type: 'done'; agentName: string }
  | { type: 'error'; message: string }

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user) return new Response('Unauthorized', { status: 401 })

  let body: { message?: string; history?: Array<{ role: string; content: string }> }
  try { body = await req.json() }
  catch { return new Response('Invalid JSON', { status: 400 }) }

  const message = body.message?.trim()
  if (!message) return new Response('Missing message', { status: 400 })

  const encoder = new TextEncoder()
  const startTime = Date.now()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: SSEEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      }

      try {
        if (!GEMINI_AVAILABLE) {
          send({ type: 'error', message: 'GEMINI_API_KEY is not configured. Add it to .env.' })
          return
        }

        // ── Step 1: Classify intent ──
        send({ type: 'routing', message: '🔍 Routing request...' })
        const flash = getFlashModel()
        const classifyResult = await flash.generateContent({
          contents: [{ role: 'user', parts: [{ text: CLASSIFY_PROMPT + message }] }],
        })
        const classified = classifyResult.response.text().trim().toLowerCase()
        const validAgents: AgentName[] = ['front-desk', 'clinical-doc', 'claim-scrubber', 'billing', 'analytics']
        const agentName: AgentName = validAgents.includes(classified as AgentName)
          ? (classified as AgentName)
          : 'front-desk'
        const agentLabel = AGENT_LABELS[agentName]

        send({ type: 'agent', name: agentName, message: `${agentLabel} Agent is thinking...` })

        // ── Step 2: Build conversation history ──
        const history: Content[] = (body.history ?? []).map(h => ({
          role: h.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: h.content }],
        }))
        const contents: Content[] = [
          ...history,
          { role: 'user', parts: [{ text: message }] },
        ]

        // ── Step 3: Pro model with function calling ──
        const model = getProModel(SYSTEM_PROMPTS[agentName])
        const firstResult = await model.generateContent({ contents, tools: TOOLS })
        const firstResponse = firstResult.response
        const firstParts = firstResponse.candidates?.[0]?.content.parts ?? []
        const functionCalls = firstParts.filter(p => p.functionCall)

        let finalText = ''

        if (functionCalls.length > 0) {
          // Execute each function call
          const functionResponseParts: Part[] = await Promise.all(
            functionCalls.map(async (part) => {
              const fc = part.functionCall!
              send({ type: 'tool_call', tool: fc.name })
              const fnResult = await executeFunction(fc.name, fc.args as Record<string, unknown>)
              const r = fnResult as Record<string, unknown>
              const count =
                Array.isArray(r?.patients)    ? (r.patients   as unknown[]).length :
                Array.isArray(r?.providers)   ? (r.providers  as unknown[]).length :
                Array.isArray(r?.claims)      ? (r.claims     as unknown[]).length :
                Array.isArray(r?.encounters)  ? (r.encounters as unknown[]).length :
                Array.isArray(r?.anomalies)   ? (r.anomalies  as unknown[]).length :
                typeof r?.total === 'number'  ? r.total :
                undefined
              send({ type: 'tool_result', tool: fc.name, count })
              return {
                functionResponse: {
                  name: fc.name,
                  response: fnResult as Record<string, unknown>,
                },
              } as Part
            })
          )

          // Second turn: stream final response with function results
          const secondResult = await model.generateContentStream({
            contents: [
              ...contents,
              { role: 'model', parts: firstParts },
              { role: 'user', parts: functionResponseParts },
            ],
            tools: TOOLS,
          })

          for await (const chunk of secondResult.stream) {
            const text = chunk.text()
            if (text) {
              finalText += text
              send({ type: 'text', content: text })
            }
          }
        } else {
          // Direct response — stream not available from first call, send as-is
          finalText = firstResponse.text()
          send({ type: 'text', content: finalText })
        }

        send({ type: 'done', agentName })

        // ── Log to agent_logs (fire-and-forget) ──
        prisma.agentLog.create({
          data: {
            taskId: `chat-${Date.now()}`,
            agentName: PRISMA_AGENT_NAME[agentName] as Parameters<typeof prisma.agentLog.create>[0]['data']['agentName'],
            status: 'COMPLETE',
            intent: message.slice(0, 200),
            message: finalText.slice(0, 500),
            userId: session.user?.id ?? null,
            durationMs: Date.now() - startTime,
          },
        }).catch(console.error)

      } catch (err) {
        send({ type: 'error', message: err instanceof Error ? err.message : 'Unknown error occurred' })
      } finally {
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}

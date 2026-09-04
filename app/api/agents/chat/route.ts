import { NextRequest } from 'next/server'
import type { Content, Part } from '@google/generative-ai'
import { prisma } from '@/lib/db'
import { requireOrg } from '@/lib/org'
import { GEMINI_AVAILABLE, getModel } from '@/lib/ai/gemini-client'
import {
  executeWorkspaceTool,
  isWorkspaceTool,
  resultCount,
  workspaceTools,
} from '@/lib/ai/workspace-tools'

export const runtime = 'nodejs'

/**
 * Ask the workspace a question.
 *
 * This used to route between five personas — Front Desk, Clinical Documentation,
 * Claim Scrubber, Billing, Analytics — over the seeded EHR and the statewide
 * Medicaid dataset. Four of those describe a product that no longer exists, the
 * routing cost a model round-trip per message to pick between them, and none of
 * the tools filtered by organization.
 *
 * One assistant now, over the customer's own denials and A/R, through
 * lib/ai/workspace-tools.ts. Dropping the classifier also removes a whole class
 * of failure where a question got routed to a persona whose tools could not
 * answer it.
 */

/** Purple, labelled "Billing" in the UI. The client keys colours off this. */
const AGENT_NAME = 'billing'

const SYSTEM_PROMPT = `You are the billing assistant inside Yeam, a denial-management tool used by medical billing teams.

You answer questions about THIS workspace's own data — the denials and claims its owners uploaded. You have three tools:
- workspace_overview — billed, paid, outstanding, denial rate, collection rate, amount at stake and amount recovered
- top_denial_reasons — denial reasons ranked by money, with the CARC code, what it means and the remedy that applies
- worklist_rows — individual denials in priority order, optionally filtered by payer

Rules:
- ALWAYS call a tool before answering a question about numbers, denials or claims. Never answer from memory and never estimate.
- Report what the tools return. If a tool comes back empty, say the workspace has no such data yet and suggest importing a file on the Connect data page — do not invent an example.
- If a result is marked partial, say the totals are a floor, not a total.
- The data is de-identified by design: there are no patient names, member IDs or dates of birth, and you cannot look a patient up. Say so plainly if asked.
- You can read but not change anything. If asked to mark a row worked, send an appeal or edit a claim, explain that it has to be done on the Worklist page.
- Money in US dollars. Be brief and concrete — a biller wants the number and the next action, not a preamble.`

type SSEEvent =
  | { type: 'routing'; message: string }
  | { type: 'agent'; name: string; message: string }
  | { type: 'tool_call'; tool: string }
  | { type: 'tool_result'; tool: string; count?: number }
  | { type: 'text'; content: string }
  | { type: 'done'; agentName: string }
  | { type: 'error'; message: string }

export async function POST(req: NextRequest) {
  // Resolves the caller's workspace and refuses when there isn't one. Every
  // tool below is scoped by this orgId and by nothing the model supplies.
  const org = await requireOrg()
  if (!org) {
    return new Response('This account is not part of a workspace yet.', { status: 403 })
  }

  let body: { message?: string; history?: Array<{ role: string; content: string }> }
  try { body = await req.json() }
  catch { return new Response('Invalid JSON', { status: 400 }) }

  const message = body.message?.trim()
  if (!message) return new Response('Missing message', { status: 400 })

  // Cap message + history size to keep one caller from running up the API bill.
  if (message.length > 2000) {
    return new Response('Message too long (max 2000 chars)', { status: 400 })
  }
  const history = (body.history ?? []).slice(-20).map(h => ({
    ...h,
    content: h.content.slice(0, 2000),
  }))

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

        send({ type: 'agent', name: AGENT_NAME, message: 'Reading your workspace...' })

        const contents: Content[] = [
          ...history.map<Content>(h => ({
            role: h.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: h.content }],
          })),
          { role: 'user', parts: [{ text: message }] },
        ]

        const model = getModel(SYSTEM_PROMPT)
        const first = await model.generateContent({ contents, tools: workspaceTools })
        const firstParts = first.response.candidates?.[0]?.content.parts ?? []
        const calls = firstParts.filter(p => p.functionCall)

        let finalText = ''

        if (calls.length > 0) {
          const responses: Part[] = await Promise.all(
            calls.map(async part => {
              const call = part.functionCall!
              send({ type: 'tool_call', tool: call.name })

              const result = isWorkspaceTool(call.name)
                ? await executeWorkspaceTool(
                    prisma,
                    org.orgId,
                    call.name,
                    (call.args ?? {}) as Record<string, unknown>,
                  )
                // A hallucinated tool name is told to the model rather than
                // thrown, so it can correct itself instead of the turn dying.
                : { error: `No such tool: ${call.name}` }

              send({ type: 'tool_result', tool: call.name, count: resultCount(result) })
              return { functionResponse: { name: call.name, response: result } } as Part
            }),
          )

          const second = await model.generateContentStream({
            contents: [
              ...contents,
              { role: 'model', parts: firstParts },
              { role: 'user', parts: responses },
            ],
            tools: workspaceTools,
          })

          for await (const chunk of second.stream) {
            const text = chunk.text()
            if (text) {
              finalText += text
              send({ type: 'text', content: text })
            }
          }
        } else {
          finalText = first.response.text()
          send({ type: 'text', content: finalText })
        }

        send({ type: 'done', agentName: AGENT_NAME })

        prisma.agentLog.create({
          data: {
            taskId: `chat-${Date.now()}`,
            agentName: 'BILLING',
            status: 'COMPLETE',
            intent: message.slice(0, 200),
            message: finalText.slice(0, 500),
            userId: org.userId,
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

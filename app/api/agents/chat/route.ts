import { NextRequest } from 'next/server'
import type { Content, Part } from '@google/generative-ai'
import { prisma } from '@/lib/db'
import { requireOrg } from '@/lib/org'
import { GEMINI_AVAILABLE, getModel } from '@/lib/ai/gemini-client'
import { finishReasonMessage, looksLikeRefusal } from '@/lib/ai/refusal'
import {
  executeWorkspaceTool,
  isWorkspaceTool,
  workspaceTools,
} from '@/lib/ai/workspace-tools'
import { buildTraceStep, type TraceStep } from '@/lib/ai/trace'
import { openTurn, closeTurn } from '@/lib/ai/conversations'

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
- worklist_rows — individual denials in priority order, optionally filtered by payer, or searched by free text over the claim number, payer, CARC, CPT, ICD-10 and denial reason

Rules:
- ALWAYS call a tool before answering a question about numbers, denials or claims. Never answer from memory and never estimate.
- When the user names a specific claim, code or payer, pass it to worklist_rows as its search argument rather than pulling a ranked list and reading it yourself. If the search comes back empty, say the workspace has no row matching that text — do not offer the nearest thing you saw as if it matched.
- Report what the tools return. If a tool comes back empty, say the workspace has no such data yet and suggest importing a file on the Connect data page — do not invent an example.
- If a result is marked partial, say the totals are a floor, not a total.
- The data is de-identified by design: no patient names, member IDs or dates of birth. When someone asks about a patient, answer with the claim number, payer, denial code and dollar amount — in this workspace that is what identifies a claim, so give that rather than describing what is missing.
- You read; the biller acts. When asked to mark a row worked, send an appeal or edit a claim, name the exact row — claim number and code — and say it is one click on the Worklist page. That is a direction, not a refusal.
- Money in US dollars. Be brief and concrete — a biller wants the number and the next action, not a preamble.
- You always have something to say. If a tool returns nothing, report the zero as a finding and name the next action. Never answer with only an apology, and never open by saying what you cannot do.`

/**
 * The wire format for one turn.
 *
 * `tool_call` and `tool_result` carry the arguments the model chose and a step
 * built from what actually came back, rather than a bare tool name the client
 * maps to a canned string. That is what the reasoning trace under an answer is
 * rendered from — see lib/ai/trace.ts.
 */
type SSEEvent =
  | { type: 'conversation'; id: string; title: string }
  | { type: 'agent'; name: string; message: string }
  | { type: 'tool_call'; tool: string; args: Record<string, unknown> }
  | { type: 'tool_result'; step: TraceStep }
  | { type: 'text'; content: string }
  /**
   * `refused` marks an answer that is prose but not an answer — the model
   * declining rather than failing. It is not an `error` event because the text
   * is worth keeping on screen; it only earns the turn a Retry button.
   */
  | { type: 'done'; agentName: string; refused: boolean }
  | { type: 'error'; message: string }

export async function POST(req: NextRequest) {
  // Resolves the caller's workspace and refuses when there isn't one. Every
  // tool below is scoped by this orgId and by nothing the model supplies.
  const org = await requireOrg()
  if (!org) {
    return new Response('This account is not part of a workspace yet.', { status: 403 })
  }

  let body: {
    message?: string
    history?: Array<{ role: string; content: string }>
    conversationId?: string
    retry?: boolean
  }
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

      // Collected as tools return and written with the answer, so the rail can
      // show how an answer was reached long after the stream closed.
      const trace: TraceStep[] = []
      let conversationId: string | null = null

      try {
        if (!GEMINI_AVAILABLE) {
          send({ type: 'error', message: 'GEMINI_API_KEY is not configured. Add it to .env.' })
          return
        }

        // Before the model runs: a question that fails still belongs in history,
        // and the client needs the id to keep the next turn in this thread.
        const conversation = await openTurn(prisma, {
          orgId: org.orgId,
          userId: org.userId,
          conversationId: body.conversationId,
          message,
          retry: body.retry,
        })
        conversationId = conversation.id
        send({ type: 'conversation', id: conversation.id, title: conversation.title })

        send({ type: 'agent', name: AGENT_NAME, message: 'Reading your workspace...' })

        const contents: Content[] = [
          ...history.map<Content>(h => ({
            role: h.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: h.content }],
          })),
          { role: 'user', parts: [{ text: message }] },
        ]

        // 0.2 rather than the 0.3 the drafting paths use: this surface reports
        // what the tools returned. The same question twice should give the same
        // answer twice, which is what a biller checking a number expects.
        const model = getModel(SYSTEM_PROMPT, { temperature: 0.2 })
        const first = await model.generateContent({ contents, tools: workspaceTools })

        const firstStop = finishReasonMessage(first.response.candidates?.[0]?.finishReason)
        if (firstStop) throw new Error(firstStop)
        const firstParts = first.response.candidates?.[0]?.content.parts ?? []
        const calls = firstParts.filter(p => p.functionCall)

        let finalText = ''

        if (calls.length > 0) {
          const responses: Part[] = await Promise.all(
            calls.map(async part => {
              const call = part.functionCall!
              const args = (call.args ?? {}) as Record<string, unknown>
              send({ type: 'tool_call', tool: call.name, args })

              const known = isWorkspaceTool(call.name)
              const result = known
                ? await executeWorkspaceTool(prisma, org.orgId, call.name, args, org.practiceWhere)
                // A hallucinated tool name is told to the model rather than
                // thrown, so it can correct itself instead of the turn dying.
                : { error: `No such tool: ${call.name}` }

              // A call that never ran is left out of the trace: the trace is
              // where an answer came from, and a refused name is not a source.
              if (known) {
                const step = buildTraceStep(call.name, args, result)
                trace.push(step)
                send({ type: 'tool_result', step })
              }
              return { functionResponse: { name: call.name, response: result } } as Part
            }),
          )

          const answered = [
            ...contents,
            { role: 'model', parts: firstParts },
            { role: 'user', parts: responses },
          ]

          const second = await model.generateContentStream({
            contents: answered,
            tools: workspaceTools,
          })

          for await (const chunk of second.stream) {
            const text = chunk.text()
            if (text) {
              finalText += text
              send({ type: 'text', content: text })
            }
          }

          const secondStop = finishReasonMessage(
            (await second.response).candidates?.[0]?.finishReason,
          )
          if (secondStop && !finalText.trim()) throw new Error(secondStop)

          // The tools ran and returned; coming back empty is the model losing
          // the thread, not an absence of data. One nudge, never a loop — a
          // second empty answer is a real failure and should read as one.
          if (!finalText.trim()) {
            const retry = await model.generateContentStream({
              contents: [
                ...answered,
                {
                  role: 'user',
                  parts: [{
                    text: 'Answer the question now from the tool results above. '
                      + 'Report the figures you were given and name the next action.',
                  }],
                },
              ],
              tools: workspaceTools,
            })
            for await (const chunk of retry.stream) {
              const text = chunk.text()
              if (text) {
                finalText += text
                send({ type: 'text', content: text })
              }
            }
          }
        } else {
          finalText = first.response.text()
          send({ type: 'text', content: finalText })
        }

        // A refusal is prose, so nothing upstream treats it as a failure and the
        // Retry button never appears — leaving the user staring at "I cannot"
        // with no way forward. The text still shows exactly as it came back;
        // this only earns them a second attempt.
        const refused = looksLikeRefusal(finalText)
        if (!finalText.trim()) {
          throw new Error('The model returned an empty answer. Try the question again.')
        }

        send({ type: 'done', agentName: AGENT_NAME, refused })

        // Awaited, unlike the activity log below: the client reloads this
        // conversation from the database on the next mount, so a write that
        // loses the race would make the answer vanish on refresh.
        await closeTurn(prisma, conversationId, {
          content: finalText,
          trace,
          agentName: AGENT_NAME,
          isError: refused,
        })

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
        const failure = err instanceof Error ? err.message : 'Unknown error occurred'
        send({ type: 'error', message: failure })

        // The question is already stored. Storing what came back keeps the
        // history honest about the turns that failed, and a stored trace shows
        // which tools had already run when it did.
        if (conversationId) {
          await closeTurn(prisma, conversationId, {
            content: failure,
            trace,
            agentName: AGENT_NAME,
            isError: true,
          }).catch(console.error)
        }
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

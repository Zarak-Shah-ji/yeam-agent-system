import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { dispatch } from '@/lib/agents/orchestrator'
import type { AgentEvent } from '@/lib/agents/types'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return new Response('Unauthorized', { status: 401 })
  }

  let body: { intent?: string; context?: Record<string, unknown> }
  try {
    body = await req.json()
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  const intent = body.intent?.trim()
  if (!intent) {
    return new Response('Missing intent', { status: 400 })
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const generator = await dispatch(
          intent,
          body.context ?? {},
          session.user?.id ?? 'anonymous',
          req.headers.get('x-session-id') ?? 'session-anon',
        )

        for await (const event of generator) {
          const data = serializeEvent(event)
          controller.enqueue(encoder.encode(`data: ${data}\n\n`))
        }

        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error'
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ status: 'error', message: errMsg })}\n\n`)
        )
      } finally {
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

function serializeEvent(event: AgentEvent): string {
  return JSON.stringify({
    ...event,
    timestamp: event.timestamp.toISOString(),
  })
}

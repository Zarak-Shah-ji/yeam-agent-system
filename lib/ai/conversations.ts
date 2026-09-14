import type { PrismaClient, Prisma } from '@prisma/client'
import type { TraceStep } from './trace'

/**
 * Reading and writing the chat history behind the agent rail.
 *
 * Split out of the route because the ownership check is the important part and
 * it is easy to lose in the middle of a streaming handler. A conversation id
 * arrives from the client, so it is untrusted input: every read and write below
 * is filtered by `orgId` AND `userId`, and a conversation that fails the filter
 * is treated as absent rather than as an error, which is what stops one
 * workspace probing another's ids.
 */

const TITLE_MAX = 60

/**
 * The opening question, trimmed, as the name of the conversation.
 *
 * Cut at a word boundary when there is one near the limit, so a title reads as
 * a phrase rather than stopping mid-word.
 */
export function titleFrom(message: string): string {
  const flat = message.replace(/\s+/g, ' ').trim()
  if (!flat) return 'New conversation'
  if (flat.length <= TITLE_MAX) return flat

  const cut = flat.slice(0, TITLE_MAX)
  const lastSpace = cut.lastIndexOf(' ')
  return `${lastSpace > TITLE_MAX * 0.6 ? cut.slice(0, lastSpace) : cut}…`
}

interface OpenTurnArgs {
  orgId: string
  userId: string
  /** From the client. Untrusted — verified against orgId + userId below. */
  conversationId?: string
  message: string
  /**
   * Re-running the previous question. The user row for it is already stored, so
   * this drops the answer that failed instead of recording the question twice.
   */
  retry?: boolean
}

/**
 * Start a turn: resolve the conversation and record the question.
 *
 * Returns the conversation the turn belongs to. When the supplied id is unknown
 * — stale tab, another workspace's id — a new conversation is started rather
 * than writing into someone else's.
 */
export async function openTurn(
  prisma: PrismaClient,
  { orgId, userId, conversationId, message, retry }: OpenTurnArgs,
): Promise<{ id: string; title: string }> {
  const existing = conversationId
    ? await prisma.agentConversation.findFirst({
        where: { id: conversationId, orgId, userId },
        select: { id: true, title: true },
      })
    : null

  if (!existing) {
    const created = await prisma.agentConversation.create({
      data: {
        orgId,
        userId,
        title: titleFrom(message),
        messages: { create: { role: 'user', content: message } },
      },
      select: { id: true, title: true },
    })
    return created
  }

  if (retry) {
    // Everything after the last question: the answer being replaced, and any
    // earlier failed attempt at it.
    const lastUser = await prisma.agentMessage.findFirst({
      where: { conversationId: existing.id, role: 'user' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    })
    if (lastUser) {
      await prisma.agentMessage.deleteMany({
        where: {
          conversationId: existing.id,
          role: 'assistant',
          createdAt: { gt: lastUser.createdAt },
        },
      })
    }
  } else {
    await prisma.agentMessage.create({
      data: { conversationId: existing.id, role: 'user', content: message },
    })
  }

  return existing
}

interface CloseTurnArgs {
  content: string
  trace: TraceStep[]
  agentName: string
  isError?: boolean
}

/**
 * Finish a turn: record the answer and the trace that produced it.
 *
 * Errors are stored too. A history that silently omits the turns that failed
 * would have a biller reading a conversation that never happened.
 */
export async function closeTurn(
  prisma: PrismaClient,
  conversationId: string,
  { content, trace, agentName, isError }: CloseTurnArgs,
): Promise<void> {
  await prisma.$transaction([
    prisma.agentMessage.create({
      data: {
        conversationId,
        role: 'assistant',
        content,
        trace: trace.length > 0 ? (trace as unknown as Prisma.InputJsonValue) : undefined,
        agentName,
        isError: isError ?? false,
      },
    }),
    prisma.agentConversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: new Date() },
    }),
  ])
}

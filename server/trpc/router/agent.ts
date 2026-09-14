import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { router, orgProcedure } from '../trpc'
import { parseTrace } from '@/lib/ai/trace'

/**
 * The chat history behind the agent rail.
 *
 * Conversations are written by the streaming route (app/api/agents/chat), which
 * cannot go through tRPC; this is the read side plus deletion. Both filters
 * matter and neither is optional: `orgId` is the tenant boundary, and `userId`
 * is because a conversation is one biller's own — a shared workspace is not a
 * shared inbox. Every `where` below carries both.
 */

const MAX_CONVERSATIONS = 50

export const agentRouter = router({
  /** The history list: newest first, titles only. */
  conversations: orgProcedure.query(async ({ ctx }) => {
    return ctx.prisma.agentConversation.findMany({
      where: { orgId: ctx.orgId, userId: ctx.session.user!.id },
      orderBy: { lastMessageAt: 'desc' },
      take: MAX_CONVERSATIONS,
      select: { id: true, title: true, lastMessageAt: true },
    })
  }),

  /** One conversation, with its messages and the trace behind each answer. */
  conversation: orgProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const conversation = await ctx.prisma.agentConversation.findFirst({
        where: { id: input.id, orgId: ctx.orgId, userId: ctx.session.user!.id },
        select: {
          id: true,
          title: true,
          messages: {
            orderBy: { createdAt: 'asc' },
            select: {
              id: true,
              role: true,
              content: true,
              trace: true,
              agentName: true,
              isError: true,
            },
          },
        },
      })

      // NOT_FOUND rather than FORBIDDEN on an id from another workspace: the
      // two must be indistinguishable, or the error itself confirms the id.
      if (!conversation) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Conversation not found.' })
      }

      return {
        id: conversation.id,
        title: conversation.title,
        messages: conversation.messages.map(m => ({
          id: m.id,
          role: m.role === 'user' ? ('user' as const) : ('assistant' as const),
          content: m.content,
          trace: parseTrace(m.trace),
          agentName: m.agentName ?? undefined,
          isError: m.isError,
        })),
      }
    }),

  deleteConversation: orgProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // deleteMany, not delete: it takes the ownership filter in the same
      // statement, so there is no read-then-write window and no id to leak.
      // Messages go with it via onDelete: Cascade.
      const { count } = await ctx.prisma.agentConversation.deleteMany({
        where: { id: input.id, orgId: ctx.orgId, userId: ctx.session.user!.id },
      })
      return { deleted: count }
    }),
})

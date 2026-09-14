import { router, publicProcedure, protectedProcedure } from '../trpc'
import { prisma } from '@/lib/db'
import { TRPCError } from '@trpc/server'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { SIGNUP_CLOSED_MESSAGE, signupAllowed } from '@/lib/signup-access'
import { deriveOrgName } from '@/lib/org'
import { sendVerificationEmail } from '@/lib/email/verification'
import { EMAIL_AVAILABLE } from '@/lib/email/client'
import { createRateLimiter } from '@/lib/appeals/rate-limit'

export const authRouter = router({
  signup: publicProcedure
    .input(
      z.object({
        email: z.string().email(),
        name: z.string().min(1),
        password: z.string().min(6),
        // Optional: the signup form does not ask yet, and a derived name is
        // better than blocking registration on a field nobody wants to fill in.
        organizationName: z.string().min(1).max(120).optional(),
      })
    )
    .mutation(async ({ input }) => {
      // Registration is allowlisted; see lib/signup-access.ts for why.
      if (!signupAllowed(input.email)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: SIGNUP_CLOSED_MESSAGE })
      }

      const existing = await prisma.user.findUnique({ where: { email: input.email } })
      if (existing) {
        throw new TRPCError({ code: 'CONFLICT', message: 'An account with this email already exists.' })
      }

      const passwordHash = await bcrypt.hash(input.password, 12)

      // The account and its workspace are created together, or not at all. A
      // user row without an org is one that every org-scoped query has to make
      // an exception for, so don't create one.
      await prisma.user.create({
        data: {
          email: input.email,
          name: input.name,
          passwordHash,
          // Whoever creates the workspace administers it.
          role: 'ADMIN',
          org: {
            create: {
              name: input.organizationName?.trim() || deriveOrgName(input.email, input.name),
            },
          },
        },
        select: { id: true },
      })

      // The workspace opens empty, on the import screen, rather than on a
      // seeded sample practice. Same reason as the OAuth path in lib/org.ts:
      // the first screen should ask for the customer's file, not explain away
      // someone else's numbers.

      // Confirm the address, but do not stake the signup on it. The account and
      // its workspace are already committed at this point, so a provider outage
      // here would otherwise turn a successful registration into an error the
      // user cannot retry — the second attempt would hit the CONFLICT above.
      // They land on the banner instead, which offers the resend.
      await sendVerificationEmail(prisma, input.email).catch(err =>
        console.error('verification email failed for', input.email, err),
      )

      return { success: true }
    }),

  /**
   * Send another verification link to the signed-in user's own address.
   *
   * The address comes from the session, never from input: taking it from the
   * caller would make this an open relay that mails an arbitrary stranger a
   * Yeam-branded link on demand.
   *
   * Throttled because it is an unauthenticated-in-effect way to spend the mail
   * quota and to put mail in someone's inbox — the session proves who is
   * asking, not that they should be able to ask a hundred times.
   */
  resendVerification: protectedProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.session.user?.id
    if (!userId) throw new TRPCError({ code: 'UNAUTHORIZED' })

    if (!EMAIL_AVAILABLE) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'Email is not configured on this deployment.',
      })
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, emailVerified: true },
    })
    if (!user) throw new TRPCError({ code: 'NOT_FOUND' })

    // Already done. Not an error — a second tab, or a click after verifying
    // elsewhere — so say so rather than sending a link that would be a no-op.
    if (user.emailVerified) return { sent: false, alreadyVerified: true }

    if (resendLimiter.limited(userId)) {
      throw new TRPCError({
        code: 'TOO_MANY_REQUESTS',
        message: 'Too many requests. Try again in an hour.',
      })
    }
    resendLimiter.record(userId)

    const result = await sendVerificationEmail(prisma, user.email)
    if (!result.ok) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Could not send the email. Try again shortly.',
      })
    }

    return { sent: true, alreadyVerified: false }
  }),
})

/**
 * Keyed by user id rather than IP: the point is to cap how much mail one
 * account can generate, and an office behind one address would otherwise share
 * a bucket. In-memory and per-instance, like the appeal limiters — enough to
 * stop a stuck button, not a quota.
 */
const resendLimiter = createRateLimiter('resend-verification', 5)

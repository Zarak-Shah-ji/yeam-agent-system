import { router, publicProcedure } from '../trpc'
import { prisma } from '@/lib/db'
import { TRPCError } from '@trpc/server'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { SIGNUP_CLOSED_MESSAGE, signupAllowed } from '@/lib/signup-access'
import { deriveOrgName } from '@/lib/org'

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
      return { success: true }
    }),
})

import { router, publicProcedure } from '../trpc'
import { prisma } from '@/lib/db'
import { TRPCError } from '@trpc/server'
import bcrypt from 'bcryptjs'
import { z } from 'zod'

export const authRouter = router({
  signup: publicProcedure
    .input(
      z.object({
        email: z.string().email(),
        name: z.string().min(1),
        password: z.string().min(6),
      })
    )
    .mutation(async ({ input }) => {
      const existing = await prisma.user.findUnique({ where: { email: input.email } })
      if (existing) {
        throw new TRPCError({ code: 'CONFLICT', message: 'An account with this email already exists.' })
      }

      const passwordHash = await bcrypt.hash(input.password, 12)
      await prisma.user.create({
        data: {
          email: input.email,
          name: input.name,
          passwordHash,
          role: 'FRONT_DESK',
        },
      })

      return { success: true }
    }),
})

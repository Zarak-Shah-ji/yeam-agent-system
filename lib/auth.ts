import NextAuth from 'next-auth'
import { PrismaAdapter } from '@auth/prisma-adapter'
import Credentials from 'next-auth/providers/credentials'
import Google from 'next-auth/providers/google'
import { prisma } from '@/lib/db'
import bcrypt from 'bcryptjs'
import { z } from 'zod'

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
})

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  secret: process.env.AUTH_SECRET,
  // Derive callback/redirect URLs from the incoming Host header. Without this,
  // a request served on the custom domain (app.yeam.ai) would be redirected to
  // whatever AUTH_URL points at, bouncing users onto the *.vercel.app alias
  // partway through sign-in. AUTH_URL, when set, still wins.
  trustHost: true,
  // JWT strategy is required: the Credentials provider cannot use database
  // sessions. OAuth users/accounts are still persisted via the adapter.
  session: { strategy: 'jwt' },
  pages: {
    signIn: '/login',
  },
  callbacks: {
    // No signIn gate: "Continue with Google" provisions an account on first use,
    // from either /login or /signup. The adapter creates the User row, and the
    // schema defaults new users to role FRONT_DESK. This matches the fact that
    // /signup already lets anyone self-register with email and password.
    jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.role = (user as { role?: string }).role
      }
      return token
    },
    session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.id as string
        ;(session.user as { role?: string }).role = token.role as string
      }
      return session
    },
  },
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID ?? process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET ?? process.env.GOOGLE_CLIENT_SECRET,
      // Link Google sign-in to an existing user with the same verified email
      // (e.g. someone who first signed up with email/password).
      allowDangerousEmailAccountLinking: true,
    }),
    Credentials({
      async authorize(credentials) {
        try {
          const parsed = loginSchema.safeParse(credentials)
          if (!parsed.success) return null

          const user = await prisma.user.findUnique({
            where: { email: parsed.data.email },
          })

          if (!user?.passwordHash) return null

          const valid = await bcrypt.compare(parsed.data.password, user.passwordHash)
          if (!valid) return null

          return {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
          }
        } catch {
          return null
        }
      },
    }),
  ],
})

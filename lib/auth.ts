import NextAuth from 'next-auth'
import { PrismaAdapter } from '@auth/prisma-adapter'
import Credentials from 'next-auth/providers/credentials'
import Google from 'next-auth/providers/google'
import { prisma } from '@/lib/db'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { signupAllowed } from '@/lib/signup-access'

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
    // Send auth errors to the login page instead of NextAuth's built-in error
    // route, which renders a 500. Without this, a stale link to a provider we
    // no longer register (e.g. /api/auth/signin/github) is a hard error page.
    error: '/login',
  },
  callbacks: {
    // Gate account CREATION, not sign-in. Anyone who already has a User row
    // signs in normally — that keeps the demo logins working. A first-time
    // address may only provision if it is on the signup allowlist, which
    // closes the "Continue with Google" auto-provisioning door that used to
    // let any Google account into the app. See lib/signup-access.ts.
    async signIn({ user }) {
      const email = user.email?.toLowerCase()
      if (!email) return false

      const existing = await prisma.user.findUnique({ where: { email } })
      if (existing) return true

      return signupAllowed(email)
    },
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

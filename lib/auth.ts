import NextAuth from 'next-auth'
import { PrismaAdapter } from '@auth/prisma-adapter'
import Credentials from 'next-auth/providers/credentials'
import Google from 'next-auth/providers/google'
import { prisma } from '@/lib/db'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { signupAllowed } from '@/lib/signup-access'
import { ensureOrgForUser } from '@/lib/org'

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
      if (existing) {
        // Heal an account that has no workspace.
        //
        // ensureOrgForUser used to run from exactly one place: the createUser
        // event, which Auth.js fires only on the sign-in that first creates or
        // links the account. Every later sign-in finds the Account row and
        // returns before that event. So an account whose provisioning was
        // skipped — created before organizations existed, or linked by email
        // from a Google sign-in whose createUser threw — stayed orgless
        // forever, and orgProcedure refuses every org-scoped query with
        // FORBIDDEN. That is an account that can sign in and then reach
        // nothing, including the import page that would have fixed it.
        //
        // Doing it here instead means the repair is a sign-in away rather than
        // a manual database edit. Best-effort for the same reason as the stamp:
        // a workspace we failed to create is a bad first screen, not a reason
        // to refuse a valid login.
        if (!existing.orgId) {
          try {
            await ensureOrgForUser(existing.id)
          } catch (err) {
            console.error('workspace backfill failed for user', existing.id, err)
          }
        }

        return true
      }

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
  events: {
    // OAuth accounts are provisioned by the Prisma adapter, which knows nothing
    // about organizations. This is the only hook that fires after that row
    // exists, so it is where a Google signup gets its workspace. The credentials
    // path creates both together in authRouter.signup and never reaches here.
    async createUser({ user }) {
      if (user.id) await ensureOrgForUser(user.id)
    },

    // The only record that a sign-in happened. JWT sessions mean the sessions
    // table is never written, so without this the app cannot answer "who has
    // been using it" at all.
    //
    // This used to live in the signIn CALLBACK, inside the branch taken when an
    // existing user row is found. That branch cannot run on a first Google
    // sign-in: the callback is the gate deciding whether the account may be
    // created, so it fires before the adapter writes the row and `existing` is
    // null. Every Google signup's first session therefore went unrecorded and
    // lastLoginAt stayed null until the person came back — wrong for precisely
    // the arrivals most worth knowing about, and silently so.
    //
    // The signIn EVENT fires after the row is written, for every provider, so
    // user.id is real whether this is the first sign-in or the hundredth.
    // Best-effort, like the backfill above: a failed stamp must never cost
    // someone their login.
    async signIn({ user }) {
      if (!user.id) return
      await prisma.user
        .update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
        .catch(() => {})
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

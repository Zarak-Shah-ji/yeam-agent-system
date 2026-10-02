import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { EMAIL_AVAILABLE } from '@/lib/email/client'
import { VerifyEmailBanner } from '@/components/layout/VerifyEmailBanner'
import { VerifiedToast } from '@/components/layout/VerifiedToast'
import { SidebarProvider } from '@/components/layout/sidebar-context'
import { ChatProvider } from '@/components/layout/chat-context'
import { SessionProviderWrapper } from '@/components/layout/SessionProviderWrapper'
import { Sidebar } from '@/components/layout/Sidebar'
import { MobileBackdrop } from '@/components/layout/MobileBackdrop'
import { TopBar } from '@/components/layout/TopBar'
import { AgentRail } from '@/components/agent/AgentRail'
import { AgentOverlay } from '@/components/agent/AgentOverlay'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth()
  if (!session?.user) {
    redirect('/login')
  }

  // Resolved here rather than in the banner or the sidebar: a client query would
  // flash them in a frame after the page had already rendered without them,
  // which reads as a glitch rather than as a notice.
  //
  // The banner is guarded on EMAIL_AVAILABLE — there is no point telling
  // someone to confirm an address when the deployment cannot send them anything
  // to confirm it with.
  const account = session.user.id
    ? await prisma.user.findUnique({
        where: { id: session.user.id },
        select: {
          email: true,
          emailVerified: true,
          role: true,
          org: { select: { name: true, _count: { select: { users: true } } } },
        },
      })
    : null

  let unverifiedEmail: string | null = null
  if (EMAIL_AVAILABLE && account && !account.emailVerified) unverifiedEmail = account.email

  // What the sidebar prints under the signed-in name. It used to print the
  // session's role, which for every real account is "admin": each signup
  // creates its own workspace and administers it, and there is no invite flow
  // yet. A label everybody shares tells nobody anything, so the role is only
  // passed once someone else is in the workspace to tell it apart from. Read
  // here rather than from the JWT, which is stamped once at sign-in.
  const workspace = account?.org
    ? {
        name: account.org.name,
        role: account.org._count.users > 1 ? account.role : null,
      }
    : null

  return (
    <SessionProviderWrapper>
    <SidebarProvider>
    <ChatProvider>
      <div className="flex h-screen overflow-hidden bg-gray-50">
        {/* Mobile backdrop */}
        <MobileBackdrop />

        {/* Left sidebar - collapsible, default closed */}
        <Sidebar workspace={workspace} />

        {/* Main area */}
        <div className="flex flex-1 flex-col overflow-hidden min-w-0">
          {/* Top bar. A client component because it tints itself when the
              view is isolated to one practice — see TopBar.tsx. */}
          <TopBar />

          {/* Content + agent rail */}
          <div className="flex flex-1 overflow-hidden min-w-0">
            {/* Page content */}
            <main className="flex-1 overflow-y-auto p-4 md:p-6 min-w-0">
              {/* Unconditional, unlike the banner: a link can be clicked long
                  after a provider key was removed, and the reader still
                  deserves an answer. Costs nothing when the param is absent. */}
              <VerifiedToast />
              {unverifiedEmail && <VerifyEmailBanner email={unverifiedEmail} />}
              {children}
            </main>

            {/* The agent: chat, its history and the activity feed, in one
                rail. Inline from xl, floating over the content below that. */}
            <AgentRail />
          </div>
        </div>
      </div>

      {/* The expanded conversation, over a blurred workspace. Outside the
          layout flow because it covers all of it. */}
      <AgentOverlay />
    </ChatProvider>
    </SidebarProvider>
    </SessionProviderWrapper>
  )
}

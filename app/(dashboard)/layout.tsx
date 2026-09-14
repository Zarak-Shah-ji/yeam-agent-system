import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { SidebarProvider } from '@/components/layout/sidebar-context'
import { ChatProvider } from '@/components/layout/chat-context'
import { SessionProviderWrapper } from '@/components/layout/SessionProviderWrapper'
import { Sidebar } from '@/components/layout/Sidebar'
import { MobileBackdrop } from '@/components/layout/MobileBackdrop'
import { HamburgerButton } from '@/components/layout/HamburgerButton'
import { PageTitle } from '@/components/layout/PageTitle'
import { AgentTrigger } from '@/components/agent/AgentTrigger'
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

  return (
    <SessionProviderWrapper>
    <SidebarProvider>
    <ChatProvider>
      <div className="flex h-screen overflow-hidden bg-gray-50">
        {/* Mobile backdrop */}
        <MobileBackdrop />

        {/* Left sidebar - collapsible, default closed */}
        <Sidebar />

        {/* Main area */}
        <div className="flex flex-1 flex-col overflow-hidden min-w-0">
          {/* Top bar */}
          <div className="flex h-14 shrink-0 items-center gap-2 border-b border-gray-200 bg-white px-3 md:px-4">
            <HamburgerButton />
            <PageTitle />
            <AgentTrigger />
          </div>

          {/* Content + agent rail */}
          <div className="flex flex-1 overflow-hidden min-w-0">
            {/* Page content */}
            <main className="flex-1 overflow-y-auto p-4 md:p-6 min-w-0">
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

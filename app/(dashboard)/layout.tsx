import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { SidebarProvider } from '@/components/layout/sidebar-context'
import { ChatProvider } from '@/components/layout/chat-context'
import { SessionProviderWrapper } from '@/components/layout/SessionProviderWrapper'
import { Sidebar } from '@/components/layout/Sidebar'
import { MobileBackdrop } from '@/components/layout/MobileBackdrop'
import { HamburgerButton } from '@/components/layout/HamburgerButton'
import { TopBarCommandBar } from '@/components/layout/TopBarCommandBar'
import { RightSidebar } from '@/components/layout/RightSidebar'
import { RightPanelToggle } from '@/components/layout/RightPanelToggle'

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
            <TopBarCommandBar />
            <RightPanelToggle />
          </div>

          {/* Content + Agent Feed */}
          <div className="flex flex-1 overflow-hidden min-w-0">
            {/* Page content */}
            <main className="flex-1 overflow-y-auto p-4 md:p-6 min-w-0">
              {children}
            </main>

            {/* Right sidebar - collapsible agent activity feed */}
            <RightSidebar />
          </div>
        </div>
      </div>
    </ChatProvider>
    </SidebarProvider>
    </SessionProviderWrapper>
  )
}

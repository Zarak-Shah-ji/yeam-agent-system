import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { SidebarProvider } from '@/components/layout/sidebar-context'
import { Sidebar } from '@/components/layout/Sidebar'
import { MobileBackdrop } from '@/components/layout/MobileBackdrop'
import { HamburgerButton } from '@/components/layout/HamburgerButton'
import { Header } from '@/components/layout/Header'
import { AgentActivityFeed } from '@/components/layout/AgentActivityFeed'
import { CommandBar } from '@/components/layout/CommandBar'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth()
  if (!session?.user) {
    redirect('/login')
  }

  const userName = session.user.name
  const userRole = (session.user as { role?: string }).role

  return (
    <SidebarProvider>
      <div className="flex h-screen overflow-hidden bg-gray-50">
        {/* Mobile backdrop */}
        <MobileBackdrop />

        {/* Sidebar — fixed drawer on mobile, inline on md+ */}
        <Sidebar />

        {/* Main area — needs min-w-0 to prevent flex overflow */}
        <div className="flex flex-1 flex-col overflow-hidden min-w-0">
          {/* Top bar */}
          <div className="flex h-14 shrink-0 items-center gap-2 border-b border-gray-200 bg-white px-3 md:px-4">
            <HamburgerButton />
            <CommandBar />
            <Header userName={userName} userRole={userRole} />
          </div>

          {/* Content + Agent Feed */}
          <div className="flex flex-1 overflow-hidden min-w-0">
            {/* Page content */}
            <main className="flex-1 overflow-y-auto p-4 md:p-6 min-w-0">
              {children}
            </main>

            {/* Agent activity feed — hidden on mobile/tablet, visible on lg+ */}
            <aside className="hidden lg:flex w-72 shrink-0 flex-col overflow-hidden border-l border-gray-200 bg-white">
              <AgentActivityFeed />
            </aside>
          </div>
        </div>
      </div>
    </SidebarProvider>
  )
}

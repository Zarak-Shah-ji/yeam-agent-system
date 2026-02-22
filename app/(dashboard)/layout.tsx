import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { Sidebar } from '@/components/layout/Sidebar'
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
    <div className="flex h-screen overflow-hidden bg-gray-50">
      {/* Sidebar */}
      <Sidebar />

      {/* Main area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top bar: CommandBar + Header */}
        <div className="flex h-14 items-center gap-3 border-b border-gray-200 bg-white px-4">
          <CommandBar />
          <Header userName={userName} userRole={userRole} />
        </div>

        {/* Content + Agent Feed */}
        <div className="flex flex-1 overflow-hidden">
          {/* Page content */}
          <main className="flex-1 overflow-y-auto p-6">
            {children}
          </main>

          {/* Agent activity feed panel */}
          <aside className="w-72 shrink-0 overflow-hidden border-l border-gray-200 bg-white">
            <AgentActivityFeed />
          </aside>
        </div>
      </div>
    </div>
  )
}

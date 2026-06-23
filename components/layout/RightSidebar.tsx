'use client'

import { useSidebar } from './sidebar-context'
import { AgentActivityFeed } from './AgentActivityFeed'

export function RightSidebar() {
  const { isRightOpen, toggleRight } = useSidebar()
  if (!isRightOpen) return null
  return (
    <>
      {/* Mobile/tablet: scrim behind the panel */}
      <div
        className="fixed inset-0 z-30 bg-black/20 lg:hidden"
        onClick={toggleRight}
        aria-hidden
      />
      {/* Panel: fixed overlay on mobile/tablet, inline on desktop */}
      <aside className="fixed right-0 top-[3.5rem] bottom-0 z-40 w-80 flex flex-col overflow-hidden border-l border-gray-200 bg-white shadow-xl lg:static lg:z-auto lg:w-72 lg:shadow-none lg:top-auto lg:bottom-auto">
        <AgentActivityFeed />
      </aside>
    </>
  )
}

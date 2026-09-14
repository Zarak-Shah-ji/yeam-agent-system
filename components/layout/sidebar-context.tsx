'use client'

import { createContext, useContext, useState } from 'react'

/**
 * The left nav's open/closed state.
 *
 * This used to also hold `isRightOpen` for the agent panel. The agent now owns
 * its own visibility in chat-context (`surface`), because "is the rail open"
 * and "is the conversation expanded to the overlay" are one piece of state, not
 * a boolean here and another one there.
 */
interface SidebarCtx {
  isOpen: boolean
  toggle(): void
  close(): void
}

const SidebarContext = createContext<SidebarCtx>({
  isOpen: false,
  toggle() {},
  close() {},
})

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  return (
    <SidebarContext.Provider
      value={{
        isOpen,
        toggle: () => setIsOpen(p => !p),
        close: () => setIsOpen(false),
      }}
    >
      {children}
    </SidebarContext.Provider>
  )
}

export const useSidebar = () => useContext(SidebarContext)

'use client'

import { createContext, useContext, useState } from 'react'

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

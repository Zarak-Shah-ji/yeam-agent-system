'use client'

import { createContext, useContext, useState } from 'react'

interface SidebarCtx {
  isOpen: boolean
  toggle(): void
  close(): void
  isRightOpen: boolean
  toggleRight(): void
}

const SidebarContext = createContext<SidebarCtx>({
  isOpen: false,
  toggle() {},
  close() {},
  isRightOpen: false,
  toggleRight() {},
})

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const [isRightOpen, setIsRightOpen] = useState(false)
  return (
    <SidebarContext.Provider
      value={{
        isOpen,
        toggle: () => setIsOpen(p => !p),
        close: () => setIsOpen(false),
        isRightOpen,
        toggleRight: () => setIsRightOpen(p => !p),
      }}
    >
      {children}
    </SidebarContext.Provider>
  )
}

export const useSidebar = () => useContext(SidebarContext)

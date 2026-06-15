'use client'

import { useSidebar } from './sidebar-context'

export function MobileBackdrop() {
  const { isOpen, close } = useSidebar()
  if (!isOpen) return null
  return (
    <div
      className="fixed inset-0 z-40 bg-black/30 md:hidden"
      onClick={close}
      aria-hidden="true"
    />
  )
}

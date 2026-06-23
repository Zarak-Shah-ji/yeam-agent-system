'use client'

import { usePathname } from 'next/navigation'
import { CommandBar } from './CommandBar'

// Renders CommandBar in the top bar only on non-home routes.
// The home page hosts its own hero-sized instance.
export function TopBarCommandBar() {
  const pathname = usePathname()
  if (pathname === '/') return null
  return <CommandBar />
}

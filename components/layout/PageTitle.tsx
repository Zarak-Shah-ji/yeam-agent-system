'use client'

import { usePathname } from 'next/navigation'

/**
 * The name of the section you are in.
 *
 * The top bar used to be filled edge to edge by the agent input; with that
 * gone it would otherwise be a hamburger and a lot of nothing. Titles match
 * the labels in Sidebar.tsx — two lists, but the alternative is exporting the
 * nav from a client component that also owns the session and the theme.
 */
const TITLES: Record<string, string> = {
  '/worklist': 'Worklist',
  '/claims': 'Claims',
  '/analytics': 'Analytics',
  '/payers': 'Payers',
  '/connect': 'Connect data',
  '/settings': 'Settings',
}

export function PageTitle() {
  const pathname = usePathname()
  const match = Object.keys(TITLES).find(href => pathname.startsWith(href))
  if (!match) return null
  return <h1 className="truncate text-sm font-medium text-gray-900">{TITLES[match]}</h1>
}

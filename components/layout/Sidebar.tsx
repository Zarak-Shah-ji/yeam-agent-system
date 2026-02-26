'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Users,
  Calendar,
  FileText,
  CreditCard,
  BarChart3,
  Activity,
  Stethoscope,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const navItems = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/patients', label: 'Patients', icon: Users },
  { href: '/appointments', label: 'Appointments', icon: Calendar },
  { href: '/encounters', label: 'Encounters', icon: FileText },
  { href: '/claims', label: 'Claims', icon: CreditCard },
  { href: '/billing', label: 'Billing', icon: Activity },
  { href: '/analytics', label: 'Analytics', icon: BarChart3 },
]

export function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className="flex h-full w-56 flex-col border-r border-gray-200 bg-gray-50">
      {/* Logo */}
      <div className="flex h-14 items-center gap-2 border-b border-gray-200 px-4">
        <Stethoscope className="h-5 w-5 text-blue-600" />
        <span className="font-semibold text-gray-900">Yeam.ai EHR</span>
      </div>

      {/* Clinic name */}
      <div className="px-4 py-2 text-xs text-gray-500 font-medium truncate">
        TX Medicaid Dataset
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-0.5 px-2 py-2">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = href === '/' ? pathname === '/' : pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                active
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </Link>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-gray-200 p-3 text-xs text-gray-400">
        Phase 2 · v0.2.0
      </div>
    </aside>
  )
}

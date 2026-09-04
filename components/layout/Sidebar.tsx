'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useSession, signOut } from 'next-auth/react'
import {
  ListChecks,
  CreditCard,
  BarChart3,
  Building2,
  PlugZap,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Sun,
  Moon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSidebar } from './sidebar-context'
import { useTheme } from './theme-context'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'

// One nav, for one workspace.
//
// There used to be a second group here pointing at /demo — a parallel set of
// sections over seeded EHR tables that no customer's upload could ever reach.
// It made the real product look empty on day one and taught people that the
// sample was somewhere else. The sample is now seeded into the workspace's own
// tables as an import batch, so these sections show it directly and a banner
// says so. See lib/sample-practice.ts.
const navItems = [
  { href: '/worklist', label: 'Worklist', icon: ListChecks },
  { href: '/claims', label: 'Claims', icon: CreditCard },
  { href: '/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/payers', label: 'Payers', icon: Building2 },
  { href: '/connect', label: 'Connect data', icon: PlugZap },
]

// The icon is chosen by the `dark:` variant rather than by React state so it
// is correct on the very first paint, before hydration has told us the theme.
function ThemeIcon({ className }: { className: string }) {
  return (
    <>
      <Moon className={cn(className, 'dark:hidden')} />
      <Sun className={cn(className, 'hidden dark:block')} />
    </>
  )
}

export function Sidebar() {
  const pathname = usePathname()
  const { isOpen, toggle, close } = useSidebar()
  const { data: session } = useSession()
  const { theme, toggle: toggleTheme } = useTheme()
  const userName = session?.user?.name
  const userRole = (session?.user as { role?: string })?.role
  const initials = userName
    ? userName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
    : '?'

  return (
    <aside
      className={cn(
        'flex h-full shrink-0 flex-col border-r border-gray-200 bg-gray-50',
        // Mobile: fixed overlay with full width, slides in/out
        'fixed inset-y-0 left-0 z-50 w-56 transition-transform duration-200 ease-in-out',
        isOpen ? 'translate-x-0' : '-translate-x-full',
        // Desktop: static in layout flow, width transitions
        'md:static md:translate-x-0 md:transition-all md:duration-200',
        isOpen ? 'md:w-56' : 'md:w-14',
      )}
    >
      {/* Header: brand + collapse toggle */}
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-gray-200 px-3">
        {isOpen && (
          <span className="font-semibold text-gray-900 text-base">Yeam.ai</span>
        )}
        <button
          onClick={toggle}
          className={cn(
            'flex items-center justify-center rounded-md p-1.5 text-gray-500 hover:bg-gray-200 transition-colors',
            !isOpen && 'mx-auto',
          )}
          title={isOpen ? 'Collapse sidebar' : 'Expand sidebar'}
        >
          {isOpen
            ? <ChevronLeft className="h-4 w-4" />
            : <ChevronRight className="h-4 w-4" />
          }
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-0.5 px-2 py-2">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              onClick={close}
              title={!isOpen ? label : undefined}
              className={cn(
                'flex items-center gap-2.5 rounded-md py-2 text-sm font-medium transition-colors',
                isOpen ? 'px-3' : 'justify-center px-2',
                active
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {isOpen && <span>{label}</span>}
            </Link>
          )
        })}
      </nav>

      {/* User info + sign out */}
      <div className={cn('border-t border-gray-200 shrink-0', isOpen ? 'p-3' : 'p-2')}>
        {isOpen ? (
          <div className="flex items-center gap-2">
            <Avatar className="h-7 w-7 shrink-0">
              <AvatarFallback className="text-xs">{initials}</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-gray-900 truncate">{userName ?? 'User'}</p>
              {userRole && (
                <p className="text-xs text-gray-500 truncate capitalize">
                  {userRole.toLowerCase().replace('_', ' ')}
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                onClick={toggleTheme}
                title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                className="rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-600 transition-colors"
              >
                <ThemeIcon className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => signOut({ callbackUrl: '/login' })}
                title="Sign out"
                className="rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-600 transition-colors"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            <button
              onClick={toggleTheme}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              className="flex items-center justify-center w-full rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-600 transition-colors"
            >
              <ThemeIcon className="h-4 w-4" />
            </button>
            <button
              onClick={() => signOut({ callbackUrl: '/login' })}
              title="Sign out"
              className="flex items-center justify-center w-full rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-600 transition-colors"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        )}
        {isOpen && (
          <p className="text-xs text-gray-400 mt-1.5">Phase 3 - v0.3.0</p>
        )}
      </div>
    </aside>
  )
}

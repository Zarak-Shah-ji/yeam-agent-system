'use client'

import { signOut } from 'next-auth/react'
import { LogOut } from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'

interface HeaderProps {
  userName?: string | null
  userRole?: string | null
}

export function Header({ userName, userRole }: HeaderProps) {
  const initials = userName
    ? userName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
    : '?'

  return (
    <header className="flex h-14 items-center justify-end gap-3 border-b border-gray-200 bg-white px-4">
      <div className="text-right">
        <p className="text-sm font-medium text-gray-900">{userName ?? 'User'}</p>
        {userRole && (
          <p className="text-xs text-gray-500 capitalize">{userRole.toLowerCase().replace('_', ' ')}</p>
        )}
      </div>
      <Avatar>
        <AvatarFallback>{initials}</AvatarFallback>
      </Avatar>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => signOut({ callbackUrl: '/login' })}
        title="Sign out"
      >
        <LogOut className="h-4 w-4 text-gray-500" />
      </Button>
    </header>
  )
}

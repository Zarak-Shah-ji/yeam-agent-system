'use client'

import { Bot } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useSidebar } from './sidebar-context'
import { cn } from '@/lib/utils'

export function RightPanelToggle() {
  const { isRightOpen, toggleRight } = useSidebar()
  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn('flex shrink-0 ml-auto', isRightOpen && 'text-blue-600 bg-blue-50 hover:bg-blue-100')}
      onClick={toggleRight}
      title={isRightOpen ? 'Close agent feed' : 'Open agent feed'}
    >
      <Bot className="h-4 w-4" />
    </Button>
  )
}

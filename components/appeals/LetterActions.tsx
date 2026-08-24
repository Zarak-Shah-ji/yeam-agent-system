'use client'

import { useState } from 'react'
import { Check, Copy, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'

/** Copy + download controls shared by showcase cards and freshly drafted letters. */
export function LetterActions({ letter, filename }: { letter: string; filename: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(letter)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard is unavailable over plain http or without permission — the
      // letter is selectable on the page, so this degrades quietly.
    }
  }

  function download() {
    const blob = new Blob([letter], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" size="sm" onClick={copy}>
        {copied ? <Check className="mr-1.5 h-3.5 w-3.5" /> : <Copy className="mr-1.5 h-3.5 w-3.5" />}
        {copied ? 'Copied' : 'Copy'}
      </Button>
      <Button type="button" variant="outline" size="sm" onClick={download}>
        <Download className="mr-1.5 h-3.5 w-3.5" />
        Download .txt
      </Button>
    </div>
  )
}

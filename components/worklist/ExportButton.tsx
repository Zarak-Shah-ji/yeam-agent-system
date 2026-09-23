'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * Take the queue away as a file.
 *
 * Four things to offer — the rows on screen or the whole workspace, as CSV or as
 * Excel — and every one of them is a plain link to app/api/worklist/export. The
 * response carries `Content-Disposition: attachment`, so the browser downloads
 * it and stays on the page; there is no fetch, no blob, no object URL to revoke,
 * and middle-click and "save link as" work the way they should.
 *
 * ── Why "current view" is an option at all ───────────────────────────────────
 *
 * Because the table is usually filtered. A biller who has searched for one payer
 * and then exports wants that payer, and an Export button that quietly ignored
 * the search would produce a 4,000-row file they have to filter again. Both are
 * offered rather than the button guessing, and both are labelled with what they
 * will actually contain.
 *
 * ── Why this is a hand-rolled menu ───────────────────────────────────────────
 *
 * There is no dropdown-menu primitive in components/ui, and the Select beside it
 * is the wrong control: a listbox announces its options as a value being chosen
 * and this one never holds a value, so a screen reader would be told a selection
 * was made and then find it reverted. A menu of links is what this is, so it is
 * built as one — `aria-haspopup="menu"`, `role="menu"`, Escape and outside
 * pointerdown close it, focus returns to the trigger.
 */

type Scope = 'view' | 'all'
type Format = 'csv' | 'xlsx'

export function ExportButton({
  status,
  q,
  changedOnly,
}: {
  /** The status filter as the table holds it — 'ALL' when unfiltered. */
  status: string
  /** The live search box contents. */
  q: string
  /** Whether the table is showing only what moved since the queue was marked seen. */
  changedOnly: boolean
}) {
  const [open, setOpen] = useState(false)
  const menuId = useId()
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return

    function onPointerDown(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      setOpen(false)
      // Escape from inside a menu has to put focus somewhere deliberate, or it
      // lands on <body> and the next Tab restarts at the top of the page.
      trigger.current?.focus()
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  /*
    Built from the filter state as it stands at click time, not from the URL.
    The worklist keeps its filters in React state rather than in the address bar,
    so the address bar is not a source of truth to read back here.
  */
  function href(scope: Scope, format: Format): string {
    const params = new URLSearchParams({ format, scope })
    if (scope === 'view') {
      if (status !== 'ALL') params.set('status', status)
      if (q) params.set('q', q)
      if (changedOnly) params.set('changedOnly', '1')
    }
    return `/api/worklist/export?${params.toString()}`
  }

  return (
    <div className="relative" ref={root}>
      <Button
        ref={trigger}
        size="sm"
        variant="outline"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen(v => !v)}
      >
        <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
        Export
      </Button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Export the worklist"
          className="absolute right-0 z-50 mt-1 w-56 rounded-md border border-gray-200 bg-white p-1 shadow-md"
        >
          <MenuGroup label="Current view" hint="Matches the table as it is filtered now">
            <MenuLink href={href('view', 'csv')} onDone={() => setOpen(false)}>CSV</MenuLink>
            <MenuLink href={href('view', 'xlsx')} onDone={() => setOpen(false)}>Excel</MenuLink>
          </MenuGroup>
          <MenuGroup label="Everything" hint="Every denial in the workspace">
            <MenuLink href={href('all', 'csv')} onDone={() => setOpen(false)}>CSV</MenuLink>
            <MenuLink href={href('all', 'xlsx')} onDone={() => setOpen(false)}>Excel</MenuLink>
          </MenuGroup>
        </div>
      )}
    </div>
  )
}

/**
 * One scope, with its two formats.
 *
 * The hint line is not decoration: "Current view" and "Everything" produce
 * different files from the same screen, and which is which is only obvious to
 * the person who built it.
 */
function MenuGroup({
  label,
  hint,
  children,
}: {
  label: string
  hint: string
  children: React.ReactNode
}) {
  return (
    <div role="group" aria-label={label} className="px-1 py-1 [&+&]:border-t [&+&]:border-gray-100">
      <p className="px-2 pt-1 text-xs font-medium text-gray-900">{label}</p>
      <p className="px-2 pb-1 text-xs text-gray-500">{hint}</p>
      <div className="flex gap-1">{children}</div>
    </div>
  )
}

function MenuLink({
  href,
  onDone,
  children,
}: {
  href: string
  onDone: () => void
  children: React.ReactNode
}) {
  return (
    <a
      role="menuitem"
      href={href}
      // The download starts without a navigation, so the menu has to be told to
      // close — nothing else about the page changes when this is clicked.
      onClick={onDone}
      className="flex-1 rounded px-2 py-1.5 text-center text-sm text-gray-700 hover:bg-gray-100 focus:bg-gray-100 focus:outline-none"
    >
      {children}
    </a>
  )
}

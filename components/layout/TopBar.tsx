'use client'

import { trpc } from '@/lib/trpc/client'
import { HamburgerButton } from './HamburgerButton'
import { PageTitle } from './PageTitle'
import { PracticeSwitcher } from '@/components/practices/PracticeSwitcher'
import { AgentTrigger } from '@/components/agent/AgentTrigger'
import { cn } from '@/lib/utils'

/**
 * The bar across the top, and the one place that says which clinic is in view.
 *
 * ── Why the whole bar tints ──────────────────────────────────────────────────
 *
 * Because someone who forgets they are isolated will read a total off a tile,
 * repeat it in a meeting, and be wrong — and they will be wrong in the specific
 * way that looks like the product is broken rather than like a filter is on.
 * The scope is global (it moves Analytics, Claims and the export together), so
 * the indicator cannot live on the page that set it.
 *
 * ── Why it is not a new strip ────────────────────────────────────────────────
 *
 * It tints and fills the h-14 bar that already exists rather than adding a row
 * under it. Phase 2 measured what furniture above the table costs: on 1280x700
 * the queue is already down to a 314px card, and another 40px row would take it
 * to the 280px floor and start the column scrolling. Zero added height was the
 * constraint; a background colour and a word cost none of it.
 *
 * Light classes only — app/globals.css re-themes `--color-<hue>-<shade>` under
 * `.dark`, so `bg-amber-50 text-amber-900` inverts on its own. A `dark:`
 * variant here would invert it twice. See __tests__/dark-variant-inversion.test.ts.
 */
export function TopBar() {
  // The RESOLVED practice, not the stored column: `active` re-checks that the
  // id still belongs to this workspace and is not archived, which is what every
  // query beside it does. Reading User.activePracticeId raw would let the bar
  // name a clinic while the rows below it came from all of them.
  const active = trpc.practices.active.useQuery()
  const isolated = Boolean(active.data?.practiceId)

  return (
    <div
      className={cn(
        'flex h-14 shrink-0 items-center gap-2 border-b px-3 md:px-4',
        isolated
          ? 'border-amber-200 bg-amber-50'
          : 'border-gray-200 bg-white',
      )}
    >
      <HamburgerButton />
      <PageTitle />

      {isolated && (
        <span className="truncate text-xs font-medium text-amber-900">
          {/* Named, not just flagged. "A filter is on" sends someone hunting
              for it; the clinic's own name is the answer they were after. */}
          Showing {active.data?.name} only
        </span>
      )}

      {/* Pushed right, so the switcher sits away from the title and does not
          move when a section name gets longer. */}
      <div className="ml-auto flex items-center gap-1">
        <PracticeSwitcher compact />
        <AgentTrigger />
      </div>
    </div>
  )
}

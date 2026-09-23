import { Suspense } from 'react'
import { WorklistView } from '@/components/worklist/WorklistView'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * Full height, so the table can own its own scroll region.
 *
 * The dashboard's <main> is the scroller for every other page, which is right
 * for a report you read top to bottom and wrong for a queue you work: it puts
 * the column headers off-screen the moment you scroll, and it means the work
 * panel — which sits beside the table, not above it — would scroll away from the
 * row it belongs to. `h-full` + `min-h-0` hands the height down to WorklistView,
 * which scrolls the table body and nothing else.
 *
 * min-h-0 at every level is what makes it work. A flex child's default
 * min-height is auto, so without it the table refuses to shrink below its
 * content and overflows the viewport instead of scrolling inside it.
 */
export default function WorklistPage() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      {/*
        No page heading here, deliberately.

        The top bar already renders "Worklist" (components/layout/PageTitle.tsx),
        so an h1 plus a tagline was 78px of the viewport spent saying a second
        time what the chrome above it had just said — on a laptop, about a fifth
        of the space the queue itself had to work with. Every other page can
        afford that; the one page that is a table cannot.
      */}
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <div className="min-h-0 flex-1">
          <WorklistView />
        </div>
      </Suspense>
    </div>
  )
}

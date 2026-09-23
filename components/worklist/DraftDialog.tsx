'use client'

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { WorkPanel } from './WorkPanel'
import type { WorklistRow } from './types'

/**
 * The work panel, as a modal.
 *
 * Everything that used to live here is now in WorkPanel, which the worklist
 * renders beside the table on a wide screen. This shell is what the same panel
 * gets below that width: the split pane needs roughly 1280px before both halves
 * are usable, and on anything narrower a modal is the honest answer rather than
 * two columns that are each too cramped to work in.
 *
 * Kept as a separate component rather than a conditional inside WorkPanel so the
 * panel itself has no opinion about how it is framed.
 */
export function DraftDialog({
  row,
  claimLabel,
  open,
  onOpenChange,
  onDrafted,
}: {
  row: WorklistRow | null
  claimLabel: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onDrafted: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{claimLabel}</DialogTitle>
        </DialogHeader>
        {/*
          Keyed on the row so the panel's own state — the revision instruction,
          the pending note — cannot survive from one claim into the next. The
          dialog stays mounted between rows; its contents must not.
        */}
        <WorkPanel key={row?.id ?? 'none'} row={row} claimLabel={claimLabel} onDrafted={onDrafted} />
      </DialogContent>
    </Dialog>
  )
}

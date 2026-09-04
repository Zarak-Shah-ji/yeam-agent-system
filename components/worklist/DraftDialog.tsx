'use client'

import { useState } from 'react'
import { Copy, Loader2, Send } from 'lucide-react'
import { trpc } from '@/lib/trpc/client'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { RowDetail } from './RowDetail'
import type { WorklistRow } from './types'

/**
 * Revision shortcuts, in the words a biller would actually use.
 *
 * "Make it shorter" and "less jargon" are first because those were the two most
 * common complaints from working billing managers about machine-drafted
 * appeals. The drafting prompt already caps length and bans buzzwords; these
 * are for the letter that still comes back too long.
 */
const SUGGESTIONS = [
  'Make it shorter',
  'Less jargon, more direct',
  'Cite the payer policy',
  'Lead with the dollar amount',
]

/**
 * Work one denial: see why it is ranked here, what the remittance really said,
 * draft the right document, argue with the draft, then close the loop.
 *
 * This used to be drafting only, which meant the dialog could produce a letter
 * and then had nowhere to record that it was sent — so the recovery funnel was
 * structurally unable to show a recovery. RowDetail carries the other half.
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
  const [instruction, setInstruction] = useState('')
  const rowId = row?.id ?? null

  const drafts = trpc.worklist.drafts.useQuery(
    { rowId: rowId ?? '' },
    { enabled: Boolean(rowId) && open },
  )

  const draft = trpc.worklist.draft.useMutation({
    onSuccess: () => {
      void drafts.refetch()
      onDrafted()
    },
  })

  const revise = trpc.worklist.revise.useMutation({
    onSuccess: () => {
      setInstruction('')
      void drafts.refetch()
    },
  })

  const versions = drafts.data ?? []
  const current = versions[versions.length - 1]
  const busy = draft.isPending || revise.isPending
  const error = draft.error?.message ?? revise.error?.message

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{claimLabel}</DialogTitle>
        </DialogHeader>

        {row && (
          <RowDetail
            rowId={row.id}
            status={row.status}
            score={row.score}
            band={row.band}
            factors={row.factors}
            refinement={row.refinement}
            note={row.userNote}
            followUpAt={row.followUpAt}
            call={row.call}
            onChanged={onDrafted}
          />
        )}

        <div className="border-t border-gray-200 pt-4" />

        {!current && !drafts.isLoading && (
          <div className="py-8 text-center">
            <p className="text-sm text-gray-600">
              Yeam will pick the right instrument for this denial code — an appeal, a corrected
              claim or a reprocessing request — and draft it.
            </p>
            <Button
              className="mt-4"
              disabled={busy || !rowId}
              onClick={() => rowId && draft.mutate({ rowId })}
            >
              {draft.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                  Drafting…
                </>
              ) : (
                'Draft the response'
              )}
            </Button>
          </div>
        )}

        {current && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs uppercase tracking-wide text-gray-500">
                {current.artifact.replace(/-/g, ' ')} · version {current.version}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void navigator.clipboard?.writeText(current.body)}
              >
                <Copy className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                Copy
              </Button>
            </div>

            <pre className="max-h-[45vh] overflow-auto whitespace-pre-wrap rounded-md border border-gray-200 bg-gray-50 p-4 font-sans text-sm leading-relaxed text-gray-900">
              {current.body}
            </pre>

            <div className="flex flex-wrap gap-1.5">
              {SUGGESTIONS.map(s => (
                <button
                  key={s}
                  type="button"
                  disabled={busy}
                  onClick={() => rowId && revise.mutate({ rowId, instruction: s })}
                  className="rounded-full border border-gray-300 px-3 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  {s}
                </button>
              ))}
            </div>

            <form
              className="flex gap-2"
              onSubmit={e => {
                e.preventDefault()
                if (rowId && instruction.trim()) revise.mutate({ rowId, instruction })
              }}
            >
              <Input
                value={instruction}
                onChange={e => setInstruction(e.target.value)}
                placeholder="Ask for a change…"
                disabled={busy}
              />
              <Button type="submit" disabled={busy || !instruction.trim()}>
                {revise.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Send className="h-4 w-4" aria-hidden="true" />
                )}
                <span className="sr-only">Send</span>
              </Button>
            </form>
          </div>
        )}

        {error && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}

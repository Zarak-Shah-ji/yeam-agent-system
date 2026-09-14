'use client'

import { useState } from 'react'
import { ShieldCheck, Sparkles } from 'lucide-react'
import { trpc } from '@/lib/trpc/client'
import { Button } from '@/components/ui/button'
import type { ImportResult } from '@/components/imports/ImportBox'

/**
 * What just landed, and the one thing worth doing about it.
 *
 * Shared by Connect and the worklist because both had their own copy of this
 * banner, and both hard-coded the word for what was imported. Detection can now
 * overrule the box a file was dropped on, so a summary that assumes its own page
 * knows the kind is a summary that will eventually say "imported 1,200 denials"
 * about an A/R export.
 *
 * The offer underneath is the reason an A/R export no longer has to be worked
 * twice. addDeniedToWorklist already derived worklist rows from a snapshot's
 * denied claims, but it was only reachable from a banner on the Claims page —
 * so a customer who imported A/R and never opened Claims never found it.
 */
export function ImportSummary({ result }: { result: ImportResult }) {
  const [added, setAdded] = useState<number | null>(null)
  const utils = trpc.useUtils()

  const addToWorklist = trpc.imports.addDeniedToWorklist.useMutation({
    onSuccess: res => {
      setAdded(res.added)
      void utils.insights.invalidate()
      void utils.worklist.invalidate()
      void utils.imports.invalidate()
    },
  })

  const noun = result.kind === 'claims' ? 'claims' : 'denials'
  const offer = result.kind === 'claims' && result.deniedWithCarc > 0 && added === null

  return (
    <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm">
      <p className="font-medium text-green-900">
        Imported {result.imported} {noun}
        {result.skipped > 0 && ` · ${result.skipped} rows skipped`}
      </p>

      {result.refusedColumns.length > 0 && (
        <p className="mt-1 flex items-start gap-1.5 text-green-800">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>Not read or stored: {result.refusedColumns.join(', ')}</span>
        </p>
      )}

      {/*
        The upload answered appeals nobody had closed out. Said out loud because
        these rows moved to Recovered without anyone clicking anything, and a
        status that changes silently is one the biller stops trusting.
      */}
      {(result.outcomesResolved ?? 0) > 0 && (
        <p className="mt-1 flex items-start gap-1.5 text-green-800">
          <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            <span className="font-semibold">{result.outcomesResolved}</span> sent{' '}
            {result.outcomesResolved === 1 ? 'appeal was' : 'appeals were'} paid on this export and
            marked recovered. Each one is on its row, marked as read from an A/R export rather than
            confirmed.
          </span>
        </p>
      )}

      {offer && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3 border-t border-green-200 pt-2">
          <p className="text-green-900">
            <span className="font-semibold">{result.deniedWithCarc}</span> of them are denied with a
            reason code. Put them on the worklist to get filing deadlines and draft responses.
          </p>
          <Button
            size="sm"
            disabled={addToWorklist.isPending}
            onClick={() => addToWorklist.mutate()}
          >
            {addToWorklist.isPending ? 'Adding…' : 'Add to the worklist'}
          </Button>
        </div>
      )}

      {added !== null && (
        <p className="mt-2 border-t border-green-200 pt-2 text-green-900">
          {added > 0
            ? `Added ${added} to the worklist.`
            : 'Those denials were already on the worklist.'}
        </p>
      )}

      {addToWorklist.error && (
        <p className="mt-2 text-red-700" role="alert">
          {addToWorklist.error.message}
        </p>
      )}
    </div>
  )
}

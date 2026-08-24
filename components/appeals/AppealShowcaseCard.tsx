'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { LetterActions } from './LetterActions'
import type { ShowcaseAppeal } from '@/lib/billing/showcase-appeals'

/** Length of the preview shown before the reader expands the full letter. */
const PREVIEW_CHARS = 420

/** Cut at the last full line so the preview never ends mid-word. */
function preview(letter: string): string {
  if (letter.length <= PREVIEW_CHARS) return letter
  const slice = letter.slice(0, PREVIEW_CHARS)
  const lastBreak = slice.lastIndexOf('\n')
  return `${(lastBreak > PREVIEW_CHARS * 0.5 ? slice.slice(0, lastBreak) : slice).trimEnd()}…`
}

export function AppealShowcaseCard({ appeal, index }: { appeal: ShowcaseAppeal; index: number }) {
  const [open, setOpen] = useState(index === 0)

  const fields = [
    ['Patient', appeal.patientName],
    ['Payer', appeal.payerName],
    ['Date of service', appeal.serviceDate],
  ].filter(([, value]) => !!value) as [string, string][]

  return (
    <article className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-100 px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold text-gray-900">{appeal.claimNumber ?? 'Appeal letter'}</h3>
          {appeal.denialCode && <Badge variant="warning">{appeal.denialCode}</Badge>}
        </div>

        {fields.length > 0 && (
          <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
            {fields.map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs uppercase tracking-wide text-gray-400">{label}</dt>
                <dd className="text-gray-900">{value}</dd>
              </div>
            ))}
          </dl>
        )}

        {appeal.denialReason && (
          <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <span className="font-medium">Denial reason: </span>
            {appeal.denialReason}
          </p>
        )}
      </div>

      <div className="px-5 py-4">
        <pre className="whitespace-pre-wrap break-words font-mono text-[13px] leading-relaxed text-gray-800">
          {open ? appeal.letter : preview(appeal.letter)}
        </pre>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setOpen(o => !o)}
            className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-700"
          >
            <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
            {open ? 'Show less' : 'Read full letter'}
          </button>
          <span className="text-gray-300">·</span>
          <LetterActions
            letter={appeal.letter}
            filename={`appeal-${(appeal.claimNumber ?? 'letter').replace(/[^a-z0-9-]/gi, '')}.txt`}
          />
        </div>
      </div>
    </article>
  )
}

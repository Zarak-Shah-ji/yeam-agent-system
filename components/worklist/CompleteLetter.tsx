'use client'

import { Lock } from 'lucide-react'
import { Input } from '@/components/ui/input'
import type { Placeholder } from '@/lib/appeals/merge'

/**
 * The fields that finish the letter, directly under the letter.
 *
 * It used to sit at the bottom of the send panel, below the destination lookup
 * and above the submission form, which put the patient's name three scrolls
 * away from the [PATIENT NAME] it fills. That distance is what made typing the
 * name straight into the body the obvious thing to do — and the body is the one
 * place it must never go.
 *
 * Built from the LIVE editor text, not the stored version, so deleting a
 * placeholder makes its field disappear as you type. Correct feedback, and free:
 * findPlaceholders is a regex over a page of text.
 *
 * The privacy note is the sentence that makes an editable letter shippable at
 * all. It stays verbatim and it stays first.
 */
export function CompleteLetter({
  slots,
  values,
  onChange,
  practiceValues,
}: {
  /** Every placeholder in the live body, in document order. */
  slots: Placeholder[]
  /** Patient and other answers. Browser state — never a mutation argument. */
  values: Record<string, string>
  onChange: (key: string, value: string) => void
  /** Filled from the Organization record on the server; shown here only as gaps. */
  practiceValues: Record<string, string>
}) {
  if (slots.length === 0) return null

  const patientSlots = slots.filter(s => s.owner === 'patient')
  const otherSlots = slots.filter(s => s.owner === 'other')
  const practiceGaps = slots.filter(s => s.owner === 'practice' && !practiceValues[s.key]?.trim())

  function field(slot: Placeholder) {
    return (
      <div key={slot.key}>
        <label htmlFor={`slot-${slot.key}`} className="text-xs font-medium text-gray-600">
          {slot.label}
        </label>
        <Input
          id={`slot-${slot.key}`}
          className="mt-1"
          value={values[slot.key] ?? ''}
          autoComplete="off"
          spellCheck={false}
          onChange={e => onChange(slot.key, e.target.value)}
        />
      </div>
    )
  }

  return (
    <div className="rounded-md border border-gray-200 p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
        Complete the letter
      </p>

      {patientSlots.length > 0 && (
        <>
          <p className="mt-2 flex items-start gap-1.5 rounded-md border border-gray-900 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-900">
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>
              Typed here only. Patient details are merged into the letter in your browser and are
              never sent to Yeam — that is why the draft arrives with these blank, and why the
              letter above keeps its brackets even after you fill these in.
            </span>
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">{patientSlots.map(field)}</div>
        </>
      )}

      {otherSlots.length > 0 && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">{otherSlots.map(field)}</div>
      )}

      {practiceGaps.length > 0 && (
        <p className="mt-3 text-xs text-gray-600">
          {practiceGaps.map(s => s.label).join(', ')} would fill in automatically from{' '}
          <a href="/settings" className="font-medium text-blue-700 underline">
            your practice profile
          </a>
          .
        </p>
      )}
    </div>
  )
}

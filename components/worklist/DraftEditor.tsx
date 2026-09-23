'use client'

import { Check, Eye, Loader2, Pencil, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { mergeLetter, type Placeholder } from '@/lib/appeals/merge'

/**
 * The letter, as something a biller can actually change.
 *
 * It used to be a <pre>. The only way to alter a word of it was to ask the model
 * in prose and wait, which is absurd for "our fax number has a typo" and is why
 * billers were copying the letter into Word — at which point the version history,
 * the send record and the outcome ledger are all describing a document nobody
 * sent.
 *
 * THE RULE THAT MAKES AN EDITABLE BODY SAFE: what is in this textarea is the
 * UNMERGED body. It contains [PATIENT NAME]; it is what gets saved; it is what
 * goes to the model. The merged letter — the one with a real person in it — is a
 * render, produced here for Preview and in SendPanel for Copy/Print/Download,
 * and it is never editor state and never mutation input. Two layers that must
 * not be conflated, which is exactly what Preview makes visible: the biller can
 * see the finished letter without ever holding it in a box they could save.
 *
 * Presentational. The body, the dirty flag and the save live in WorkPanel,
 * because the fields under this editor and the packet under those are computed
 * from the same live text.
 */
export function DraftEditor({
  body,
  storedBody,
  versions,
  viewVersion,
  onViewVersion,
  onChange,
  onBlur,
  onRestoreVersion,
  onSave,
  dropped,
  dirty,
  saving,
  disabled,
  allValues,
}: {
  /** The live text: what the biller has typed, or the stored version verbatim. */
  body: string
  /** The latest committed version, for "you have unsaved changes" to mean something. */
  storedBody: string
  versions: { id: string; version: number; source?: string | null }[]
  /** Which version is on screen. Null is the latest. */
  viewVersion: number | null
  onViewVersion: (version: number | null) => void
  onChange: (body: string) => void
  onBlur: () => void
  onRestoreVersion: (version: number) => void
  onSave: () => void
  /** Patient slots this edit deleted. Non-empty means the save is blocked. */
  dropped: Placeholder[]
  dirty: boolean
  saving: boolean
  /** True while a model call is in flight — the letter is about to be replaced. */
  disabled: boolean
  allValues: Record<string, string>
}) {
  const latest = versions[versions.length - 1]
  const showing = viewVersion ?? latest?.version ?? 1
  const historic = viewVersion !== null && viewVersion !== latest?.version
  const blocked = dropped.length > 0

  return (
    <div className="space-y-2">
      {/* ── Versions ──────────────────────────────────────────────────────── */}
      {versions.length > 1 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="mr-1 text-xs text-gray-500">Versions</span>
          {versions.map(v => (
            <button
              key={v.id}
              type="button"
              disabled={dirty}
              title={
                dirty
                  ? 'Save or discard your edits before looking at another version'
                  : v.source === 'BILLER'
                    ? 'Edited by hand'
                    : 'Drafted by Yeam'
              }
              onClick={() => onViewVersion(v.version === latest?.version ? null : v.version)}
              className={`rounded-full border px-2 py-0.5 text-xs disabled:opacity-40 ${
                v.version === showing
                  ? 'border-gray-900 bg-gray-900 text-white'
                  : 'border-gray-300 text-gray-600 hover:bg-gray-50'
              }`}
            >
              v{v.version}
              {v.source === 'BILLER' && (
                <Pencil className="ml-1 inline h-2.5 w-2.5" aria-hidden="true" />
              )}
            </button>
          ))}
        </div>
      )}

      {/* ── The body ──────────────────────────────────────────────────────── */}
      {historic ? (
        <>
          <pre className="max-h-[45vh] overflow-auto whitespace-pre-wrap rounded-md border border-gray-200 bg-gray-50 p-4 font-sans text-sm leading-relaxed text-gray-900">
            {body}
          </pre>
          <div className="flex items-center gap-2">
            <p className="text-xs text-gray-500">
              Version {viewVersion} of {latest?.version}. Older versions are read-only.
            </p>
            <Button size="sm" variant="outline" onClick={() => onRestoreVersion(viewVersion!)}>
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              Start from this one
            </Button>
          </div>
        </>
      ) : (
        <Textarea
          value={body}
          onChange={e => onChange(e.target.value)}
          onBlur={onBlur}
          disabled={disabled}
          spellCheck
          rows={18}
          aria-label="The letter"
          className="max-h-[45vh] min-h-[16rem] resize-y whitespace-pre-wrap font-sans text-sm leading-relaxed"
        />
      )}

      {/*
        The PHI block. Shown the instant a patient placeholder disappears rather
        than on Save, because by then the biller has typed a name and been told
        off for it. The server refuses the same edit either way — this is so the
        refusal arrives while it is still one keystroke to undo.
      */}
      {blocked && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900" role="alert">
          Patient details go in the fields below, not in the letter — Yeam never receives them.
          Put {dropped.map(d => d.token).join(', ')} back, and type the{' '}
          {dropped.length === 1 ? 'value' : 'values'} into the{' '}
          <span className="font-medium">Complete the letter</span> box underneath.
        </p>
      )}

      {/* ── Save ──────────────────────────────────────────────────────────── */}
      {!historic && (
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={onSave} disabled={!dirty || blocked || saving || disabled}>
            {saving ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            )}
            Save as v{(latest?.version ?? 0) + 1}
          </Button>
          <p className="text-xs text-gray-500">
            {dirty
              ? blocked
                ? 'Unsaved — and blocked until the placeholders are back.'
                : 'Unsaved changes. Saving keeps v' +
                  latest?.version +
                  ' in the list; nothing is overwritten.'
              : body.trim() === storedBody.trim()
                ? 'Saved. Every version stays in the list above.'
                : ''}
          </p>
        </div>
      )}

      {/* ── Preview ───────────────────────────────────────────────────────── */}
      {!historic && (
        <details className="rounded-md border border-gray-200">
          <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-gray-700">
            <Eye className="mr-1.5 inline h-3.5 w-3.5" aria-hidden="true" />
            Preview it filled in
          </summary>
          <div className="border-t border-gray-200 p-3">
            <p className="mb-2 text-xs text-gray-500">
              The letter with the fields below merged in — in this browser, for reading and
              printing. This text is never saved and never sent to Yeam.
            </p>
            <pre className="max-h-[40vh] overflow-auto whitespace-pre-wrap rounded-md bg-gray-50 p-3 font-sans text-sm leading-relaxed text-gray-900">
              {mergeLetter(body, allValues)}
            </pre>
          </div>
        </details>
      )}
    </div>
  )
}

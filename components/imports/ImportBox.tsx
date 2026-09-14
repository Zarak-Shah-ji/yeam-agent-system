'use client'

import { useRef, useState } from 'react'
import { Upload, ShieldCheck, Loader2, AlertTriangle, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export type ImportProfile = 'denials' | 'claims'

export type ImportResult = {
  batchId: string
  kind: ImportProfile
  imported: number
  skipped: number
  statusDerived: boolean
  refusedColumns: string[]
  unusedColumns: string[]
  /** Denied claims carrying a reason code, offered as worklist rows. */
  deniedWithCarc: number
  /**
   * Appeals this upload closed out by itself — see lib/denials/reconcile.ts.
   * Reported rather than applied silently: an outcome written into the ledger
   * without telling anybody is one nobody can check.
   */
  outcomesResolved?: number
}

type PreviewField = {
  id: string
  label: string
  kind: 'text' | 'money' | 'date' | 'status'
  required: boolean
  headerIndex: number | null
  headerName: string | null
  sampleRaw: string | null
  sampleParsed: string | null
}

type Preview = {
  profile: ImportProfile
  profileConfident: boolean
  profileSource: 'detected' | 'chosen' | 'corrected'
  detectedProfile: ImportProfile
  detectionConfident: boolean
  detectionEvidence: string[]
  requestedProfile: ImportProfile | null
  deniedWithCarc: number
  filename: string
  headers: string[]
  selectableHeaders: { index: number; name: string }[]
  fields: PreviewField[]
  missing: string[]
  refusedColumns: string[]
  unusedColumns: string[]
  refusedOverrides: string[]
  rowCount: number
  skipped: number
  statusDerived: boolean
}

const PROFILE_LABEL: Record<ImportProfile, string> = {
  denials: 'Denials export',
  claims: 'A/R + claims export',
}

const PROFILE_ARTICLE: Record<ImportProfile, string> = {
  denials: 'a denials export',
  claims: 'an A/R export',
}

const UNMAPPED = '__none__'

/** "Paid and Allowed", "Paid, Allowed and CARC" — for a sentence, not a list. */
function listColumns(names: string[]): string {
  const quoted = names.map(n => `“${n}”`)
  if (quoted.length <= 1) return quoted[0] ?? 'columns'
  return `${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1]}`
}

/**
 * Upload, then confirm what was read, then save.
 *
 * The confirm step is not ceremony. US ordering is assumed for slash dates, so a
 * DD/MM export reads 03/04 as March 4th, and every filing deadline and aging
 * bucket downstream is then quietly wrong in a way nobody notices until a claim
 * dies. Showing the parsed value back is what makes that visible; the dropdowns
 * are what make it fixable.
 *
 * The refused-columns line is the other half: it is the visible proof of the
 * de-identification promise, shown at the moment the customer has just handed
 * over a file and is deciding whether to trust it.
 */
export function ImportBox({
  onImported,
  compact = false,
  profile,
  title,
  description,
}: {
  onImported: (result: ImportResult) => void
  compact?: boolean
  /** Force a profile instead of letting detection choose. */
  profile?: ImportProfile
  title?: string
  description?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [overrides, setOverrides] = useState<Record<string, number>>({})
  const [chosenProfile, setChosenProfile] = useState<ImportProfile | null>(null)
  // True once the customer has picked from "Read as" themselves. Detection stops
  // overruling them at that point — otherwise the control could never disagree.
  const [confirmedProfile, setConfirmedProfile] = useState(false)

  function reset() {
    setFile(null)
    setPreview(null)
    setOverrides({})
    setChosenProfile(null)
    setConfirmedProfile(false)
    setError(null)
  }

  async function runPreview(
    next: File,
    nextProfile?: ImportProfile,
    nextOverrides: Record<string, number> = {},
    confirmed = false,
  ) {
    setBusy(true)
    setError(null)
    try {
      const body = new FormData()
      body.append('file', next)
      if (nextProfile ?? profile) body.append('profile', (nextProfile ?? profile) as string)
      if (confirmed) body.append('confirmProfile', 'true')
      if (Object.keys(nextOverrides).length) body.append('mapping', JSON.stringify(nextOverrides))

      const res = await fetch('/api/imports/preview', { method: 'POST', body })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Could not read that file.')
        setPreview(null)
        return
      }
      setFile(next)
      setPreview(json as Preview)
      setChosenProfile((json as Preview).profile)
    } catch {
      setError('Upload failed. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  async function commit() {
    if (!file || !preview) return
    setBusy(true)
    setError(null)
    try {
      const body = new FormData()
      body.append('file', file)
      body.append('profile', preview.profile)
      // The profile being sent is the one the preview above rendered, whether it
      // was detected, corrected or chosen — so it is confirmed by construction.
      // The guard on the other end is for a caller that never previewed at all.
      body.append('confirmProfile', 'true')
      if (Object.keys(overrides).length) body.append('mapping', JSON.stringify(overrides))

      const res = await fetch('/api/imports/commit', { method: 'POST', body })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Could not save that file.')
        return
      }
      onImported(json as ImportResult)
      reset()
    } catch {
      setError('Save failed. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  function changeField(fieldId: string, value: string) {
    const next = { ...overrides, [fieldId]: value === UNMAPPED ? -1 : Number(value) }
    setOverrides(next)
    if (file) void runPreview(file, chosenProfile ?? undefined, next, confirmedProfile)
  }

  function switchProfile(next: ImportProfile) {
    setChosenProfile(next)
    setOverrides({})
    setConfirmedProfile(true)
    if (file) void runPreview(file, next, {}, true)
  }

  /* ------------------------------------------------------------- preview --- */

  if (preview) {
    const mapped = preview.fields.filter(f => f.headerIndex !== null)
    const unmapped = preview.fields.filter(f => f.headerIndex === null)

    // Three different things can be wrong with the choice above, and they want
    // three different sentences. Collapsing them into one "check this" warning
    // is what let an A/R export get imported as denials in the first place.
    const corrected = preview.profileSource === 'corrected'
    const overrodeDetection =
      !corrected && preview.detectionConfident && preview.detectedProfile !== preview.profile
    const ambiguous = !corrected && !preview.detectionConfident

    return (
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-gray-900">{preview.filename}</p>
            <p className="mt-0.5 text-sm text-gray-500">
              {preview.rowCount} row{preview.rowCount === 1 ? '' : 's'} readable
              {preview.skipped > 0 && `, ${preview.skipped} skipped`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Read as</span>
            <Select value={preview.profile} onValueChange={v => switchProfile(v as ImportProfile)}>
              <SelectTrigger className="h-8 w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="denials">{PROFILE_LABEL.denials}</SelectItem>
                <SelectItem value="claims">{PROFILE_LABEL.claims}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/*
          Detection overruled the box this file was dropped on. Naming the
          columns that decided it is the whole point: "could be read either way"
          gives a customer nothing to check, and the failure it replaces was
          silent — an A/R export read as denials, after which the Claims page
          truthfully reports that no claims have been imported.
        */}
        {corrected && (
          <p className="mt-3 flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              You dropped this on{' '}
              <strong>{PROFILE_LABEL[preview.requestedProfile ?? preview.profile]}</strong>, but it
              has {listColumns(preview.detectionEvidence)} — that&rsquo;s{' '}
              {PROFILE_ARTICLE[preview.detectedProfile]}. Reading it as{' '}
              <strong>{PROFILE_LABEL[preview.profile]}</strong>. Change it above only if you are
              sure.
            </span>
          </p>
        )}

        {/* A deliberate override of a confident detection. Their call, but say what it costs. */}
        {overrodeDetection && (
          <p className="mt-3 flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              This file&rsquo;s columns say it is {PROFILE_ARTICLE[preview.detectedProfile]} — it has{' '}
              {listColumns(preview.detectionEvidence)}. You have set it to{' '}
              <strong>{PROFILE_LABEL[preview.profile]}</strong>.{' '}
              {preview.profile === 'denials'
                ? 'Importing an A/R export as denials puts paid claims on your worklist.'
                : 'Importing denials as a snapshot reports a 100% denial rate.'}
            </span>
          </p>
        )}

        {ambiguous && (
          <p className="mt-3 flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              This file could be read either way. Check the choice above — importing an A/R export
              as denials puts paid claims on your worklist, and importing denials as a snapshot
              reports a 100% denial rate.
            </span>
          </p>
        )}

        {preview.missing.length > 0 && (
          <p className="mt-3 flex items-start gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>Could not find {preview.missing.join(' or ')}. Point a column at it below.</span>
          </p>
        )}

        {preview.refusedOverrides.length > 0 && (
          <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
            {preview.refusedOverrides.join(', ')} holds patient identifiers and cannot be read, so
            that choice was not applied.
          </p>
        )}

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="pb-2 pr-3 font-medium">Field</th>
                <th className="pb-2 pr-3 font-medium">Column in your file</th>
                <th className="pb-2 font-medium">First value, as read</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {[...mapped, ...unmapped].map(field => {
                const misread = field.sampleParsed === 'could not read as a date'
                return (
                  <tr key={field.id}>
                    <td className="py-2 pr-3 align-middle">
                      <span className="text-gray-900">{field.label}</span>
                      {field.required && <span className="ml-1 text-red-600">*</span>}
                    </td>
                    <td className="py-2 pr-3 align-middle">
                      <Select
                        value={
                          overrides[field.id] === -1
                            ? UNMAPPED
                            : String(overrides[field.id] ?? field.headerIndex ?? UNMAPPED)
                        }
                        onValueChange={v => changeField(field.id, v)}
                      >
                        <SelectTrigger className="h-8 w-56">
                          <SelectValue placeholder="Not mapped" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={UNMAPPED}>— not mapped —</SelectItem>
                          {preview.selectableHeaders.map(h => (
                            <SelectItem key={h.index} value={String(h.index)}>
                              {h.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className={`py-2 align-middle ${misread ? 'text-red-600' : 'text-gray-600'}`}>
                      {field.sampleParsed ?? <span className="text-gray-400">—</span>}
                      {field.sampleRaw && field.sampleParsed !== field.sampleRaw && !misread && (
                        <span className="ml-2 text-xs text-gray-400">was “{field.sampleRaw}”</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {preview.statusDerived && (
          <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
            No status column found, so each claim&rsquo;s status was worked out from the amounts.
            Rates from this file are an estimate.
          </p>
        )}

        {preview.refusedColumns.length > 0 && (
          <p className="mt-3 flex items-start gap-1.5 text-xs text-gray-500">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>Not read or stored: {preview.refusedColumns.join(', ')}</span>
          </p>
        )}

        {error && (
          <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
            {error}
          </p>
        )}

        <div className="mt-4 flex items-center gap-2">
          <Button
            type="button"
            disabled={busy || preview.missing.length > 0 || preview.rowCount === 0}
            onClick={() => void commit()}
          >
            {busy ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                Saving…
              </>
            ) : (
              <>
                <Check className="mr-2 h-4 w-4" aria-hidden="true" />
                Looks right — import {preview.rowCount}
              </>
            )}
          </Button>
          <Button type="button" variant="outline" disabled={busy} onClick={reset}>
            Cancel
          </Button>
        </div>
      </div>
    )
  }

  /* --------------------------------------------------------------- idle --- */

  const heading =
    title ?? (compact ? 'Import another export' : 'Drop your claims or denials export')

  return (
    <div>
      <div
        onDragOver={e => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => {
          e.preventDefault()
          setDragging(false)
          const dropped = e.dataTransfer.files?.[0]
          if (dropped) void runPreview(dropped)
        }}
        className={[
          'rounded-lg border-2 border-dashed transition-colors',
          compact ? 'p-4' : 'p-10',
          dragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300 bg-white',
        ].join(' ')}
      >
        <div className={compact ? 'flex items-center gap-3' : 'text-center'}>
          {!compact && <Upload className="mx-auto h-8 w-8 text-gray-400" aria-hidden="true" />}
          <div className={compact ? 'flex-1' : 'mt-3'}>
            <p className={compact ? 'text-sm font-medium' : 'text-base font-semibold text-gray-900'}>
              {heading}
            </p>
            {!compact && (
              <p className="mt-1 text-sm text-gray-500">
                {description ??
                  'A .csv or .xlsx export from any billing system. No API, no IT ticket. You confirm what was read before anything is saved.'}
              </p>
            )}
          </div>
          <Button
            type="button"
            variant={compact ? 'outline' : 'default'}
            className={compact ? '' : 'mt-4'}
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                Reading…
              </>
            ) : (
              'Choose file'
            )}
          </Button>
        </div>

        {!compact && (
          <p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-gray-500">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            Patient names, member IDs and dates of birth are never read or stored.
          </p>
        )}

        <input
          ref={inputRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          className="sr-only"
          onChange={e => {
            const picked = e.target.files?.[0]
            if (picked) void runPreview(picked)
            e.target.value = ''
          }}
        />
      </div>

      {error && (
        <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

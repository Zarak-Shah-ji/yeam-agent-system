'use client'

import { useRef, useState } from 'react'
import { FileText, Loader2, PenLine, Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { LetterActions } from './LetterActions'

const MAX_FILES = 3
const MAX_TOTAL_BYTES = 4 * 1024 * 1024
const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.heic,.csv,.xlsx,.xls,.docx,.txt,.md,.eml'

function formatBytes(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function AppealUploader() {
  const [files, setFiles] = useState<File[]>([])
  const [notes, setNotes] = useState('')
  const [letter, setLetter] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const totalBytes = files.reduce((sum, f) => sum + f.size, 0)
  const tooLarge = totalBytes > MAX_TOTAL_BYTES
  const canSubmit = !pending && !tooLarge && (files.length > 0 || notes.trim().length > 0)

  function addFiles(incoming: FileList | null) {
    if (!incoming?.length) return

    // Copy the FileList out synchronously. It is a live view of the input's
    // selection, and the change handler resets the input right after this
    // returns — a deferred state updater would read it back empty.
    const picked = Array.from(incoming)
    const room = MAX_FILES - files.length

    setError(
      picked.length > room
        ? `Only ${MAX_FILES} files can be attached at once — the extras were skipped.`
        : null,
    )
    setFiles(prev => [...prev, ...picked].slice(0, MAX_FILES))
  }

  function removeFile(index: number) {
    setFiles(prev => prev.filter((_, i) => i !== index))
  }

  async function generate() {
    if (!canSubmit) return
    setPending(true)
    setError(null)
    setLetter('')
    try {
      const form = new FormData()
      files.forEach(f => form.append('files', f))
      if (notes.trim()) form.append('notes', notes.trim())

      const res = await fetch('/api/appeals/generate', { method: 'POST', body: form })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error ?? 'Could not draft the letter. Please try again.')
        return
      }
      setLetter(body.letter)
    } catch {
      setError('Could not reach the server. Check your connection and try again.')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
      <div
        onDragOver={e => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => {
          e.preventDefault()
          setDragging(false)
          addFiles(e.dataTransfer.files)
        }}
        onClick={() => inputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors ${
          dragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400 hover:bg-gray-50'
        }`}
      >
        <Upload className="h-7 w-7 text-gray-400" />
        <p className="mt-3 text-sm font-medium text-gray-900">
          Drop a denial letter, EOB, or ERA here
        </p>
        <p className="mt-1 text-xs text-gray-500">
          PDF, image, Word, Excel, or CSV — up to {MAX_FILES} files, {MAX_TOTAL_BYTES / 1024 / 1024} MB total
        </p>
      </div>

      {/* Kept outside the drop zone: a click() on a descendant input bubbles
          back into the drop zone's own onClick and re-opens the picker. */}
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT}
        className="hidden"
        onChange={e => {
          addFiles(e.target.files)
          e.target.value = ''
        }}
      />

      {files.length > 0 && (
        <ul className="mt-4 space-y-2">
          {files.map((file, i) => (
            <li
              key={`${file.name}-${i}`}
              className="flex items-center gap-3 rounded-md border border-gray-200 px-3 py-2 text-sm"
            >
              <FileText className="h-4 w-4 shrink-0 text-gray-400" />
              <span className="min-w-0 flex-1 truncate text-gray-900">{file.name}</span>
              <span className="shrink-0 text-xs text-gray-500">{formatBytes(file.size)}</span>
              <button
                type="button"
                onClick={e => {
                  e.stopPropagation()
                  removeFile(i)
                }}
                className="shrink-0 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                aria-label={`Remove ${file.name}`}
              >
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {tooLarge && (
        <p className="mt-3 text-sm text-red-600">
          Those files total {formatBytes(totalBytes)} — the limit is {MAX_TOTAL_BYTES / 1024 / 1024} MB.
          Remove one, or paste the key details below instead.
        </p>
      )}

      <div className="mt-5">
        <label htmlFor="notes" className="block text-sm font-medium text-gray-900">
          Notes <span className="font-normal text-gray-500">(or paste the denial text directly)</span>
        </label>
        <Textarea
          id="notes"
          rows={4}
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="e.g. Denied CO-197, no prior auth on file — but auth #4471902 was approved on 03/12. Patient is a Medicaid member."
          className="mt-2"
        />
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button onClick={generate} disabled={!canSubmit}>
          {pending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Drafting appeal…
            </>
          ) : (
            <>
              <PenLine className="mr-2 h-4 w-4" />
              Generate appeal letter
            </>
          )}
        </Button>
        {pending && <span className="text-sm text-gray-500">This usually takes 10–20 seconds.</span>}
      </div>

      {error && (
        <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      {letter && (
        <div className="mt-6 border-t border-gray-200 pt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-semibold text-gray-900">Drafted appeal letter</h3>
            <LetterActions letter={letter} filename="appeal-letter.txt" />
          </div>
          <p className="mt-1 text-xs text-gray-500">
            Editable — adjust anything below before you copy or download it.
          </p>
          <Textarea
            value={letter}
            onChange={e => setLetter(e.target.value)}
            rows={22}
            className="mt-3 font-mono text-[13px] leading-relaxed"
          />
        </div>
      )}
    </div>
  )
}

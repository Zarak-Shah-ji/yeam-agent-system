'use client'

import { useCallback, useState } from 'react'
import { Check, Loader2, Mic, Square, Sparkles, X } from 'lucide-react'
import { trpc } from '@/lib/trpc/client'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useDictation } from './use-dictation'

/**
 * Say it, and let Yeam write the note.
 *
 * The note is the field that decides whether a drafted appeal is specific or
 * generic — it is the only place the real reason for a denial exists, as opposed
 * to the code an adjudication system picked off a list. It is also the field
 * people skip, because writing it happens straight off a long hold with the next
 * call queued, and what gets typed is "called, no auth, resubmit".
 *
 * So: talk, or type fragments, and the model writes the sentences. The same
 * bargain a mail client makes when it drafts a reply — and the same final step,
 * which is that a person reads it and presses Save. The proposal is never
 * written to the row by the model; `Use this` only fills the box.
 *
 * Rough input is thrown away once the note is accepted. It is the least
 * considered text in the product, it duplicates what the note now says, and
 * there is no screen that would ever show it again.
 */
export function NoteComposer({
  rowId,
  onAccept,
  onClose,
  busy,
}: {
  rowId: string
  /** Fills the note box. Saving stays a separate, deliberate click. */
  onAccept: (note: string) => void
  onClose: () => void
  busy: boolean
}) {
  const [rough, setRough] = useState('')
  const [proposal, setProposal] = useState<string | null>(null)

  /*
    A functional update, deliberately. The recogniser holds this callback for the
    whole dictation, so it must append to whatever the box holds at the moment a
    phrase lands rather than to whatever it held when listening started.
  */
  const onPhrase = useCallback((phrase: string) => {
    setRough(prev => (prev ? `${prev.replace(/\s+$/, '')} ${phrase.trim()}` : phrase.trim()))
  }, [])
  const dictation = useDictation({ onPhrase })

  const write = trpc.worklist.writeNote.useMutation({
    onSuccess: r => setProposal(r.note),
  })

  const canWrite = rough.trim().length > 0 && !write.isPending && !busy

  return (
    <div className="mt-2 rounded-md border border-blue-200 bg-blue-50/50 p-3">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-blue-900">
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
          Write the note with Yeam
        </p>
        <button
          type="button"
          onClick={onClose}
          className="text-gray-500 hover:text-gray-900"
          aria-label="Close the note writer"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {proposal === null ? (
        <>
          <p className="mt-1 text-xs text-gray-600">
            {dictation.supported
              ? 'Say what happened on the call, or type the bits you remember. Yeam writes it up — it will not add anything you did not say.'
              : 'Type the bits you remember, in any order. Yeam writes it up — it will not add anything you did not say.'}
          </p>

          <Textarea
            rows={3}
            className="mt-2 bg-white"
            value={dictation.interim ? `${rough} ${dictation.interim}`.trim() : rough}
            onChange={e => setRough(e.target.value)}
            disabled={write.isPending}
            placeholder="called aetna… rep said auth was there but under the referring npi… wants it resubmitted with the rendering npi in 24J… ref 4471902"
          />

          <div className="mt-2 flex flex-wrap items-center gap-2">
            {/*
              Hidden entirely where the browser cannot listen, rather than shown
              disabled. A greyed-out microphone is a promise the page is not
              keeping, and the typed path is the whole feature without it.
            */}
            {dictation.supported && (
              <Button
                size="sm"
                variant={dictation.listening ? 'default' : 'outline'}
                onClick={dictation.listening ? dictation.stop : dictation.start}
                disabled={write.isPending}
              >
                {dictation.listening ? (
                  <>
                    <Square className="mr-1.5 h-3.5 w-3.5 fill-current" aria-hidden="true" />
                    Stop
                  </>
                ) : (
                  <>
                    <Mic className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                    Speak it
                  </>
                )}
              </Button>
            )}

            <Button
              size="sm"
              disabled={!canWrite}
              onClick={() => write.mutate({ rowId, rough })}
            >
              {write.isPending ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Sparkles className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              )}
              Write it up
            </Button>

            {dictation.listening && (
              <span className="flex items-center gap-1.5 text-xs text-blue-800">
                <span className="h-2 w-2 animate-pulse rounded-full bg-red-600" aria-hidden="true" />
                Listening — speak normally, pauses are fine
              </span>
            )}
          </div>

          {dictation.error && (
            <p className="mt-2 text-xs text-amber-800" role="alert">
              {dictation.error}
            </p>
          )}
        </>
      ) : (
        <>
          <p className="mt-1 text-xs text-gray-600">
            Read it before you keep it. Nothing is saved until you press Save note.
          </p>
          <p className="mt-2 whitespace-pre-wrap rounded-md border border-gray-200 bg-white p-3 text-sm leading-relaxed text-gray-900">
            {proposal}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => {
                onAccept(proposal)
                onClose()
              }}
            >
              <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              Use this
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={write.isPending}
              onClick={() => {
                setProposal(null)
                write.reset()
              }}
            >
              Back to what I said
            </Button>
          </div>
        </>
      )}

      {write.error && (
        <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">
          {write.error.message}
        </p>
      )}
    </div>
  )
}

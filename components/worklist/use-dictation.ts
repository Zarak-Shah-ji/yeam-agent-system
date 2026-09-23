'use client'

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'

/**
 * Talking instead of typing, using the browser's own recogniser.
 *
 * A biller comes off a call knowing five things and types one of them, because
 * typing is the slowest part of the job and the phone is already ringing. Speech
 * is the input this field always wanted.
 *
 * WHY THE BROWSER API AND NOT A RECORDING WE TRANSCRIBE. Recording audio and
 * posting it to a route would work in every browser, and it would mean a spoken
 * sentence that names the patient — which a note routinely does — travels to our
 * server as audio. The typed note already reaches the server, so this would not
 * breach a promise; it would create a second, fleshier copy of the same
 * sensitive thing, in a format nothing else in the system knows how to handle.
 * The browser API keeps the audio in the browser and hands us only text. That is
 * the same class of data the textarea already produces.
 *
 * The cost is coverage: Chrome and Edge fully, Safari partially, Firefox not at
 * all. `supported` is false there and the caller hides the button — the typed
 * path is the whole feature minus one convenience, not a broken screen.
 */

/* The vendor-prefixed constructor, which is still how Chrome ships it. */
type SpeechRecognitionLike = {
  continuous: boolean
  interimResults: boolean
  lang: string
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((e: SpeechRecognitionEventLike) => void) | null
  onerror: ((e: { error?: string }) => void) | null
  onend: (() => void) | null
}
type SpeechRecognitionEventLike = {
  resultIndex: number
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>
}

function recognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike
    webkitSpeechRecognition?: new () => SpeechRecognitionLike
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

/** Support cannot change mid-session, so there is nothing to subscribe to. */
const NEVER_CHANGES = () => () => {}

export function useDictation({
  /** Called with each finalised phrase, to be appended by the caller. */
  onPhrase,
}: {
  onPhrase: (text: string) => void
}) {
  const [listening, setListening] = useState(false)
  /** What is being said right now, before the recogniser commits to it. */
  const [interim, setInterim] = useState('')
  const [error, setError] = useState<string | null>(null)

  const recognition = useRef<SpeechRecognitionLike | null>(null)

  /*
    Whether this browser can listen at all.

    useSyncExternalStore rather than an effect that calls setState, which the
    React compiler lint rejects, and rather than reading it during render, which
    makes the server pass and the first client pass disagree — React reports that
    as a hydration mismatch rather than as the missing feature it is. This is the
    hook's actual purpose: a value the server cannot know, read safely on both
    sides. It never changes during a session, so the subscribe function has
    nothing to do.
  */
  const supported = useSyncExternalStore(
    NEVER_CHANGES,
    () => recognitionCtor() !== null,
    () => false,
  )

  const stop = useCallback(() => {
    recognition.current?.stop()
    recognition.current = null
    setListening(false)
    setInterim('')
  }, [])

  const start = useCallback(() => {
    const Ctor = recognitionCtor()
    if (!Ctor) {
      setError('This browser cannot listen. Chrome and Edge can; type it instead.')
      return
    }
    setError(null)

    const r = new Ctor()
    // Continuous, because a biller describing a call pauses to think and a
    // recogniser that stops at the first silence turns one account into six.
    r.continuous = true
    r.interimResults = true
    r.lang = navigator.language || 'en-US'

    r.onresult = e => {
      let pending = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i]
        const text = result[0]?.transcript ?? ''
        if (result.isFinal) onPhrase(text)
        else pending += text
      }
      setInterim(pending)
    }
    r.onerror = e => {
      // "no-speech" and "aborted" are what happens when someone thinks for a
      // moment or clicks stop. Reporting those as failures teaches people the
      // feature is broken.
      if (e.error === 'no-speech' || e.error === 'aborted') return
      setError(
        e.error === 'not-allowed'
          ? 'The microphone is blocked. Allow it in the address bar, then try again.'
          : 'Dictation stopped unexpectedly. Type it instead.',
      )
      setListening(false)
    }
    r.onend = () => {
      setListening(false)
      setInterim('')
    }

    recognition.current = r
    r.start()
    setListening(true)
    /*
      onPhrase is a dependency rather than a ref mirrored during render, which
      the React compiler rejects. A stale closure would be a real hazard here —
      the recogniser lives for the whole dictation — except that the caller's
      handler is a functional setState, so appending to whatever the box holds
      now is correct no matter which render it was captured in.
    */
  }, [onPhrase])

  /* A recogniser left running after the panel closes keeps the mic light on. */
  useEffect(() => () => recognition.current?.abort(), [])

  return { supported, listening, interim, error, start, stop }
}

'use client'

import { useEffect, useRef, useState } from 'react'
import { CornerDownLeft, Loader2, Search, Sparkles, X } from 'lucide-react'
import { useChat } from '@/components/layout/chat-context'
import { looksConversational, normalizeQuery } from '@/lib/denials/search'

/**
 * Find one claim, or ask about many.
 *
 * These look like two features and are deliberately one control. A biller
 * hunting for the claim on the letter in their hand types a claim number; the
 * same person, ten seconds later, wants to know why that payer keeps denying
 * them. Splitting those into a search box and a chat box makes them guess which
 * one takes their sentence, and the wrong guess is an empty table.
 *
 * So the literal filter always runs — every keystroke, over the columns the row
 * actually has — and the assistant is offered rather than substituted. The offer
 * appears only where the filter cannot help: when the text reads as a question,
 * or when it matched nothing. Enter takes the offer when it is showing, which is
 * the only time Enter has anything to do here.
 */

/** Long enough that a claim number lands in one query, short enough to feel live. */
const DEBOUNCE_MS = 250

export function SearchBar({
  value,
  onChange,
  matches,
  isSearching,
}: {
  /** The committed query the table is filtered by. */
  value: string
  onChange: (q: string) => void
  /** Rows currently rendered for that query, or null while it is unknown. */
  matches: number | null
  isSearching: boolean
}) {
  const [text, setText] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)
  const { submit } = useChat()

  // Debounce the committed query, not the keystrokes: the field stays fully
  // responsive while the table lags a quarter-second behind it.
  useEffect(() => {
    const trimmed = normalizeQuery(text)
    if (trimmed === value) return
    const id = setTimeout(() => onChange(trimmed), DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [text, value, onChange])

  const trimmed = normalizeQuery(text)
  const settled = trimmed === value && !isSearching
  // A question will never match a substring, so offer the assistant as soon as
  // it reads like one — before the empty table appears, not after.
  const offerAgent = trimmed.length > 0 && (looksConversational(trimmed) || (settled && matches === 0))

  function askAgent() {
    if (!trimmed) return
    submit(trimmed)
    // Drop the filter as the conversation opens. The question was never a
    // filter, and leaving it applied would put an empty table behind the answer.
    setText('')
    onChange('')
    inputRef.current?.blur()
  }

  function clear() {
    setText('')
    onChange('')
    inputRef.current?.focus()
  }

  return (
    <div className="w-full sm:max-w-sm">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
          aria-hidden="true"
        />
        <input
          ref={inputRef}
          type="search"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && offerAgent) {
              e.preventDefault()
              askAgent()
            } else if (e.key === 'Escape' && text) {
              e.preventDefault()
              clear()
            }
          }}
          placeholder="Search claim, payer, CARC, code"
          aria-label="Search the worklist"
          className="h-9 w-full rounded-md border border-gray-300 bg-white pl-9 pr-16 text-sm shadow-sm transition-colors placeholder:text-gray-400 focus-visible:border-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 [&::-webkit-search-cancel-button]:hidden"
        />
        <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1.5">
          {isSearching && <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" />}
          {text && (
            <button
              type="button"
              onClick={clear}
              className="rounded p-0.5 text-gray-400 transition-colors hover:text-gray-600"
              title="Clear search (Esc)"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* One muted line under the field: what the filter found, and — where a
          substring was never going to be the answer — the way out. */}
      <div className="mt-1 flex min-h-[1.25rem] flex-wrap items-center gap-x-2 px-0.5 text-xs">
        {value && matches !== null && matches > 0 && (
          <span className="text-gray-500">
            {matches} {matches === 1 ? 'row' : 'rows'} matching &ldquo;{value}&rdquo;
          </span>
        )}
        {offerAgent && (
          <button
            type="button"
            onClick={askAgent}
            className="group inline-flex items-center gap-1.5 text-left text-gray-500 transition-colors hover:text-blue-700"
          >
            <Sparkles className="h-3.5 w-3.5 shrink-0 text-blue-500" aria-hidden="true" />
            <span>
              {settled && matches === 0 ? 'No row matches that. ' : ''}
              <span className="underline decoration-dotted underline-offset-2 group-hover:decoration-solid">
                Ask the agent
              </span>
              {' instead'}
            </span>
            <CornerDownLeft
              className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
              aria-hidden="true"
            />
          </button>
        )}
      </div>
    </div>
  )
}

'use client'

import { useEffect, useRef } from 'react'
import { ArrowLeft, Loader2, Search, X } from 'lucide-react'
import { SearchResultsList } from './SearchResultsList'
import { useSearchController } from './useSearchController'

/**
 * Full-screen search sheet (phones). Same results UI and data as the desktop
 * dropdown. Closes on select, Esc, the back arrow, or the browser/OS back
 * gesture (a history entry is pushed while it is open).
 */
export default function MobileSearchSheet({
  open,
  onClose,
  placeholder = 'Search stocks, ETFs, crypto…',
}: {
  open: boolean
  onClose: () => void
  placeholder?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const pushedRef = useRef(false)
  const listboxId = 'mobile-search-listbox'

  const ctl = useSearchController({
    idPrefix: 'ms',
    open,
    // Our pushed history entry is replaced by the Research URL, so Back
    // returns to the page the sheet was opened from.
    navigate: 'replace',
    onDone: () => {
      pushedRef.current = false
      onCloseRef.current()
    },
  })

  // Back gesture closes the sheet instead of leaving the page.
  useEffect(() => {
    if (!open) return
    window.history.pushState({ qtSearchSheet: true }, '')
    pushedRef.current = true
    const onPop = () => {
      pushedRef.current = false
      onCloseRef.current()
    }
    window.addEventListener('popstate', onPop)
    const t = setTimeout(() => inputRef.current?.focus(), 60)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      clearTimeout(t)
      window.removeEventListener('popstate', onPop)
      document.body.style.overflow = prevOverflow
      // Closed from the UI: pop the entry we pushed.
      if (pushedRef.current) {
        pushedRef.current = false
        window.history.back()
      }
    }
  }, [open])

  useEffect(() => {
    if (!open) ctl.setQuery('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open) return null

  const busy = ctl.hasQuery && ctl.pending

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Search"
      className="fixed inset-0 z-[70] flex flex-col bg-white dark:bg-[#0b0f17]"
      data-testid="mobile-search-sheet"
    >
      <div className="border-b border-slate-200 px-3 pb-2.5 pt-safe dark:border-white/10">
        <div className="flex items-center gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close search"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-fg-secondary active:bg-slate-100 dark:active:bg-white/10"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="relative flex h-11 flex-1 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 focus-within:border-blue-500/60 dark:border-white/10 dark:bg-white/[0.05]">
            <Search className="h-4 w-4 shrink-0 text-fg-muted" aria-hidden />
            <input
              ref={inputRef}
              type="search"
              inputMode="search"
              enterKeyHint="go"
              role="combobox"
              aria-expanded="true"
              aria-controls={listboxId}
              aria-autocomplete="list"
              aria-activedescendant={ctl.activeId}
              aria-label="Search symbols and companies"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="characters"
              spellCheck={false}
              value={ctl.query}
              onChange={(e) => ctl.setQuery(e.target.value)}
              onKeyDown={(e) => ctl.onKeyDown(e, onClose)}
              placeholder={placeholder}
              className="min-w-0 flex-1 border-none bg-transparent text-[15px] text-fg-primary outline-none focus-visible:outline-none placeholder:text-fg-muted [&::-webkit-search-cancel-button]:hidden"
            />
            {busy ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-fg-muted" aria-hidden />
            ) : ctl.query ? (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => {
                  ctl.setQuery('')
                  inputRef.current?.focus()
                }}
                className="-mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-fg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto overscroll-contain pb-safe">
        <SearchResultsList ctl={ctl} listboxId={listboxId} size="lg" />
      </div>
    </div>
  )
}

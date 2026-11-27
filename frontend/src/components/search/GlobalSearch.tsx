'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Search, X } from 'lucide-react'
import { SearchResultsList } from './SearchResultsList'
import { useSearchController } from './useSearchController'

function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  if (!el) return false
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable
}

/**
 * Header search (desktop). Opaque elevated panel anchored to the input,
 * keyboard navigable (↑/↓/Enter/Esc), focused with "/" or ⌘K / Ctrl+K.
 */
export default function GlobalSearch({ className = '' }: { className?: string }) {
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const close = useCallback(() => {
    setOpen(false)
    inputRef.current?.blur()
  }, [])
  const ctl = useSearchController({ idPrefix: 'gs', open, onDone: close })
  const listboxId = 'global-search-listbox'

  // "/" (when not typing) and ⌘K / Ctrl+K focus the search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const cmdK = (e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k'
      const slash = e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !isTypingTarget(e.target)
      if (!cmdK && !slash) return
      // Only the visible instance (desktop header is display:none on phones).
      if (!inputRef.current || inputRef.current.offsetParent === null) return
      e.preventDefault()
      inputRef.current.focus()
      inputRef.current.select()
      setOpen(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Click outside closes.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // Keep the active row in view.
  useEffect(() => {
    if (!ctl.activeId) return
    document.getElementById(ctl.activeId)?.scrollIntoView({ block: 'nearest' })
  }, [ctl.activeId])

  const busy = ctl.hasQuery && ctl.pending

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <div
        className={`flex h-10 items-center gap-2 rounded-xl border px-3 transition-colors ${
          open
            ? 'border-blue-500/60 bg-white ring-2 ring-blue-500/15 dark:bg-[#0f1520]'
            : 'border-line-subtle bg-white/70 hover:border-slate-300 dark:bg-white/[0.04] dark:hover:border-white/20'
        }`}
      >
        <Search className="h-4 w-4 shrink-0 text-fg-muted" aria-hidden />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={open ? ctl.activeId : undefined}
          aria-label="Search symbols and companies"
          autoComplete="off"
          spellCheck={false}
          value={ctl.query}
          onChange={(e) => {
            ctl.setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) setOpen(true)
            ctl.onKeyDown(e, close)
          }}
          placeholder="Search stocks, ETFs, crypto…"
          className="min-w-0 flex-1 border-none bg-transparent text-sm text-fg-primary outline-none placeholder:text-fg-muted focus-visible:outline-none"
        />
        {busy ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-fg-muted" aria-hidden />
        ) : ctl.query ? (
          <button
            type="button"
            aria-label="Clear search"
            onMouseDown={(e) => {
              e.preventDefault()
              ctl.setQuery('')
            }}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-fg-muted hover:text-fg-primary"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : (
          <kbd className="hidden shrink-0 rounded border border-line-subtle px-1.5 py-px font-sans text-[10px] text-fg-muted lg:inline">
            ⌘K
          </kbd>
        )}
      </div>

      {open && (
        <div
          className="absolute left-0 top-full z-[60] mt-2 w-full min-w-[420px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_16px_40px_-12px_rgba(15,23,42,0.28)] dark:border-white/10 dark:bg-[#0f1520] dark:shadow-[0_16px_40px_-12px_rgba(0,0,0,0.7)]"
          data-testid="global-search-panel"
        >
          <div className="max-h-[min(70vh,480px)] overflow-y-auto overscroll-contain">
            <SearchResultsList ctl={ctl} listboxId={listboxId} />
          </div>
          <div className="flex items-center gap-3 border-t border-slate-100 bg-slate-50 px-3 py-1.5 text-[10.5px] text-fg-muted dark:border-white/[0.06] dark:bg-[#0b1019]">
            <span><kbd className="font-sans">↑</kbd> <kbd className="font-sans">↓</kbd> navigate</span>
            <span><kbd className="font-sans">↵</kbd> open</span>
            <span><kbd className="font-sans">esc</kbd> close</span>
          </div>
        </div>
      )}
    </div>
  )
}

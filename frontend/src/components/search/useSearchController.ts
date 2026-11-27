'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { syncSymbol } from '@/lib/api'
import { POPULAR_TICKERS } from '@/lib/popularTickers'
import {
  flattenGroups,
  groupSearchResults,
  quoteSymbolsFor,
  typedTicker,
  type SearchHit,
  type SearchKind,
} from '@/lib/symbolSearch'
import { useRecentSearches, useSearchQuotes, useSymbolSearch } from '@/lib/useSymbolSearch'

export interface SearchOption {
  id: string
  symbol: string
  name: string
  kind: SearchKind
  exchange?: string
  hit?: SearchHit
}

export interface SearchSection {
  key: string
  label: string
  options: SearchOption[]
  /** Index of the first option in the flat options list. */
  start: number
  /** Recent-searches section: rows get a remove button. */
  recent?: boolean
}

function hitOption(h: SearchHit, prefix: string): SearchOption {
  return { id: `${prefix}-${h.symbol}`, symbol: h.symbol, name: h.name, kind: h.kind, exchange: h.exchange, hit: h }
}

/**
 * State shared by the desktop dropdown and the mobile sheet: query, debounced
 * results, sections (results grouped by kind, or recent + popular when the
 * query is empty), the keyboard-active option, and selection/navigation.
 */
export function useSearchController({
  idPrefix,
  open,
  onDone,
  navigate = 'push',
}: {
  idPrefix: string
  open: boolean
  onDone?: () => void
  /** 'replace' when the caller pushed its own history entry (mobile sheet). */
  navigate?: 'push' | 'replace'
}) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(-1)
  const search = useSymbolSearch(query, open)
  const { recent, add: addRecent, remove: removeRecent, clear: clearRecent } = useRecentSearches()
  const hasQuery = query.trim().length > 0

  const sections: SearchSection[] = useMemo(() => {
    const out: SearchSection[] = []
    let start = 0
    const push = (key: string, label: string, options: SearchOption[], extra?: Partial<SearchSection>) => {
      if (!options.length) return
      out.push({ key, label, options, start, ...extra })
      start += options.length
    }
    if (hasQuery) {
      for (const g of groupSearchResults(search.results)) {
        push(g.kind, g.label, g.hits.map((h) => hitOption(h, `${idPrefix}-${g.kind}`)))
      }
    } else {
      push(
        'recent',
        'Recent',
        recent.map((r) => ({ id: `${idPrefix}-recent-${r.symbol}`, symbol: r.symbol, name: r.name, kind: r.kind })),
        { recent: true },
      )
      const seen = new Set(recent.map((r) => r.symbol))
      push(
        'popular',
        'Popular',
        POPULAR_TICKERS.filter((t) => !seen.has(t.symbol)).map((t) => ({
          id: `${idPrefix}-popular-${t.symbol}`,
          symbol: t.symbol,
          name: t.name,
          kind: (t.symbol === 'SPY' ? 'etf' : 'stock') as SearchKind,
        })),
      )
    }
    return out
  }, [hasQuery, search.results, recent, idPrefix])

  const options = useMemo(() => sections.flatMap((s) => s.options), [sections])

  // New result set: first row active when searching, none when browsing recents.
  useEffect(() => {
    setActive(hasQuery && options.length > 0 ? 0 : -1)
  }, [options, hasQuery])

  const quoteSymbols = useMemo(
    () => (hasQuery && !search.pending ? quoteSymbolsFor(flattenGroups(groupSearchResults(search.results))) : []),
    [hasQuery, search.pending, search.results],
  )
  const quotes = useSearchQuotes(quoteSymbols, open)

  const go = useCallback(
    (symbol: string, name?: string, kind?: SearchKind) => {
      const sym = symbol.toUpperCase()
      addRecent({ symbol: sym, name: name || sym, kind: kind ?? 'stock' })
      setQuery('')
      onDone?.()
      // Fire-and-forget: warm the backend for this ticker; never block navigation.
      syncSymbol(sym).catch(() => {})
      const href = `/research?symbol=${encodeURIComponent(sym)}`
      if (navigate === 'replace') router.replace(href)
      else router.push(href)
    },
    [addRecent, onDone, router, navigate],
  )

  const selectOption = useCallback((o: SearchOption) => go(o.symbol, o.name, o.kind), [go])

  /** Enter: open the active row, else treat the typed text as a ticker. */
  const submit = useCallback(() => {
    const o = active >= 0 ? options[active] : undefined
    if (o) return selectOption(o)
    const t = typedTicker(query)
    if (t) go(t)
  }, [active, options, query, selectOption, go])

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>, close: () => void) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        if (options.length) setActive((i) => (i + 1) % options.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        if (options.length) setActive((i) => (i <= 0 ? options.length - 1 : i - 1))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        submit()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        if (query) setQuery('')
        else close()
      }
    },
    [options.length, submit, query],
  )

  return {
    query,
    setQuery,
    active,
    setActive,
    sections,
    options,
    hasQuery,
    loading: search.loading,
    pending: search.pending,
    debouncedQuery: search.debouncedQuery,
    error: search.error,
    quotes: quotes.data ?? {},
    selectOption,
    submit,
    onKeyDown,
    removeRecent,
    clearRecent,
    activeId: active >= 0 ? options[active]?.id : undefined,
  }
}

export type SearchController = ReturnType<typeof useSearchController>

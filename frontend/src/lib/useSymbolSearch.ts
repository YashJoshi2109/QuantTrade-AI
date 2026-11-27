'use client'

/**
 * Hooks behind the global search (desktop dropdown + mobile sheet).
 *
 * - One debounced (180ms) React Query per query string: ['symbolSearch', q].
 *   Typing fast aborts the superseded request (queryFn signal), identical
 *   queries are served from cache for 60s, and desktop + mobile share it.
 * - Prices: one batched /api/v1/quotes call for the visible US stocks/ETFs,
 *   fetched only once results have settled. Missing prices are omitted.
 * - Recent searches persist per user (lib/persistentState).
 */
import { useCallback, useEffect, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { apiUrl } from './api'
import { throwIfNotOk } from './httpError'
import { usePersistentState } from './persistentState'
import { shouldRetryQuery } from './queryPolicy'
import { parseRecent, pushRecent, type RecentSearch, type SearchHit, type SearchResponse } from './symbolSearch'

export const SEARCH_DEBOUNCE_MS = 180

export function useDebouncedValue<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return v
}

export async function fetchSymbolSearch(q: string, signal?: AbortSignal): Promise<SearchHit[]> {
  const url = `/api/search?q=${encodeURIComponent(q)}&limit=12`
  const res = await fetch(url, { signal })
  throwIfNotOk(res, url)
  const body = (await res.json()) as SearchResponse
  return Array.isArray(body?.results) ? body.results : []
}

export function symbolSearchKey(q: string) {
  return ['symbolSearch', q.trim().toLowerCase()] as const
}

/** Debounced search. `settled` is false while the debounce or request is pending. */
export function useSymbolSearch(query: string, enabled = true) {
  const debounced = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS)
  const active = enabled && debounced.length > 0
  const q = useQuery<SearchHit[]>({
    queryKey: symbolSearchKey(debounced),
    queryFn: ({ signal }) => fetchSymbolSearch(debounced, signal),
    enabled: active,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    retry: shouldRetryQuery,
    placeholderData: keepPreviousData,
  })
  const pending = query.trim() !== debounced || q.isFetching
  return {
    debouncedQuery: debounced,
    results: active ? q.data ?? [] : [],
    /** True when there is nothing to show yet (first load for this query). */
    loading: query.trim().length > 0 && pending && !(q.data && q.data.length > 0),
    pending,
    error: q.error,
  }
}

export interface SearchQuote {
  price: number | null
  change_percent: number | null
}

interface BatchQuotesBody {
  quotes?: Record<string, { price?: number | null; change_percent?: number | null; unavailable?: boolean }>
}

function finite(n: unknown): number | null {
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

/** One batched quote lookup for the result symbols; keyed by the sorted list. */
export function useSearchQuotes(symbols: string[], enabled = true) {
  const key = symbols.join(',')
  return useQuery<Record<string, SearchQuote>>({
    queryKey: ['symbolSearchQuotes', key],
    enabled: enabled && symbols.length > 0,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    retry: shouldRetryQuery,
    queryFn: async ({ signal }) => {
      const url = apiUrl('/api/v1/quotes')
      url.searchParams.set('symbols', key)
      const res = await fetch(url.toString(), { signal })
      throwIfNotOk(res, url.toString())
      const body = (await res.json()) as BatchQuotesBody
      const out: Record<string, SearchQuote> = {}
      for (const [sym, q] of Object.entries(body?.quotes ?? {})) {
        if (!q || q.unavailable) continue
        const price = finite(q.price)
        if (price == null || price <= 0) continue
        out[sym.toUpperCase()] = { price, change_percent: finite(q.change_percent) }
      }
      return out
    },
  })
}

export function useRecentSearches() {
  const [recent, setRecent, controls] = usePersistentState<RecentSearch[]>('search.recent', [], {
    validate: parseRecent,
    version: 1,
  })
  const add = useCallback(
    (item: RecentSearch) => setRecent((prev) => pushRecent(prev, item)),
    [setRecent],
  )
  const remove = useCallback(
    (symbol: string) => setRecent((prev) => prev.filter((r) => r.symbol !== symbol.toUpperCase())),
    [setRecent],
  )
  const clear = useCallback(() => setRecent([]), [setRecent])
  return { recent, add, remove, clear, controls }
}

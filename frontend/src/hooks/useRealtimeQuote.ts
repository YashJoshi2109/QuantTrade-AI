import { useQuery } from '@tanstack/react-query'
import { fetchQuote, fetchFinnhubQuote } from '@/lib/api'
import { backoffInterval, QUOTE_POLL } from '@/lib/queryPolicy'
import { usePhaseInterval } from '@/hooks/useMarketRefresh'

export interface Quote {
  symbol: string
  price: number | null
  change: number | null
  change_percent: number | null
  volume: number | null
  high?: number | null
  low?: number | null
  open?: number | null
  previous_close?: number | null
  timestamp?: string | null
  data_source?: string
  latency_ms?: number
}

export interface IndexQuote extends Quote {
  indexName?: string
}

interface UseRealtimeQuoteOptions {
  symbol: string
  enabled?: boolean
  /** Base poll interval (ms). Default: market-phase aware QUOTE_POLL (20s / 60s / 120s). */
  refetchInterval?: number
  priority?: 'high' | 'normal'
  useFinnhub?: boolean
  /** false = fetch once but do not poll (e.g. the profile says the ticker does not exist) */
  poll?: boolean
}

/**
 * Hook for fetching real-time stock quotes with automatic updates.
 *
 * Every observer of a given (symbol, priority, source) shares one query, and
 * React Query polls a key at the smallest interval any observer asks for, so
 * callers should leave `refetchInterval` unset and get the shared,
 * market-phase-aware default. 429s back off (honouring Retry-After) and are
 * never retried immediately (lib/queryPolicy).
 */
export function useRealtimeQuote({
  symbol,
  enabled = true,
  refetchInterval,
  priority = 'normal',
  useFinnhub = false,
  poll = true,
}: UseRealtimeQuoteOptions) {
  const phaseBase = usePhaseInterval(QUOTE_POLL)
  const base = refetchInterval ?? phaseBase
  return useQuery<Quote>({
    queryKey: ['realtimeQuote', symbol, priority, useFinnhub ? 'finnhub' : 'enhanced'],
    queryFn: () => useFinnhub ? fetchFinnhubQuote(symbol, priority) : fetchQuote(symbol, priority),
    enabled: enabled && !!symbol,
    refetchInterval: backoffInterval(poll ? base : false),
    staleTime: Math.min(base / 2, 10_000),
    // Polled anyway; a focus refetch would only add a burst on tab switch.
    refetchOnWindowFocus: false,
  })
}

/**
 * Hook for fetching multiple real-time quotes with priority support
 */
export function useRealtimeQuotes(
  symbols: string[], 
  refetchInterval = 10000,
  priority: 'high' | 'normal' = 'normal'
) {
  return useQuery<IndexQuote[]>({
    queryKey: ['realtimeQuotes', symbols, priority],
    queryFn: async () => {
      const settled = await Promise.allSettled(symbols.map((symbol) => fetchQuote(symbol, priority)))
      return settled.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
    },
    enabled: symbols.length > 0,
    refetchInterval: backoffInterval(refetchInterval),
    staleTime: priority === 'high' ? 3000 : 5000,
  })
}

import { useQuery } from '@tanstack/react-query'
import { fetchQuote, fetchFinnhubQuote, QuoteData } from '@/lib/api'

interface UseRealtimeQuoteOptions {
  symbol: string
  enabled?: boolean
  refetchInterval?: number
  priority?: 'high' | 'normal'
  useFinnhub?: boolean
}

/**
 * Hook for fetching real-time stock quotes with automatic updates
 * Uses enhanced endpoint with priority support for rate limiting
 */
export function useRealtimeQuote({ 
  symbol, 
  enabled = true,
  refetchInterval = 5000, // 5 seconds default
  priority = 'normal',
  useFinnhub = false
}: UseRealtimeQuoteOptions) {
  return useQuery<QuoteData>({
    queryKey: ['realtimeQuote', symbol, priority],
    queryFn: () => useFinnhub ? fetchFinnhubQuote(symbol, priority) : fetchQuote(symbol, priority),
    enabled: enabled && !!symbol,
    refetchInterval, // Auto-refresh
    staleTime: priority === 'high' ? 2000 : 5000, // High priority = fresher data
    retry: 2,
    retryDelay: 1000,
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
  return useQuery({
    queryKey: ['realtimeQuotes', symbols, priority],
    queryFn: async () => {
      const promises = symbols.map(symbol => fetchQuote(symbol, priority))
      return Promise.all(promises)
    },
    enabled: symbols.length > 0,
    refetchInterval,
    staleTime: priority === 'high' ? 3000 : 5000,
  })
}

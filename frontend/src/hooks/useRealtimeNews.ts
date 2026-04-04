import { useQuery, keepPreviousData } from '@tanstack/react-query'
import {
  fetchRealtimeNews,
  fetchYFinanceNews,
  fetchLiveMarketHeadlines,
  type LiveHeadlinesContext,
  NewsArticle,
} from '@/lib/api'

interface UseRealtimeNewsOptions {
  symbol?: string
  enabled?: boolean
  refetchInterval?: number
  limit?: number
  sources?: string
}

/**
 * Hook for fetching real-time news with automatic updates
 * Uses multiple sources: yfinance, Google News, NewsAPI, MarketWatch
 */
export function useRealtimeNews({ 
  symbol,
  enabled = true,
  refetchInterval = 30000, // 30 seconds default
  limit = 20,
  sources
}: UseRealtimeNewsOptions) {
  return useQuery<NewsArticle[]>({
    queryKey: ['realtimeNews', symbol, sources],
    queryFn: () => {
      if (!symbol) throw new Error('Symbol required')
      return fetchRealtimeNews(symbol, limit, sources)
    },
    enabled: enabled && !!symbol,
    refetchInterval,
    staleTime: 15000, // Consider data stale after 15 seconds
    retry: 2,
  })
}

/**
 * Hook for yfinance news only (fastest source)
 */
export function useYFinanceNews(symbol: string, limit = 20, refetchInterval = 30000) {
  return useQuery<NewsArticle[]>({
    queryKey: ['yfinanceNews', symbol],
    queryFn: () => fetchYFinanceNews(symbol, limit),
    enabled: !!symbol,
    refetchInterval,
    staleTime: 15000,
  })
}

/**
 * Hook for breaking market news (optionally scoped to continent / exchange for the dashboard)
 */
export function useBreakingNews(
  limit = 10,
  refetchInterval = 60000,
  context?: LiveHeadlinesContext
) {
  const c = context?.continent ?? 'global'
  const x = context?.exchangeId ?? ''
  return useQuery<NewsArticle[]>({
    queryKey: ['breakingNews', 'liveHeadlines', limit, c, x],
    queryFn: () => fetchLiveMarketHeadlines(limit, context),
    refetchInterval,
    staleTime: 30000,
    retry: 1,
    retryDelay: 1500,
    placeholderData: keepPreviousData,
  })
}

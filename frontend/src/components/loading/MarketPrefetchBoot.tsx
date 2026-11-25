'use client'

import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  fetchMarketMovers,
  fetchSectorPerformance,
  fetchMarketIndices,
  fetchPredictionAlerts,
} from '@/lib/api'
import { fetchNewsFeedWithFallback, newsFeedQueryKey } from '@/lib/newsFeed'

/**
 * Warms the React Query cache for dashboard-critical keys on mount so the first
 * interactive paint often reuses in-flight or completed data.
 */
export default function MarketPrefetchBoot() {
  const queryClient = useQueryClient()

  useEffect(() => {
    void queryClient.prefetchQuery({
      queryKey: ['marketMovers'],
      queryFn: () => fetchMarketMovers(),
    })
    void queryClient.prefetchQuery({
      queryKey: ['sectorPerformance'],
      queryFn: () => fetchSectorPerformance(),
    })
    void queryClient.prefetchQuery({
      queryKey: ['marketIndices'],
      queryFn: () => fetchMarketIndices(),
    })
    void queryClient.prefetchQuery({
      queryKey: newsFeedQueryKey({ limit: 50 }),
      queryFn: () => fetchNewsFeedWithFallback({ limit: 50 }),
    })
    void queryClient.prefetchQuery({
      queryKey: ['predictionAlerts'],
      queryFn: () => fetchPredictionAlerts(0.65, 2.0),
    })
  }, [queryClient])

  return null
}

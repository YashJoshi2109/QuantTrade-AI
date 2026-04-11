'use client'

/**
 * PrefetchEngine — Smart multi-phase data preloader
 *
 * Phase 1 (app mount — no auth): Prefetch all public page data
 *   Dashboard, Markets, Monitor, Research (default symbol), Pricing, Ideas Lab
 *
 * Phase 2 (on login trigger): Prefetch auth-required data
 *   Watchlist, Copilot history, User preferences, Billing
 *
 * Strategy:
 *   - Staggered batches (avoid API thundering herd)
 *   - Priority ordering (most-visited pages first)
 *   - Deduplication (React Query handles this automatically)
 *   - Long gcTime (30min) so data survives navigation
 */

import { useEffect, useRef, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  fetchMarketMovers,
  fetchSectorPerformance,
  fetchMarketIndices,
  fetchLiveMarketHeadlines,
  fetchPredictionAlerts,
  fetchHeatmapData,
  fetchMarketStatus,
  fetchBatchLoad,
  getTrendingIdeas,
  fetchIpoCalendar,
  fetchMarketCoverage,
  getWatchlist,
  getCopilotUsage,
} from '@/lib/api'

// Stagger delay between batches (ms) to avoid API collisions
const BATCH_DELAY = 300

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export default function PrefetchEngine() {
  const queryClient = useQueryClient()
  const hasRunPhase1 = useRef(false)

  // ── Phase 1: Public pages (no auth) ─────────────────────────────────
  useEffect(() => {
    if (hasRunPhase1.current) return
    hasRunPhase1.current = true

    const runPhase1 = async () => {
      // Batch 1 — Dashboard critical (highest priority)
      const batch1 = [
        queryClient.prefetchQuery({
          queryKey: ['marketIndices'],
          queryFn: () => fetchMarketIndices(),
          staleTime: 60_000,
        }),
        queryClient.prefetchQuery({
          queryKey: ['marketStatus'],
          queryFn: () => fetchMarketStatus(),
          staleTime: 60_000,
        }),
        queryClient.prefetchQuery({
          queryKey: ['marketMovers'],
          queryFn: () => fetchMarketMovers(),
          staleTime: 60_000,
        }),
      ]
      await Promise.allSettled(batch1)

      await delay(BATCH_DELAY)

      // Batch 2 — Markets page
      const batch2 = [
        queryClient.prefetchQuery({
          queryKey: ['sectorPerformance'],
          queryFn: () => fetchSectorPerformance(),
          staleTime: 90_000,
        }),
        queryClient.prefetchQuery({
          queryKey: ['heatmapData'],
          queryFn: () => fetchHeatmapData(),
          staleTime: 120_000,
        }),
        queryClient.prefetchQuery({
          queryKey: ['breakingNews', 'liveHeadlines', 20],
          queryFn: () => fetchLiveMarketHeadlines(20),
          staleTime: 60_000,
        }),
      ]
      await Promise.allSettled(batch2)

      await delay(BATCH_DELAY)

      // Batch 3 — Ideas Lab + Monitor
      const batch3 = [
        queryClient.prefetchQuery({
          queryKey: ['modelIndexBatch'],
          queryFn: () => fetchBatchLoad(),
          staleTime: 300_000, // 5min — baskets don't change fast
        }),
        queryClient.prefetchQuery({
          queryKey: ['trendingIdeas'],
          queryFn: () => getTrendingIdeas(),
          staleTime: 120_000,
        }),
        queryClient.prefetchQuery({
          queryKey: ['predictionAlerts'],
          queryFn: () => fetchPredictionAlerts(0.65, 2.0),
          staleTime: 60_000,
        }),
      ]
      await Promise.allSettled(batch3)

      await delay(BATCH_DELAY)

      // Batch 4 — Lower priority
      const batch4 = [
        queryClient.prefetchQuery({
          queryKey: ['ipoCalendar'],
          queryFn: () => fetchIpoCalendar(),
          staleTime: 1800_000, // 30min
        }),
        queryClient.prefetchQuery({
          queryKey: ['marketCoverage'],
          queryFn: () => fetchMarketCoverage(),
          staleTime: 300_000,
        }),
      ]
      await Promise.allSettled(batch4)
    }

    // Start after a small delay so initial render isn't blocked
    setTimeout(runPhase1, 100)
  }, [queryClient])

  return null
}


/**
 * Hook to trigger Phase 2 prefetch (auth-required pages).
 * Call this when user enters email or logs in.
 */
export function usePrefetchAuthPages() {
  const queryClient = useQueryClient()
  const hasRun = useRef(false)

  const prefetchAuthPages = useCallback(async () => {
    if (hasRun.current) return
    hasRun.current = true

    // Batch — auth-required data
    await Promise.allSettled([
      queryClient.prefetchQuery({
        queryKey: ['watchlist'],
        queryFn: () => getWatchlist(),
        staleTime: 60_000,
      }),
      queryClient.prefetchQuery({
        queryKey: ['copilotUsage'],
        queryFn: () => getCopilotUsage(),
        staleTime: 60_000,
      }),
    ])
  }, [queryClient])

  return prefetchAuthPages
}

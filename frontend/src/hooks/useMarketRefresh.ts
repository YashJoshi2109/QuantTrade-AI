'use client'

import { useQuery } from '@tanstack/react-query'
import { fetchMarketStatus, type MarketStatus } from '@/lib/api'
import { marketPhaseFrom } from '@/lib/marketPhase'
import { backoffInterval, type MarketPhase, type PhaseIntervals } from '@/lib/queryPolicy'

interface MarketRefreshConfig {
  /** Refresh interval during live market hours (ms). Default 15s */
  liveInterval?: number
  /** Refresh interval during extended hours (ms). Default 60s */
  extendedInterval?: number
  /** Refresh interval when market is closed (ms). Default 5min */
  closedInterval?: number
}

const DEFAULTS: Required<MarketRefreshConfig> = {
  liveInterval: 15_000,
  extendedInterval: 60_000,
  closedInterval: 300_000,
}

/** One market-status query app-wide (header pill, ticker, polling intervals). */
export const MARKET_STATUS_KEY = ['marketStatus'] as const

export const marketStatusQuery = {
  queryKey: MARKET_STATUS_KEY,
  queryFn: fetchMarketStatus,
  staleTime: 60_000,
  refetchInterval: backoffInterval(120_000),
}

export function useMarketStatus() {
  return useQuery<MarketStatus>(marketStatusQuery)
}

/** 'open' | 'extended' | 'closed' (backend status, NY clock fallback). */
export function useMarketPhase(): MarketPhase {
  const { data } = useMarketStatus()
  return marketPhaseFrom(data)
}

/** Base poll interval (ms) for the current market phase. */
export function usePhaseInterval(intervals: PhaseIntervals): number {
  return intervals[useMarketPhase()]
}

/**
 * Returns the appropriate refetch interval based on live market status.
 */
export function useMarketRefreshInterval(config?: MarketRefreshConfig): number {
  const { liveInterval, extendedInterval, closedInterval } = { ...DEFAULTS, ...config }
  return usePhaseInterval({ open: liveInterval, extended: extendedInterval, closed: closedInterval })
}

/**
 * Boolean: true when the market is currently live.
 */
export function useMarketIsLive(): boolean {
  return useMarketPhase() === 'open'
}

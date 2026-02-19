'use client'

import { useState, useEffect, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchMarketStatus } from '@/lib/api'

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

/**
 * Returns the appropriate refetch interval based on live market status.
 * Checks market status every 60s and adjusts the interval accordingly.
 */
export function useMarketRefreshInterval(config?: MarketRefreshConfig): number {
  const { liveInterval, extendedInterval, closedInterval } = { ...DEFAULTS, ...config }

  const { data: status } = useQuery({
    queryKey: ['market-status'],
    queryFn: fetchMarketStatus,
    staleTime: 60_000,
    refetchInterval: 60_000,
  })

  if (!status) return closedInterval

  if (status.is_open) return liveInterval

  // Extended hours heuristic: weekday but market closed
  if (status.is_weekday && !status.is_open) return extendedInterval

  return closedInterval
}

/**
 * Boolean: true when the market is currently live.
 */
export function useMarketIsLive(): boolean {
  const { data: status } = useQuery({
    queryKey: ['market-status'],
    queryFn: fetchMarketStatus,
    staleTime: 60_000,
    refetchInterval: 60_000,
  })
  return status?.is_open ?? false
}

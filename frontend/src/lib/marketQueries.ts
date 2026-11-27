/**
 * Shared React Query definitions for app-wide polled market endpoints.
 *
 * React Query resets every observer's refetch timer whenever the shared query
 * updates, so the effective poll rate of a key is the SMALLEST interval any
 * mounted observer asks for. A single component polling movers every 45s
 * while the ticker asks for 60s means 45s for everyone. Every observer of
 * these keys therefore goes through the hooks below, which use one
 * market-phase-aware interval with 429 backoff (lib/queryPolicy).
 */
import { useQuery } from '@tanstack/react-query'
import {
  fetchMarketIndices,
  fetchMarketMovers,
  fetchSectorPerformance,
  type MarketIndex,
  type MarketMovers,
  type SectorPerformance,
} from './api'
import { fetchLiveVisitors, type LiveVisitorsData } from './monitor-extended-api'
import { backoffInterval, MARKET_WIDGET_POLL, SECTOR_POLL } from './queryPolicy'
import { usePhaseInterval } from '@/hooks/useMarketRefresh'

export const marketKeys = {
  indices: ['marketIndices'] as const,
  movers: ['marketMovers'] as const,
  sectors: ['sectorPerformance'] as const,
  liveVisitors: ['live-visitors'] as const,
}

export function useMarketIndices() {
  const base = usePhaseInterval(MARKET_WIDGET_POLL)
  return useQuery<MarketIndex[]>({
    queryKey: marketKeys.indices,
    queryFn: () => fetchMarketIndices(),
    staleTime: base / 2,
    refetchInterval: backoffInterval(base),
  })
}

export function useMarketMovers(opts: { enabled?: boolean } = {}) {
  const base = usePhaseInterval(MARKET_WIDGET_POLL)
  return useQuery<MarketMovers>({
    queryKey: marketKeys.movers,
    queryFn: () => fetchMarketMovers(),
    staleTime: base / 2,
    refetchInterval: backoffInterval(base),
    enabled: opts.enabled ?? true,
  })
}

export function useSectorPerformance() {
  const base = usePhaseInterval(SECTOR_POLL)
  return useQuery<SectorPerformance[]>({
    queryKey: marketKeys.sectors,
    queryFn: () => fetchSectorPerformance(),
    staleTime: base / 2,
    refetchInterval: backoffInterval(base),
  })
}

export function useLiveVisitors() {
  return useQuery<LiveVisitorsData>({
    queryKey: marketKeys.liveVisitors,
    queryFn: fetchLiveVisitors,
    staleTime: 55_000,
    refetchInterval: backoffInterval(60_000),
  })
}

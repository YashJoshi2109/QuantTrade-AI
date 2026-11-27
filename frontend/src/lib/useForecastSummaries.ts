'use client'

/**
 * React Query hook over GET /api/v1/forecasts/summary (cache-only on the
 * backend). Pending tickers are computed in the background server-side, so the
 * hook polls every 30 s while any are pending, for at most ~5 minutes.
 */
import { useMemo, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchForecastSummaries, normalizeTickers, type ForecastSummary, type SummaryItem } from './forecastSummary'

const POLL_MS = 30_000
const MAX_POLLS = 10

export function useForecastSummaries(tickers: readonly (string | null | undefined)[], opts: { enabled?: boolean; warm?: boolean } = {}) {
  const list = useMemo(() => normalizeTickers(tickers), [tickers])
  const key = list.join(',')
  const polls = useRef(0)
  const q = useQuery({
    queryKey: ['forecast-summaries', key, opts.warm !== false],
    queryFn: () => fetchForecastSummaries(list, { warm: opts.warm }),
    enabled: (opts.enabled ?? true) && list.length > 0,
    staleTime: 10 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false,
    refetchInterval: (query) => {
      const items = (query.state.data as { items?: SummaryItem[] } | undefined)?.items ?? []
      const pending = opts.warm !== false && items.some((i) => i.status === 'pending')
      if (!pending || polls.current >= MAX_POLLS) return false
      polls.current += 1
      return POLL_MS
    },
  })
  const byTicker = useMemo(() => {
    const m: Record<string, SummaryItem> = {}
    for (const it of q.data?.items ?? []) m[it.ticker] = it
    return m
  }, [q.data])
  const summaries = useMemo(() => {
    const m: Record<string, ForecastSummary | null> = {}
    for (const [t, it] of Object.entries(byTicker)) m[t] = it.summary
    return m
  }, [byTicker])
  return { ...q, byTicker, summaries, tickers: list }
}

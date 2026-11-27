'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchPrices, type Indicators, type PriceBar } from '@/lib/api'
import { macdHistory, type TechnicalInputs } from '@/lib/researchTechnicals'

/**
 * Inputs for the technical cards: /api/v1/indicators values plus the live
 * price (falls back to the indicator endpoint's current_price).
 */
export function technicalInputs(indicators: Indicators | null | undefined, livePrice: number | null | undefined): TechnicalInputs | null {
  const ind = indicators?.indicators
  if (!ind) return null
  const price = typeof livePrice === 'number' && livePrice > 0 ? livePrice : ind.current_price ?? null
  return {
    price,
    sma_20: ind.sma_20 ?? null,
    sma_50: ind.sma_50 ?? null,
    sma_200: ind.sma_200 ?? null,
    rsi: ind.rsi ?? null,
    macd: ind.macd ?? null,
    bollinger_bands: ind.bollinger_bands ?? null,
  }
}

export function useTechnicalInputs(indicators: Indicators | null | undefined, livePrice: number | null | undefined) {
  return useMemo(() => technicalInputs(indicators, livePrice), [indicators, livePrice])
}

/**
 * Daily bars (~1 year, /api/v1/prices) for the MACD mini chart. One React Query
 * key for desktop and mobile, so both trees share a single request.
 */
export function useMacdHistory(symbol: string, points = 60) {
  const { data: bars } = useQuery<PriceBar[]>({
    queryKey: ['research.dailyBars1y', symbol],
    queryFn: () => {
      const end = new Date()
      const start = new Date(end)
      start.setDate(start.getDate() - 370)
      return fetchPrices(symbol, start.toISOString(), end.toISOString(), 400)
    },
    staleTime: 10 * 60_000,
    retry: 1,
    enabled: !!symbol,
  })
  return useMemo(() => macdHistory(bars, points), [bars, points])
}

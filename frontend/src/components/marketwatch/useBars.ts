'use client'

import { useQuery } from '@tanstack/react-query'
import { fetchIntradayPrices, fetchPrices } from '@/lib/api'
import { INTRADAY_RANGES, isIntradayRange, rangeWindow, type RangeKey } from '@/lib/marketwatch'

/** Bars for a range (intraday route for 1D/1W, stored daily bars otherwise), unusable closes dropped. */
export function useBars(symbol: string | null, range: RangeKey, enabled = true) {
  return useQuery({
    queryKey: ['marketwatch', 'bars', symbol, range],
    queryFn: async () => {
      let bars
      if (isIntradayRange(range)) {
        const r = INTRADAY_RANGES[range]
        bars = await fetchIntradayPrices(symbol as string, r.interval, r.days)
      } else {
        const w = rangeWindow(range)
        bars = await fetchPrices(symbol as string, w.start, w.end, w.limit)
      }
      return bars.filter((b) => Number.isFinite(b.close) && b.close > 0)
    },
    enabled: !!symbol && enabled,
    staleTime: isIntradayRange(range) ? 60_000 : 10 * 60_000,
  })
}

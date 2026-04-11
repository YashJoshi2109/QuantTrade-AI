import { useQuery, keepPreviousData } from '@tanstack/react-query'
import type { Continent } from '@/lib/world-exchanges'
import type { ExchangeSector } from '@/app/api/exchange/heatmap/route'

export function useExchangeHeatmap(continent: Continent, exchangeId?: string | null) {
  return useQuery({
    queryKey: ['exchangeHeatmap', continent, exchangeId ?? ''],
    queryFn: async (): Promise<{ sectors: ExchangeSector[]; exchangeLabel: string }> => {
      if (continent === 'global') return { sectors: [], exchangeLabel: 'Global' }
      const url = exchangeId
        ? `/api/exchange/heatmap?exchange=${encodeURIComponent(exchangeId)}`
        : `/api/exchange/heatmap?continent=${encodeURIComponent(continent)}`
      const res = await fetch(url)
      if (!res.ok) return { sectors: [], exchangeLabel: continent }
      return res.json()
    },
    enabled: continent !== 'global',
    refetchInterval: 180_000,
    staleTime: 120_000,
    placeholderData: keepPreviousData,
  })
}

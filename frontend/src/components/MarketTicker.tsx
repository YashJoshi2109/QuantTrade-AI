'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { TrendingUp, TrendingDown } from 'lucide-react'
import {
  fetchMarketMovers,
  fetchMarketIndices,
  fetchSectorPerformance,
  StockPerformance,
} from '@/lib/api'
import { formatNumber, formatPercent, isNumber } from '@/lib/format'
import { useMarketRefreshInterval } from '@/hooks/useMarketRefresh'

interface TickerItem {
  symbol: string
  name: string
  price?: number
  change_percent?: number
  isIndex?: boolean
}

function TickerChip({ item }: { item: TickerItem }) {
  const hasData = isNumber(item.change_percent)
  const isUp = hasData && (item.change_percent ?? 0) >= 0
  const pctStr = hasData ? formatPercent(item.change_percent, 2) : ''

  const content = (
    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.06] hover:border-white/[0.1] transition-all cursor-pointer whitespace-nowrap group">
      <span className="flex flex-col items-start leading-tight">
        <span
          className={`text-[11px] font-bold ${item.isIndex ? 'text-cyan-400' : 'text-white'}`}
        >
          {item.symbol}
        </span>
        <span className="text-[9px] text-slate-500 max-w-[120px] truncate">
          {item.name}
        </span>
      </span>
      {isNumber(item.price) && (
        <span className="text-[10px] font-mono text-slate-400">
          ${formatNumber(item.price, 2)}
        </span>
      )}
      {hasData && (
        <span
          className={`inline-flex items-center gap-0.5 text-[10px] font-mono font-bold ${isUp ? 'text-emerald-400' : 'text-red-400'}`}
        >
          {isUp ? (
            <TrendingUp className="w-2.5 h-2.5" />
          ) : (
            <TrendingDown className="w-2.5 h-2.5" />
          )}
          {isUp ? '+' : ''}
          {pctStr}
        </span>
      )}
    </div>
  )

  if (item.isIndex) return content

  return (
    <Link href={`/research?symbol=${encodeURIComponent(item.symbol)}`}>{content}</Link>
  )
}

export default function MarketTicker() {
  const refreshInterval = useMarketRefreshInterval({
    liveInterval: 30_000,
    extendedInterval: 120_000,
    closedInterval: 300_000,
  })

  const { data: indices } = useQuery({
    queryKey: ['marketIndices'],
    queryFn: () => fetchMarketIndices(),
    refetchInterval: refreshInterval,
    staleTime: 15_000,
  })

  const { data: movers } = useQuery({
    queryKey: ['marketMovers'],
    queryFn: () => fetchMarketMovers(),
    refetchInterval: refreshInterval,
    staleTime: 15_000,
  })

  const { data: sectors } = useQuery({
    queryKey: ['sectorPerformance'],
    queryFn: () => fetchSectorPerformance(),
    refetchInterval: refreshInterval * 2,
    staleTime: 30_000,
  })

  const tickerItems = useMemo(() => {
    const items: TickerItem[] = []

    for (const idx of indices || []) {
      if (!idx?.symbol) continue
      items.push({
        symbol: idx.symbol,
        name: idx.name || idx.symbol,
        price: idx.price,
        change_percent: idx.change_percent,
        isIndex: true,
      })
    }

    const seen = new Set<string>()
    const allStocks: StockPerformance[] = [
      ...(movers?.gainers?.slice(0, 8) || []),
      ...(movers?.losers?.slice(0, 5) || []),
    ]

    for (const stock of allStocks) {
      if (seen.has(stock.symbol)) continue
      seen.add(stock.symbol)
      items.push({
        symbol: stock.symbol,
        name: stock.name || stock.symbol,
        price: stock.price,
        change_percent: stock.change_percent,
      })
    }

    if (sectors) {
      for (const sector of sectors.slice(0, 6)) {
        items.push({
          symbol: sector.sector,
          name: `Sector · ${sector.sector}`,
          change_percent: sector.change_percent,
          isIndex: true,
        })
      }
    }

    return items
  }, [movers, sectors, indices])

  if (tickerItems.length <= 4) return null

  const duplicated = [...tickerItems, ...tickerItems]

  return (
    <div className="w-full min-h-[2.75rem] py-1 bg-[#070a12]/80 backdrop-blur-xl border-b border-white/[0.04] overflow-hidden relative">
      <div className="absolute left-0 top-0 bottom-0 w-12 bg-gradient-to-r from-[#070a12] to-transparent z-10 pointer-events-none" />
      <div className="absolute right-0 top-0 bottom-0 w-12 bg-gradient-to-l from-[#070a12] to-transparent z-10 pointer-events-none" />

      <div className="flex items-center h-full animate-marquee hover:[animation-play-state:paused]">
        <div className="flex items-center gap-2 px-2">
          {duplicated.map((item, i) => (
            <TickerChip key={`${item.symbol}-${i}`} item={item} />
          ))}
        </div>
      </div>
    </div>
  )
}

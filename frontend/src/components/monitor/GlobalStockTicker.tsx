'use client'

import { useMemo } from 'react'
import Marquee from 'react-fast-marquee'
import Link from 'next/link'
import { TrendingUp, TrendingDown, Minus, BarChart2 } from 'lucide-react'
import { type GlobalEvent } from '@/lib/global-monitor-api'

interface TickerEntry {
  ticker: string
  impact: number
  direction: string
  count: number
  href?: string
}

interface Props {
  events: GlobalEvent[]
}

const SECTOR_TICKERS: Record<string, string[]> = {
  energy: ['XOM', 'CVX', 'COP', 'SLB', 'OXY'],
  technology: ['NVDA', 'AAPL', 'MSFT', 'GOOGL', 'META'],
  defense: ['LMT', 'RTX', 'NOC', 'GD', 'BA'],
  financials: ['JPM', 'BAC', 'GS', 'MS', 'WFC'],
  shipping: ['ZIM', 'MATX', 'STNG', 'FRO', 'GOGL'],
  commodities: ['GLD', 'SLV', 'USO', 'UNG', 'CORN'],
  cyber: ['CRWD', 'PANW', 'ZS', 'FTNT', 'S'],
  healthcare: ['UNH', 'JNJ', 'PFE', 'ABBV', 'MRK'],
  'emerging markets': ['EEM', 'VWO', 'EWZ', 'MCHI', 'EPI'],
  infrastructure: ['CAT', 'DE', 'VMC', 'MLM', 'URI'],
}

const CRITICAL_TICKERS: Record<string, { ticker: string; direction: string }[]> = {
  conflict: [
    { ticker: 'LMT', direction: 'positive' },
    { ticker: 'RTX', direction: 'positive' },
    { ticker: 'NOC', direction: 'positive' },
    { ticker: 'XOM', direction: 'positive' },
    { ticker: 'CVX', direction: 'positive' },
    { ticker: 'BA', direction: 'positive' },
  ],
  disaster: [
    { ticker: 'AIZ', direction: 'negative' },
    { ticker: 'ALL', direction: 'negative' },
    { ticker: 'TRV', direction: 'negative' },
    { ticker: 'CAT', direction: 'negative' },
  ],
  economic: [
    { ticker: 'JPM', direction: 'negative' },
    { ticker: 'GS', direction: 'negative' },
    { ticker: 'GLD', direction: 'positive' },
    { ticker: 'TLT', direction: 'positive' },
  ],
  cyber: [
    { ticker: 'CRWD', direction: 'positive' },
    { ticker: 'PANW', direction: 'positive' },
    { ticker: 'ZS', direction: 'positive' },
    { ticker: 'FTNT', direction: 'positive' },
  ],
  shipping: [
    { ticker: 'ZIM', direction: 'negative' },
    { ticker: 'MATX', direction: 'negative' },
    { ticker: 'FDX', direction: 'negative' },
    { ticker: 'UPS', direction: 'negative' },
  ],
}

export default function GlobalStockTicker({ events }: Props) {
  const tickers = useMemo<TickerEntry[]>(() => {
    const map = new Map<string, TickerEntry>()

    events.forEach(event => {
      const baseImpact = event.market_impact_score || 20
      const weight =
        event.threat_level === 'critical' ? 3 :
        event.threat_level === 'high' ? 2 : 1

      // From correlated_sectors
      if (event.correlated_sectors) {
        event.correlated_sectors.forEach(sector => {
          const tickerList = SECTOR_TICKERS[sector.toLowerCase()] || []
          tickerList.forEach(t => {
            const existing = map.get(t)
            if (existing) {
              existing.impact = Math.max(existing.impact, baseImpact * weight)
              existing.count++
            } else {
              map.set(t, { ticker: t, impact: baseImpact * weight, direction: 'neutral', count: 1, href: `/research?symbol=${t}` })
            }
          })
        })
      }

      // From category-specific critical tickers
      const catTickers = CRITICAL_TICKERS[event.category] || []
      catTickers.forEach(({ ticker, direction }) => {
        const existing = map.get(ticker)
        if (existing) {
          existing.impact = Math.max(existing.impact, baseImpact * weight)
          existing.count++
          if (direction !== 'neutral') existing.direction = direction
        } else {
          map.set(ticker, { ticker, impact: baseImpact * weight, direction, count: weight, href: `/research?symbol=${ticker}` })
        }
      })
    })

    // Macro / FX / crypto watch always present in impact bar.
    const macroWatch: Array<{ ticker: string; direction: string; base: number }> = [
      { ticker: 'BTC', direction: 'positive', base: 45 },
      { ticker: 'XAUUSD', direction: 'positive', base: 42 },
      { ticker: 'DXY', direction: 'neutral', base: 38 },
      { ticker: 'EURUSD', direction: 'neutral', base: 33 },
      { ticker: 'USDJPY', direction: 'neutral', base: 33 },
      { ticker: 'GBPUSD', direction: 'neutral', base: 30 },
      { ticker: 'JPM', direction: 'negative', base: 35 },
      { ticker: 'GS', direction: 'negative', base: 35 },
    ]
    macroWatch.forEach((m) => {
      const existing = map.get(m.ticker)
      if (existing) {
        existing.impact = Math.max(existing.impact, m.base)
      } else {
        map.set(m.ticker, {
          ticker: m.ticker,
          impact: m.base,
          direction: m.direction,
          count: 1,
          href: m.ticker.includes('USD') || m.ticker === 'DXY' ? '/markets' : `/research?symbol=${m.ticker}`,
        })
      }
    })

    return Array.from(map.values())
      .sort((a, b) => b.impact - a.impact || b.count - a.count)
      .slice(0, 30)
  }, [events])

  if (tickers.length === 0) {
    return (
      <div className="flex items-center gap-2 px-4 py-2 bg-slate-950/80">
        <BarChart2 className="w-3 h-3 text-slate-600 shrink-0" />
        <span className="text-[10px] text-slate-600 font-mono">Loading impact signals...</span>
      </div>
    )
  }

  return (
    <div className="flex items-center bg-slate-950/90 border-b border-slate-800/50 overflow-hidden">
      {/* Label */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-r border-slate-800/60 bg-sky-500/10">
        <BarChart2 className="w-3 h-3 text-sky-400" />
        <span className="text-[9px] font-black uppercase tracking-[0.2em] text-sky-400 font-mono whitespace-nowrap">IMPACT WATCH</span>
      </div>

      {/* Scrolling tickers */}
      <div className="flex-1 overflow-hidden">
        <Marquee speed={35} gradient={false} pauseOnHover>
          <div className="flex items-center gap-6 pr-6 pl-4 py-1.5">
            {tickers.map((entry) => (
              <Link
                key={entry.ticker}
                href={entry.href || `/research?symbol=${entry.ticker}`}
                className="flex items-center gap-1.5 hover:opacity-80 transition-opacity group"
              >
                <span className="text-[11px] font-bold text-slate-100 font-mono group-hover:text-sky-400 transition-colors">
                  {entry.ticker}
                </span>
                <div className={`flex items-center gap-0.5 text-[9px] font-bold ${
                  entry.direction === 'positive' ? 'text-emerald-400' :
                  entry.direction === 'negative' ? 'text-red-400' :
                  'text-slate-400'
                }`}>
                  {entry.direction === 'positive' ? <TrendingUp className="w-2.5 h-2.5" /> :
                   entry.direction === 'negative' ? <TrendingDown className="w-2.5 h-2.5" /> :
                   <Minus className="w-2.5 h-2.5" />}
                </div>
                <span className={`text-[9px] font-mono ${
                  entry.impact >= 60 ? 'text-orange-400' :
                  entry.impact >= 30 ? 'text-yellow-400' :
                  'text-slate-500'
                }`}>
                  {Math.min(99, entry.impact).toFixed(0)}%
                </span>
                <span className="w-px h-3 bg-slate-800 ml-2" />
              </Link>
            ))}
          </div>
        </Marquee>
      </div>
    </div>
  )
}

import type { IndexQuote } from '@/app/api/quotes/indices/route'
import type { Continent } from '@/lib/world-exchanges'

export interface MoverRow {
  symbol: string
  name: string
  price: number
  change: number
  change_percent: number
  volume: number
  market_cap: number
  exchange: string
  currency: string
}

export type MarketTapeItem =
  | { kind: 'index'; q: IndexQuote }
  | { kind: 'stock'; role: 'gainer' | 'loser' | 'volume'; m: MoverRow }

function dedupeTape(items: MarketTapeItem[], max: number): MarketTapeItem[] {
  const seen = new Set<string>()
  const out: MarketTapeItem[] = []
  for (const it of items) {
    const sym = it.kind === 'index' ? it.q.symbol : it.m.symbol
    if (!sym || seen.has(sym)) continue
    seen.add(sym)
    out.push(it)
    if (out.length >= max) break
  }
  return out
}

/**
 * Indices + regional gainers / losers / most-active for the scrolling tape.
 */
export function buildMarketTape(params: {
  continent: Continent
  indices: IndexQuote[]
  gainers?: MoverRow[]
  losers?: MoverRow[]
  actives?: MoverRow[]
  maxItems?: number
}): MarketTapeItem[] {
  const { continent, indices, gainers = [], losers = [], actives = [], maxItems = 48 } = params

  const idx = indices.filter((q) => q.price > 0)
  const indexItems: MarketTapeItem[] = idx.map((q) => ({ kind: 'index' as const, q }))

  const stockCap = continent === 'global' ? 14 : 22
  const g = gainers.slice(0, Math.ceil(stockCap / 3)).map(
    (m): MarketTapeItem => ({ kind: 'stock', role: 'gainer', m })
  )
  const l = losers.slice(0, Math.ceil(stockCap / 3)).map(
    (m): MarketTapeItem => ({ kind: 'stock', role: 'loser', m })
  )
  const v = actives.slice(0, Math.ceil(stockCap / 3)).map(
    (m): MarketTapeItem => ({ kind: 'stock', role: 'volume', m })
  )

  const interleaved: MarketTapeItem[] = []
  const maxLoop = Math.max(g.length, l.length, v.length, 1)
  for (let i = 0; i < maxLoop; i++) {
    if (g[i]) interleaved.push(g[i])
    if (v[i]) interleaved.push(v[i])
    if (l[i]) interleaved.push(l[i])
  }

  const merged = dedupeTape([...indexItems, ...interleaved], maxItems)
  return merged
}

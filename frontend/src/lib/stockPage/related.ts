/**
 * Internal links for /stocks pages: sector peers from the curated universe,
 * plus the hub groupings. Server-only (imports the 700-row universe).
 */
import { ETF_UNIVERSE, STOCK_UNIVERSE, type UniverseEntry } from './universe'

const BY_SYMBOL = new Map<string, UniverseEntry>(
  [...STOCK_UNIVERSE, ...ETF_UNIVERSE].map((e) => [e.symbol, e]),
)

/** Tickers pre-rendered at build (most viewed; mirrors backend forecast WARM_TICKERS). */
export const PRERENDER_SYMBOLS = [
  'SPY', 'QQQ', 'IWM', 'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA',
  'AVGO', 'AMD', 'NFLX', 'PLTR', 'JPM', 'V', 'MA', 'BRK.B', 'LLY', 'UNH',
  'XOM', 'COST', 'WMT', 'ORCL', 'CRM', 'INTC', 'DIS', 'BA',
] as const

export function universeEntry(symbol: string): UniverseEntry | null {
  return BY_SYMBOL.get(symbol) ?? null
}

export function allUniverseSymbols(): string[] {
  return Array.from(BY_SYMBOL.keys())
}

/**
 * Up to `limit` peers in the same curated sector, in universe order (roughly by
 * market cap), excluding the ticker itself. ETFs get the other ETFs.
 */
export function sectorPeers(symbol: string, limit = 10): UniverseEntry[] {
  const me = BY_SYMBOL.get(symbol)
  if (!me) return []
  const pool = me.sector === 'ETF' ? ETF_UNIVERSE : STOCK_UNIVERSE.filter((e) => e.sector === me.sector)
  return pool.filter((e) => e.symbol !== symbol).slice(0, limit)
}

export function universeBySector(): Array<{ sector: string; entries: UniverseEntry[] }> {
  const groups = new Map<string, UniverseEntry[]>()
  for (const e of STOCK_UNIVERSE) {
    const list = groups.get(e.sector) ?? []
    list.push(e)
    groups.set(e.sector, list)
  }
  const out = Array.from(groups.entries()).map(([sector, entries]) => ({ sector, entries }))
  out.push({ sector: 'ETFs', entries: [...ETF_UNIVERSE] })
  return out
}

export const POPULAR_ETFS = ['SPY', 'QQQ', 'VOO', 'IWM', 'DIA'] as const

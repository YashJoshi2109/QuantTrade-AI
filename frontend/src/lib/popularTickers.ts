/** Popular US tickers for suggestions (404 page, unknown-ticker state, empty search). */
export interface PopularTicker {
  symbol: string
  name: string
}

export const POPULAR_TICKERS: readonly PopularTicker[] = [
  { symbol: 'AAPL', name: 'Apple' },
  { symbol: 'MSFT', name: 'Microsoft' },
  { symbol: 'NVDA', name: 'NVIDIA' },
  { symbol: 'AMZN', name: 'Amazon' },
  { symbol: 'META', name: 'Meta Platforms' },
  { symbol: 'GOOGL', name: 'Alphabet' },
  { symbol: 'TSLA', name: 'Tesla' },
  { symbol: 'SPY', name: 'SPDR S&P 500 ETF' },
] as const

/**
 * Popular tickers ordered by closeness to `query` (shared prefix first, then
 * shared letters), so a typo like "APPL" suggests AAPL first.
 */
export function suggestTickers(query: string, limit = 6): PopularTicker[] {
  const q = query.trim().toUpperCase()
  if (!q) return POPULAR_TICKERS.slice(0, limit)
  const score = (s: string) => {
    let prefix = 0
    while (prefix < Math.min(s.length, q.length) && s[prefix] === q[prefix]) prefix++
    const shared = new Set(q.split('').filter((c) => s.includes(c))).size
    return prefix * 10 + shared
  }
  return [...POPULAR_TICKERS]
    .filter((t) => t.symbol !== q)
    .sort((a, b) => score(b.symbol) - score(a.symbol))
    .slice(0, limit)
}

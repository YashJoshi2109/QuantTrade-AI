/**
 * Pure helpers for /api/quotes/indices (kept out of route.ts: Next.js route
 * modules may only export HTTP handlers / route config).
 */

/** Yahoo index / futures tickers → Finnhub ETF proxies, with the label the proxy must carry. */
export const FINNHUB_PROXY_ETFS: Record<string, { symbol: string; name: string }> = {
  '^GSPC': { symbol: 'SPY', name: 'S&P 500 ETF' },
  '^IXIC': { symbol: 'QQQ', name: 'Nasdaq-100 ETF' },
  '^NDX': { symbol: 'QQQ', name: 'Nasdaq-100 ETF' },
  '^DJI': { symbol: 'DIA', name: 'Dow Jones ETF' },
  '^RUT': { symbol: 'IWM', name: 'Russell 2000 ETF' },
  'GC=F': { symbol: 'GLD', name: 'Gold ETF' },
  'CL=F': { symbol: 'USO', name: 'Oil ETF' },
}

/** Symbols whose price is an index level in points (no currency prefix in the UI). */
export function isIndexLevelSymbol(symbol: string): boolean {
  return symbol.startsWith('^')
}

export interface IndexQuote {
  symbol: string
  name: string
  shortName: string
  exchangeId: string
  exchangeName: string
  country: string
  countryCode: string
  continent: string
  currency: string
  color: string
  price: number
  change: number
  change_percent: number
  prev_close: number
  day_high: number
  day_low: number
  volume: number
  market_state: string
  /** True when the price is an ETF proxy (symbol/name/shortName then describe the ETF). */
  is_proxy?: boolean
  /** The ETF ticker actually priced when `is_proxy` is true. */
  proxy_symbol?: string
  /** True when `price` is an index level in points, not a currency amount. */
  is_index_level?: boolean
}

export type RawQuote = {
  price: number
  change: number
  change_percent: number
  prev_close: number
  day_high: number
  day_low: number
  volume: number
  market_state: string
  /** Set by the Finnhub fallback when it priced an ETF proxy instead of the symbol. */
  proxy?: { symbol: string; name: string }
}

/** Build the response row. A proxy quote is relabelled as the ETF, never as the index. */
export function toIndexQuote(
  symbol: string,
  info: Omit<IndexQuote, keyof RawQuote | 'symbol' | 'is_proxy' | 'proxy_symbol' | 'is_index_level'>,
  quote: RawQuote,
): IndexQuote {
  const { proxy, ...raw } = quote
  if (proxy) {
    return {
      symbol,
      ...info,
      ...raw,
      name: `${proxy.symbol} (${proxy.name})`,
      shortName: proxy.symbol,
      currency: 'USD',
      is_proxy: true,
      proxy_symbol: proxy.symbol,
      is_index_level: false,
    }
  }
  return { symbol, ...info, ...raw, is_index_level: isIndexLevelSymbol(symbol) }
}

/** First quote with a positive price (a zero-price Yahoo row must not mask a fallback). */
export function pickQuote(...candidates: Array<RawQuote | null | undefined>): RawQuote | undefined {
  for (const q of candidates) if (q && q.price > 0) return q
  return undefined
}

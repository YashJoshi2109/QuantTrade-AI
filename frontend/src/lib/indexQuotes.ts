/**
 * Pure helpers for /api/quotes/indices (kept out of route.ts: Next.js route
 * modules may only export HTTP handlers / route config).
 */

import { ALL_INDEX_SYMBOLS } from '@/lib/world-exchanges'

/**
 * Futures tickers → Finnhub ETF proxies, with the label the proxy must carry.
 * Index symbols (^GSPC, ^IXIC, ^DJI …) are deliberately absent: an ETF price
 * (QQQ 610.55, DIA 492.56) must never stand in for an index level. When no
 * provider has the level, the route serves the last known level or "—".
 */
export const FINNHUB_PROXY_ETFS: Record<string, { symbol: string; name: string }> = {
  'GC=F': { symbol: 'GLD', name: 'Gold ETF' },
  'CL=F': { symbol: 'USO', name: 'Oil ETF' },
}

/** Proper names for benchmark symbols not listed under a WORLD_EXCHANGES venue. */
export const BENCHMARK_INDEX_LABELS: Record<string, { name: string; shortName: string }> = {
  '^RUT': { name: 'Russell 2000', shortName: 'RUT' },
  '^VIX': { name: 'CBOE Volatility Index (VIX)', shortName: 'VIX' },
}

// Indices quoted without a caret on Yahoo (000001.SS = SSE Composite, 000300.SS = CSI 300).
const INDEX_SYMBOL_SET = new Set<string>(ALL_INDEX_SYMBOLS.map((s) => s.toUpperCase()))

/**
 * Symbols whose price is an index level in points: no currency prefix and no FX
 * conversion in the UI. Covers caret symbols and every listed exchange index, so
 * SSE / CSI 300 are not converted from CNY into "$521.64".
 */
export function isIndexLevelSymbol(symbol: string): boolean {
  const s = (symbol ?? '').toUpperCase()
  return s.startsWith('^') || INDEX_SYMBOL_SET.has(s)
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
  /** True when every provider failed and this row is the last known level (see `as_of`). */
  is_stale?: boolean
  /** ISO time the stale level was last fetched live. */
  as_of?: string
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

// ─── Last known good index levels ───────────────────────────────────────────
// Module-level (per server instance). Served instead of any ETF substitute when
// every provider fails for an index symbol.
const LAST_GOOD = new Map<string, { quote: RawQuote; at: number }>()
export const LAST_GOOD_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000

export function rememberIndexLevel(symbol: string, quote: RawQuote, now = Date.now()): void {
  if (quote.proxy || !(quote.price > 0)) return
  LAST_GOOD.set(symbol, { quote, at: now })
}

export function lastKnownIndexLevel(
  symbol: string,
  now = Date.now(),
  maxAgeMs = LAST_GOOD_MAX_AGE_MS,
): { quote: RawQuote; asOf: string } | undefined {
  const hit = LAST_GOOD.get(symbol)
  if (!hit || now - hit.at > maxAgeMs) return undefined
  return { quote: hit.quote, asOf: new Date(hit.at).toISOString() }
}

/**
 * A fallback-provider level for an index is plausible when it is within ±40% of
 * the last known level (no history → accepted). Rejects e.g. QQQ 610 for ^IXIC 23,140.
 */
export function plausibleIndexFallback(q: RawQuote, last: RawQuote | undefined): boolean {
  if (!last || !(last.price > 0)) return true
  const ratio = q.price / last.price
  return ratio > 0.6 && ratio < 1.4
}

/** Test helper. */
export function clearLastKnownIndexLevels(): void {
  LAST_GOOD.clear()
}

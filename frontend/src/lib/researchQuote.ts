/**
 * Pure helpers that decide which price the research page shows.
 *
 * The page has three possible sources, in order of freshness:
 *   1. the realtime quote (backend /api/v1/enhanced/quote, Finnhub first)
 *   2. the ticker profile (/api/quotes/ticker, FMP or Yahoo)
 *   3. the last two daily bars loaded for the chart
 *
 * fetchQuote() returns a row of zeros when the backend fails, so a price of 0
 * means "no data", never a real quote. When no source has a positive price,
 * `price` is 0 and `hasPrice` is false: callers render a skeleton, not "$0.00".
 */

import { isNumber } from './format'

export interface RealtimeQuoteLike {
  price?: number | null
  change?: number | null
  change_percent?: number | null
  volume?: number | null
  high?: number | null
  low?: number | null
  data_source?: string
  latency_ms?: number
}

export interface TickerQuoteLike {
  price?: number | null
  change?: number | null
  change_percent?: number | null
  volume?: number | null
  day_high?: number | null
  day_low?: number | null
}

export interface BarLike {
  close: number
  volume?: number | null
}

export interface ResolvedPriceInfo {
  price: number
  change: number
  percent: number
  volume?: number
  high?: number | null
  low?: number | null
  dataSource?: string
  latency?: number
  hasPrice: boolean
}

const num = (v: unknown, fallback = 0): number => (isNumber(v) ? v : fallback)
const positive = (v: unknown): v is number => isNumber(v) && v > 0

export function resolvePriceInfo(
  realtime: RealtimeQuoteLike | null | undefined,
  ticker: TickerQuoteLike | null | undefined,
  bars: readonly BarLike[] | null | undefined,
): ResolvedPriceInfo {
  if (realtime && positive(realtime.price)) {
    return {
      price: realtime.price,
      change: num(realtime.change),
      percent: num(realtime.change_percent),
      volume: positive(realtime.volume) ? realtime.volume : positive(ticker?.volume) ? ticker!.volume! : undefined,
      high: realtime.high,
      low: realtime.low,
      dataSource: realtime.data_source,
      latency: realtime.latency_ms,
      hasPrice: true,
    }
  }

  if (ticker && positive(ticker.price)) {
    return {
      price: ticker.price,
      change: num(ticker.change),
      percent: num(ticker.change_percent),
      volume: positive(ticker.volume) ? ticker.volume : undefined,
      high: ticker.day_high,
      low: ticker.day_low,
      dataSource: 'profile',
      hasPrice: true,
    }
  }

  if (bars && bars.length >= 2) {
    const latest = bars[bars.length - 1]
    const previous = bars[bars.length - 2]
    if (positive(latest.close)) {
      const change = latest.close - num(previous.close)
      const percent = positive(previous.close) ? (change / previous.close) * 100 : 0
      return {
        price: latest.close,
        change,
        percent,
        volume: positive(latest.volume) ? latest.volume : undefined,
        dataSource: 'daily close',
        hasPrice: true,
      }
    }
  }

  return { price: 0, change: 0, percent: 0, hasPrice: false }
}

/**
 * First positive finite value wins. Desktop reads /api/quotes/ticker and mobile
 * used /api/v1/enhanced/fundamentals; both views now use ticker -> fundamentals
 * so Market Cap / P/E / 52W High render the same numbers.
 */
export function pickMetric(...values: Array<number | null | undefined>): number | undefined {
  for (const v of values) {
    if (isNumber(v) && v > 0) return v
  }
  return undefined
}

/**
 * Shared display rules for index / macro quote tiles (desktop + mobile).
 *
 * - An index level (^GSPC 7201.3) is points: no currency prefix, no FX conversion.
 * - An ETF proxy (SPY standing in for ^GSPC when only Finnhub answered) is a
 *   USD price and is labelled as the ETF, never as the index.
 */
import { formatNumber } from '@/lib/format'

export interface LevelLike {
  symbol: string
  is_proxy?: boolean
  proxy_symbol?: string
  is_index_level?: boolean
}

export function isIndexLevel(q: LevelLike): boolean {
  if (q.is_proxy) return false
  if (typeof q.is_index_level === 'boolean') return q.is_index_level
  return q.symbol.startsWith('^')
}

/** Ticker to show on the tile: the ETF actually priced when the row is a proxy. */
export function displaySymbol(q: LevelLike): string {
  return q.is_proxy && q.proxy_symbol ? q.proxy_symbol : q.symbol
}

/** "7,201" for an index level, "$718.78" for a priced instrument, "—" when missing. */
export function formatLevelOrPrice(
  value: number | null | undefined,
  isLevel: boolean,
  currSymbol = '$',
  decimals = 2,
): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return '—'
  if (isLevel) {
    return value.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })
  }
  return `${currSymbol}${formatNumber(value, decimals)}`
}

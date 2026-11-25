/**
 * Single source of truth for market breadth (up / down / flat).
 *
 * Used by the desktop summary cards, the desktop heatmap and the mobile markets
 * view so every counter on every screen agrees. Must match FLAT_THRESHOLD_PCT in
 * backend/app/services/market_breadth.py.
 */

/** A move within ±0.1% counts as flat (same band the heatmap colors neutral grey). */
export const FLAT_THRESHOLD_PCT = 0.1

export type ChangeDirection = 'up' | 'down' | 'flat'

export function classifyChange(changePercent: number | null | undefined): ChangeDirection {
  const pct = Number.isFinite(changePercent) ? (changePercent as number) : 0
  if (pct > FLAT_THRESHOLD_PCT) return 'up'
  if (pct < -FLAT_THRESHOLD_PCT) return 'down'
  return 'flat'
}

export interface MarketBreadth {
  total: number
  gainers: number
  losers: number
  flat: number
}

type StockLike = { change_percent?: number | null } | null | undefined
type SectorLike = { stocks?: StockLike[] | null } | null | undefined

export function computeBreadth(sectors: SectorLike[] | null | undefined): MarketBreadth {
  const out: MarketBreadth = { total: 0, gainers: 0, losers: 0, flat: 0 }
  for (const sector of sectors ?? []) {
    if (!sector || !Array.isArray(sector.stocks)) continue
    for (const stock of sector.stocks) {
      if (!stock) continue
      out.total++
      const dir = classifyChange(stock.change_percent)
      if (dir === 'up') out.gainers++
      else if (dir === 'down') out.losers++
      else out.flat++
    }
  }
  return out
}

/** Last trade older than this = delisted/halted ticker, not a real 0% day.
 *  Must match STALE_QUOTE_MAX_AGE in backend/app/services/market_breadth.py. */
export const STALE_QUOTE_MAX_AGE_MS = 5 * 24 * 60 * 60 * 1000

/** `tradeTimeSec` is a unix time in seconds (Yahoo regularMarketTime, FMP timestamp).
 *  Unknown trade time → not stale, so nothing disappears without evidence. */
export function isStaleTradeTime(tradeTimeSec: unknown, nowMs: number = Date.now()): boolean {
  const t = Number(tradeTimeSec)
  if (!Number.isFinite(t) || t <= 0) return false
  return nowMs - t * 1000 > STALE_QUOTE_MAX_AGE_MS
}

/**
 * AI Basket data coverage — shared by the desktop and mobile Ideas Lab views.
 *
 * The backend scores only stocks with enough data (quote, fundamentals, price
 * history). When part of the universe is skipped the basket is still built
 * ("partial"), and the snapshot carries `data_coverage` saying how much.
 */

export interface BasketCoverageReason {
  reason: string
  count: number
}

export interface BasketDataCoverage {
  universe_size: number
  scoreable: number
  scored: number
  partial: boolean
  top_reasons: BasketCoverageReason[]
  db_fundamentals?: number | null
  fallback_fundamentals?: number | null
  with_price_bars?: number | null
}

/** One-line note for a partial basket, or null when the whole universe scored. */
export function basketCoverageNote(coverage?: BasketDataCoverage | null): string | null {
  if (!coverage || !coverage.partial || !coverage.universe_size) return null
  const skipped = coverage.universe_size - coverage.scored
  if (skipped <= 0) return null
  const top = coverage.top_reasons?.[0]
  const why = top ? ` Most common gap: ${top.reason} (${top.count}).` : ''
  return `Partial basket: built from ${coverage.scored} of ${coverage.universe_size} stocks with enough data; ${skipped} skipped.${why}`
}

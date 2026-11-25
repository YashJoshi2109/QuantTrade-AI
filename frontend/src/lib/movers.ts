/**
 * Normalise mover rows from any provider (backend StockPerformance, Yahoo screener,
 * FMP, Twelve Data) into one shape so desktop and mobile movers cards render the
 * same fields. Rows without a symbol or a finite % change are dropped instead of
 * rendering as empty lines.
 */
export interface MoverDisplayRow {
  symbol: string
  name: string
  price: number | null
  change_percent: number
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[%,$\s]/g, ''))
  return Number.isFinite(n) ? n : null
}

export function normalizeMoverRows(rows: unknown): MoverDisplayRow[] {
  if (!Array.isArray(rows)) return []
  const out: MoverDisplayRow[] = []
  const seen = new Set<string>()
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const symbol = String(r.symbol ?? r.ticker ?? '').trim()
    if (!symbol || seen.has(symbol)) continue
    const pct = num(
      r.change_percent ?? r.changePercent ?? r.changesPercentage ?? r.regularMarketChangePercent ?? r.percent_change,
    )
    if (pct === null) continue
    const price = num(r.price ?? r.regularMarketPrice ?? r.close)
    seen.add(symbol)
    out.push({
      symbol,
      name: String(r.name ?? r.companyName ?? r.longName ?? r.shortName ?? symbol),
      price: price !== null && price > 0 ? price : null,
      change_percent: pct,
    })
  }
  return out
}

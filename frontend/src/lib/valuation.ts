/**
 * Valuation helpers shared by Research (desktop + mobile), search dropdowns and
 * the /api/quotes/ticker route, so one metric has one value and one format.
 */

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** "$3.43T" / "$220.50B" / "$15.20M" / "—". One formatter for every market-cap display. */
export function formatMarketCap(value: unknown, fallback = '—'): string {
  if (!finite(value) || value <= 0) return fallback
  if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`
  return `$${Math.round(value).toLocaleString('en-US')}`
}

/** PEG is only meaningful for positive growth: ≤ 0 (e.g. SOFI −12.62) → null ("n/m"). */
export function meaningfulPeg(value: unknown): number | null {
  return finite(value) && value > 0 ? value : null
}

/**
 * Debt/equity as a plain ratio (0.84). Yahoo / FMP-derived values arrive in percent
 * (71.47 meaning 0.71x); pass `unit: 'percent'` for those.
 */
export function debtToEquityRatio(value: unknown, unit: 'ratio' | 'percent' = 'ratio'): number | null {
  if (!finite(value) || value < 0) return null
  return unit === 'percent' ? value / 100 : value
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/**
 * Parse an earnings date: ISO ("2026-01-29"), "Jan 29, 2026", or year-less "Nov 02"
 * / "Nov 02 AMC" (placed in the year that keeps it within ~6 months of `now`).
 */
export function parseEarningsDate(raw: unknown, now: Date = new Date()): Date | null {
  if (typeof raw !== 'string') return null
  const s = raw.trim()
  if (!s || s === '-') return null
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (iso) {
    const d = new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3]))
    return Number.isNaN(d.getTime()) ? null : d
  }
  const m = /^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?/.exec(s)
  if (!m) return null
  const month = MONTHS.indexOf(m[1].toLowerCase())
  if (month < 0) return null
  const day = +m[2]
  if (m[3]) return new Date(Date.UTC(+m[3], month, day))
  const year = now.getUTCFullYear()
  let d = new Date(Date.UTC(year, month, day))
  const halfYear = 183 * 86_400_000
  if (d.getTime() - now.getTime() > halfYear) d = new Date(Date.UTC(year - 1, month, day))
  else if (now.getTime() - d.getTime() > halfYear) d = new Date(Date.UTC(year + 1, month, day))
  return d
}

export type EarningsTiming =
  | { kind: 'upcoming'; date: Date; label: string; days: number }
  | { kind: 'reported'; date: Date; label: string; days: number }

/** Classify an earnings date relative to today; null when unparseable. */
export function earningsTiming(raw: unknown, now: Date = new Date()): EarningsTiming | null {
  const d = parseEarningsDate(raw, now)
  if (!d) return null
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const days = Math.round((d.getTime() - today) / 86_400_000)
  const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
  return days >= 0 ? { kind: 'upcoming', date: d, label, days } : { kind: 'reported', date: d, label, days: -days }
}

/** Backend /api/v1/enhanced/fundamentals fields used as the page's source of truth. */
export interface BackendFundamentals {
  market_cap?: number | null
  pe_ratio?: number | null
  forward_pe?: number | null
  peg_ratio?: number | null
  price_to_book?: number | null
  price_to_sales?: number | null
  debt_to_equity?: number | null
  roe?: number | null
  roa?: number | null
  profit_margin?: number | null
  operating_margin?: number | null
  gross_margin?: number | null
  beta?: number | null
  eps?: number | null
  dividend_yield?: number | null
  earnings_date?: string | null
}

/** TickerInfo fields that overlap with the backend fundamentals row. */
export interface OverlappingTickerFields {
  market_cap: number
  pe_ratio: number
  forward_pe: number
  peg_ratio: number
  price_to_book: number
  price_to_sales: number
  /** Plain ratio after reconciliation. */
  debt_to_equity: number
  return_on_equity: number
  return_on_assets: number
  profit_margins: number
  operating_margins: number
  gross_margins: number
  beta: number
  eps: number
  dividend_yield: number
  earnings_date: string
}

const OVERLAY: Array<[keyof OverlappingTickerFields, keyof BackendFundamentals]> = [
  ['market_cap', 'market_cap'],
  ['pe_ratio', 'pe_ratio'],
  ['forward_pe', 'forward_pe'],
  ['peg_ratio', 'peg_ratio'],
  ['price_to_book', 'price_to_book'],
  ['price_to_sales', 'price_to_sales'],
  ['debt_to_equity', 'debt_to_equity'],
  ['return_on_equity', 'roe'],
  ['return_on_assets', 'roa'],
  ['profit_margins', 'profit_margin'],
  ['operating_margins', 'operating_margin'],
  ['gross_margins', 'gross_margin'],
  ['beta', 'beta'],
  ['eps', 'eps'],
  ['dividend_yield', 'dividend_yield'],
]

/**
 * One source of truth per Research page: the backend fundamentals row (also what
 * Key Factors and the Fundamentals panel read) wins for every overlapping metric;
 * the ticker profile only fills gaps. Units are normalised on the way:
 * `debt_to_equity` becomes a ratio, a non-positive PEG becomes 0 (rendered "—"),
 * and a past earnings date is dropped (the ticker profile only shows upcoming).
 *
 * `info.debt_to_equity` is expected in percent (Yahoo / FMP ×100 convention).
 */
export function reconcileTickerFundamentals<T extends OverlappingTickerFields>(
  info: T,
  backend: BackendFundamentals | null | undefined,
  now: Date = new Date(),
): T {
  const out: T = { ...info, debt_to_equity: debtToEquityRatio(info.debt_to_equity, 'percent') ?? 0 }
  if (backend) {
    for (const [tk, bk] of OVERLAY) {
      const v = backend[bk]
      if (finite(v)) (out as Record<string, unknown>)[tk] = v
    }
  }
  out.peg_ratio = meaningfulPeg(out.peg_ratio) ?? 0
  const backendEarnings = backend?.earnings_date
  const candidate = earningsTiming(backendEarnings, now)?.kind === 'upcoming' ? backendEarnings! : out.earnings_date
  out.earnings_date = earningsTiming(candidate, now)?.kind === 'upcoming' ? candidate : ''
  return out
}

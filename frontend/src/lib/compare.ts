/**
 * /compare: 2–4 tickers side by side. Data loading, metric definitions and
 * best/worst ranking, shared by the desktop and mobile views.
 *
 * Everything comes from existing endpoints (no new data sources):
 *   quote         GET /api/v1/enhanced/quote/{s}         (fetchQuote)
 *   fundamentals  GET /api/v1/enhanced/fundamentals/{s}  (fetchFundamentals)
 *   finviz        GET /api/v1/finviz/{s}                 growth, analyst recommendation, target
 *   indicators    GET /api/v1/indicators/{s}             RSI(14), SMA50/200
 *   prices        GET /api/v1/prices/{s}                 daily closes for the chart
 *   forecast      GET /api/v1/forecast/{s}               20-day statistical forecast (experimental)
 *
 * Missing values stay null and render as "—"; they are never ranked.
 */
import { apiUrl, fetchFundamentals, fetchQuote, type FundamentalsData, type QuoteData } from '@/lib/api'
import { normalisePct } from '@/lib/lineChart'
import { debtToEquityRatio, formatMarketCap } from '@/lib/valuation'

export const MIN_COMPARE = 2
export const MAX_COMPARE = 4
const SYMBOL_RE = /^[A-Z0-9.\-^]{1,10}$/

/** Series colours for up to 4 tickers (readable on light and dark). */
export const COMPARE_COLORS = ['#6366f1', '#f59e0b', '#10b981', '#ec4899']

/** "aapl, msft,,AAPL,bad$" -> ["AAPL","MSFT"]; capped at MAX_COMPARE. */
export function parseSymbols(raw: string | null | undefined): string[] {
  const out: string[] = []
  for (const part of (raw || '').split(/[,\s]+/)) {
    const s = part.trim().toUpperCase()
    if (!s || !SYMBOL_RE.test(s) || out.includes(s)) continue
    out.push(s)
    if (out.length >= MAX_COMPARE) break
  }
  return out
}

export function compareHref(symbols: string[]): string {
  const list = parseSymbols(symbols.join(','))
  return list.length ? `/compare?symbols=${list.join(',')}` : '/compare'
}

// ── per-symbol data ─────────────────────────────────────────────────────────

export interface Indicators {
  rsi: number | null
  sma50: number | null
  sma200: number | null
  price: number | null
}

export interface ForecastSummary {
  h: number
  exp_return_pct: number | null
  prob_up: number | null
  reliability: string | null
}

export interface CompareSnapshot {
  symbol: string
  name: string | null
  sector: string | null
  quote: QuoteData | null
  fundamentals: FundamentalsData & Record<string, unknown>
  finviz: Record<string, string> | null
  indicators: Indicators | null
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

/** Finviz strings: "15.06%" -> 15.06, "348.52" -> 348.52, "-" -> null. */
export function parseFinvizNumber(raw: unknown): number | null {
  if (typeof raw !== 'string') return num(raw)
  const s = raw.trim().replace(/,/g, '').replace(/%$/, '')
  if (!s || s === '-') return null
  return num(s)
}

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(apiUrl(path).toString())
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

export async function loadSnapshot(symbol: string): Promise<CompareSnapshot> {
  const [quote, fundamentals, finviz, ind] = await Promise.all([
    fetchQuote(symbol).catch(() => null),
    fetchFundamentals(symbol),
    getJson<Record<string, string>>(`/api/v1/finviz/${encodeURIComponent(symbol)}`),
    getJson<{ indicators?: Record<string, unknown> }>(`/api/v1/indicators/${encodeURIComponent(symbol)}`),
  ])
  const i = ind?.indicators
  const f = fundamentals as FundamentalsData & Record<string, unknown>
  return {
    symbol,
    name: (f.company_name as string) || (finviz?.Company ?? null),
    sector: (f.sector as string) || null,
    quote: quote && num(quote.price) && quote.price > 0 ? quote : null,
    fundamentals: f,
    finviz: finviz && typeof finviz === 'object' && !('detail' in finviz) ? finviz : null,
    indicators: i
      ? { rsi: num(i.rsi), sma50: num(i.sma_50), sma200: num(i.sma_200), price: num(i.current_price) }
      : null,
  }
}

export async function loadForecast(symbol: string): Promise<ForecastSummary | null> {
  const d = await getJson<{ horizons?: { h: number; exp_return_pct?: number; prob_up?: number; reliability?: string }[] }>(
    `/api/v1/forecast/${encodeURIComponent(symbol)}`
  )
  const h = d?.horizons?.find((x) => x.h === 20) ?? d?.horizons?.[d.horizons.length - 1]
  if (!h) return null
  return { h: h.h, exp_return_pct: num(h.exp_return_pct), prob_up: num(h.prob_up), reliability: h.reliability ?? null }
}

/**
 * Forecast cell text, following lib/forecastHonesty rules: a horizon with no
 * backtest edge shows no direction and no P(up). Never ranked or coloured.
 */
export function forecastCell(f: ForecastSummary | null | undefined): { main: string; sub: string } {
  if (!f || f.exp_return_pct == null) return { main: '—', sub: '' }
  if (f.reliability === 'no_edge') return { main: 'No edge', sub: 'did not beat no-change in backtest' }
  const r = f.exp_return_pct
  const main = `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(r).toFixed(2)}%`
  const sub = f.prob_up != null ? `P(up) ${(f.prob_up * 100).toFixed(0)}%` : ''
  return { main, sub }
}

// ── performance chart ───────────────────────────────────────────────────────

export const PERF_RANGES = ['1M', '3M', '6M', 'YTD', '1Y'] as const
export type PerfRange = (typeof PERF_RANGES)[number]

export function rangeStartDate(r: PerfRange, now: Date = new Date()): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  if (r === 'YTD') return new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const months = r === '1M' ? 1 : r === '3M' ? 3 : r === '6M' ? 6 : 12
  d.setUTCMonth(d.getUTCMonth() - months)
  return d
}

export interface PriceRow {
  timestamp: string
  close: number
}

export async function loadCloses(symbol: string, start: Date): Promise<PriceRow[]> {
  const url = `/api/v1/prices/${encodeURIComponent(symbol)}?start=${start.toISOString()}&end=${new Date().toISOString()}&limit=400&auto_sync=true`
  const rows = await getJson<PriceRow[]>(url)
  return Array.isArray(rows) ? rows : []
}

/**
 * Align closes on one date axis (union of trading dates from `start`), rebase
 * every ticker to % change from the first day ALL tickers with prices have a
 * close (so lines start together and are comparable), forward-filling gaps.
 * A ticker with no prices at all is left out of the common start.
 */
export function alignNormalised(
  bySymbol: Record<string, PriceRow[]>,
  symbols: string[],
  start?: string
): { dates: string[]; values: Record<string, (number | null)[]>; commonStart: string | null } {
  const maps: Record<string, Map<string, number>> = {}
  const all = new Set<string>()
  for (const s of symbols) {
    const m = new Map<string, number>()
    for (const r of bySymbol[s] || []) {
      const day = String(r.timestamp).slice(0, 10)
      const c = num(r.close)
      if (!day || c == null || c <= 0) continue
      if (start && day < start) continue
      m.set(day, c)
      all.add(day)
    }
    maps[s] = m
  }
  const firsts = symbols
    .map((sym) => Array.from(maps[sym].keys()).sort()[0])
    .filter((d): d is string => !!d)
  const commonStart = firsts.length ? firsts.sort()[firsts.length - 1] : null
  const dates = Array.from(all).sort().filter((d) => !commonStart || d >= commonStart)
  const values: Record<string, (number | null)[]> = {}
  for (const s of symbols) {
    // Close on or before the common start seeds the forward fill.
    let last: number | null = null
    if (commonStart) {
      for (const d of Array.from(maps[s].keys()).sort()) {
        if (d > commonStart) break
        last = maps[s].get(d) ?? last
      }
    }
    const raw = dates.map((d) => {
      const v = maps[s].get(d)
      if (v != null) last = v
      return last
    })
    values[s] = normalisePct(raw)
  }
  return { dates, values, commonStart }
}

// ── metric rows ─────────────────────────────────────────────────────────────

export type Better = 'higher' | 'lower' | null

export interface MetricDef {
  key: string
  label: string
  group: 'Price' | 'Valuation' | 'Profitability & growth' | 'Balance sheet & income' | 'Technicals' | 'Analysts'
  better: Better
  hint?: string
  value: (s: CompareSnapshot) => number | null
  format: (v: number | null) => string
}

const pct = (v: number | null, signed = false) =>
  v == null || !Number.isFinite(v) ? '—' : `${signed && v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}%`
const ratio = (v: number | null, suffix = '') => (v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(2)}${suffix}`)
const money = (v: number | null) =>
  v == null || !Number.isFinite(v) ? '—' : `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** A P/E or P/S at or below zero is not a valuation ("n/m"): null, never ranked. */
/** Exactly 0 from the provider means "not reported" (e.g. banks' gross margin). */
const nonZero = (v: number | null) => (v != null && v !== 0 ? v : null)

const positive = (v: number | null) => (v != null && v > 0 ? v : null)

function pctVs(price: number | null | undefined, ref: number | null | undefined): number | null {
  if (price == null || ref == null || !(price > 0) || !(ref > 0)) return null
  return (price / ref - 1) * 100
}

function lastPrice(s: CompareSnapshot): number | null {
  return s.quote?.price ?? s.indicators?.price ?? null
}

/** Analyst consensus on the 1 (strong buy) – 5 (strong sell) scale. */
export function recommendationScore(s: CompareSnapshot): number | null {
  return parseFinvizNumber(s.finviz?.Recom) ?? num(s.fundamentals.recommendation)
}

export function recommendationLabel(v: number | null): string {
  if (v == null) return '—'
  const label = v <= 1.5 ? 'Strong buy' : v <= 2.5 ? 'Buy' : v <= 3.5 ? 'Hold' : v <= 4.5 ? 'Sell' : 'Strong sell'
  return `${label} (${v.toFixed(1)})`
}

function targetPrice(s: CompareSnapshot): number | null {
  return positive(num(s.fundamentals.target_price) ?? parseFinvizNumber(s.finviz?.['Target Price']))
}

export const METRICS: MetricDef[] = [
  { key: 'price', label: 'Price', group: 'Price', better: null, value: lastPrice, format: money },
  { key: 'day', label: 'Today', group: 'Price', better: 'higher', value: (s) => num(s.quote?.change_percent), format: (v) => pct(v, true) },
  { key: 'mcap', label: 'Market cap', group: 'Valuation', better: null, value: (s) => positive(num(s.fundamentals.market_cap)), format: (v) => formatMarketCap(v) },
  { key: 'pe', label: 'P/E (ttm)', group: 'Valuation', better: 'lower', hint: 'Lower is cheaper; negative earnings are not ranked', value: (s) => positive(num(s.fundamentals.pe_ratio)), format: (v) => ratio(v, 'x') },
  { key: 'fpe', label: 'Forward P/E', group: 'Valuation', better: 'lower', value: (s) => positive(num(s.fundamentals.forward_pe)), format: (v) => ratio(v, 'x') },
  { key: 'ps', label: 'P/S', group: 'Valuation', better: 'lower', value: (s) => positive(num(s.fundamentals.price_to_sales)), format: (v) => ratio(v, 'x') },
  { key: 'gm', label: 'Gross margin', group: 'Profitability & growth', better: 'higher', hint: 'Banks and insurers report no gross margin', value: (s) => nonZero(num(s.fundamentals.gross_margin)), format: (v) => pct(v) },
  { key: 'om', label: 'Operating margin', group: 'Profitability & growth', better: 'higher', value: (s) => num(s.fundamentals.operating_margin), format: (v) => pct(v) },
  { key: 'nm', label: 'Net margin', group: 'Profitability & growth', better: 'higher', value: (s) => num(s.fundamentals.profit_margin), format: (v) => pct(v) },
  { key: 'rev_g', label: 'Revenue growth (y/y)', group: 'Profitability & growth', better: 'higher', value: (s) => parseFinvizNumber(s.finviz?.['Sales Y/Y TTM']), format: (v) => pct(v, true) },
  { key: 'eps_g', label: 'EPS growth (y/y)', group: 'Profitability & growth', better: 'higher', value: (s) => parseFinvizNumber(s.finviz?.['EPS Y/Y TTM']), format: (v) => pct(v, true) },
  { key: 'roe', label: 'ROE', group: 'Profitability & growth', better: 'higher', value: (s) => num(s.fundamentals.roe), format: (v) => pct(v) },
  { key: 'de', label: 'Debt / equity', group: 'Balance sheet & income', better: 'lower', value: (s) => debtToEquityRatio(s.fundamentals.debt_to_equity), format: (v) => ratio(v, 'x') },
  { key: 'dy', label: 'Dividend yield', group: 'Balance sheet & income', better: 'higher', value: (s) => num(s.fundamentals.dividend_yield), format: (v) => pct(v) },
  { key: 'rsi', label: 'RSI (14)', group: 'Technicals', better: null, hint: 'Above 70 overbought, below 30 oversold', value: (s) => s.indicators?.rsi ?? null, format: (v) => (v == null ? '—' : v.toFixed(1)) },
  { key: 'sma50', label: 'vs 50-day SMA', group: 'Technicals', better: 'higher', value: (s) => pctVs(lastPrice(s), s.indicators?.sma50), format: (v) => pct(v, true) },
  { key: 'sma200', label: 'vs 200-day SMA', group: 'Technicals', better: 'higher', value: (s) => pctVs(lastPrice(s), s.indicators?.sma200), format: (v) => pct(v, true) },
  { key: 'rec', label: 'Analyst consensus', group: 'Analysts', better: 'lower', hint: '1 = strong buy, 5 = strong sell', value: recommendationScore, format: recommendationLabel },
  { key: 'target', label: 'Mean price target', group: 'Analysts', better: null, value: targetPrice, format: money },
  { key: 'upside', label: 'Upside to target', group: 'Analysts', better: 'higher', value: (s) => pctVs(targetPrice(s), lastPrice(s)), format: (v) => pct(v, true) },
]

export const METRIC_GROUPS = Array.from(new Set(METRICS.map((m) => m.group)))

/** Index of the best and worst value. Needs at least 2 values and a spread; ties are not highlighted. */
export function rankRow(values: (number | null)[], better: Better): { best: number | null; worst: number | null } {
  if (!better) return { best: null, worst: null }
  const present = values
    .map((v, i) => ({ v, i }))
    .filter((x): x is { v: number; i: number } => x.v != null && Number.isFinite(x.v))
  if (present.length < 2) return { best: null, worst: null }
  const sorted = [...present].sort((a, b) => (better === 'higher' ? b.v - a.v : a.v - b.v))
  const top = sorted[0]
  const bottom = sorted[sorted.length - 1]
  if (Math.abs(top.v - bottom.v) < 1e-9) return { best: null, worst: null }
  const best = sorted.filter((x) => x.v === top.v).length === 1 ? top.i : null
  const worst = sorted.filter((x) => x.v === bottom.v).length === 1 ? bottom.i : null
  return { best, worst }
}

export interface CompareRow {
  def: MetricDef
  values: (number | null)[]
  display: string[]
  best: number | null
  worst: number | null
}

export function buildRows(snaps: (CompareSnapshot | null)[]): CompareRow[] {
  return METRICS.map((def) => {
    const values = snaps.map((s) => (s ? def.value(s) : null))
    const { best, worst } = rankRow(values, def.better)
    return { def, values, display: values.map((v) => def.format(v)), best, worst }
  })
}

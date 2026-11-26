/**
 * Stock screener client + shared helpers (ScreenerDesktop and ScreenerMobile both use these).
 * Backend: GET /api/v1/screener and /api/v1/screener/meta (backend/app/api/screener.py).
 *
 * The URL is the source of truth for a screen: parseScreenerParams() reads it and
 * toSearchParams() writes it back, so every screen is shareable. Bounds, keys and
 * sort fields mirror backend/app/services/screener_service.py (the server re-validates).
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query'

const API_URL = process.env.NEXT_PUBLIC_API_URL || ''

export const PAGE_SIZE = 50
export const MAX_PAGE = 200 // backend caps offset at 10,000

export type RangeKey =
  | 'mcap' | 'price' | 'pe' | 'ps' | 'div_yield' | 'rev_growth'
  | 'margin' | 'roe' | 'de' | 'rsi' | 'chg1d' | 'chg1m'

export interface RangeSpec {
  key: RangeKey
  label: string
  unit: '$B' | '$' | '%' | 'x' | ''
  min: number
  max: number
  step: string
  group: 'Valuation' | 'Fundamentals' | 'Technicals'
  hint?: string
}

export const RANGE_FILTERS: RangeSpec[] = [
  { key: 'mcap', label: 'Market cap', unit: '$B', min: 0, max: 100_000, step: '1', group: 'Valuation', hint: 'In billions of USD' },
  { key: 'pe', label: 'P/E', unit: 'x', min: 0, max: 1000, step: '1', group: 'Valuation', hint: 'Trailing. Loss-making companies have no P/E' },
  { key: 'ps', label: 'P/S', unit: 'x', min: 0, max: 1000, step: '0.5', group: 'Valuation' },
  { key: 'div_yield', label: 'Dividend yield', unit: '%', min: 0, max: 30, step: '0.5', group: 'Valuation' },
  { key: 'price', label: 'Price', unit: '$', min: 0, max: 1_000_000, step: '1', group: 'Valuation' },
  { key: 'rev_growth', label: 'Revenue growth YoY', unit: '%', min: -100, max: 1000, step: '5', group: 'Fundamentals', hint: 'Latest fiscal quarter vs the same quarter last year' },
  { key: 'margin', label: 'Profit margin', unit: '%', min: -1000, max: 100, step: '5', group: 'Fundamentals' },
  { key: 'roe', label: 'ROE', unit: '%', min: -1000, max: 1000, step: '5', group: 'Fundamentals' },
  { key: 'de', label: 'Debt / equity', unit: 'x', min: 0, max: 100, step: '0.1', group: 'Fundamentals' },
  { key: 'rsi', label: 'RSI (14)', unit: '', min: 0, max: 100, step: '1', group: 'Technicals', hint: '30 or lower is often read as oversold, 70+ as overbought' },
  { key: 'chg1d', label: '1D change', unit: '%', min: -100, max: 1000, step: '0.5', group: 'Technicals' },
  { key: 'chg1m', label: '1M change', unit: '%', min: -100, max: 5000, step: '1', group: 'Technicals' },
]
const RANGE_BY_KEY = Object.fromEntries(RANGE_FILTERS.map((f) => [f.key, f])) as Record<RangeKey, RangeSpec>

export type SmaKey = 'sma50' | 'sma200'
export type SmaDir = 'above' | 'below'
export const SMA_FILTERS: { key: SmaKey; label: string }[] = [
  { key: 'sma50', label: 'Price vs 50-day SMA' },
  { key: 'sma200', label: 'Price vs 200-day SMA' },
]

export const SORT_FIELDS = [
  'symbol', 'name', 'sector', 'price', 'change_1d', 'change_1m', 'market_cap', 'pe', 'ps', 'dividend_yield',
  'revenue_growth', 'profit_margin', 'roe', 'debt_to_equity', 'rsi', 'vs_sma50', 'vs_sma200',
] as const
export type SortField = (typeof SORT_FIELDS)[number]
export type SortOrder = 'asc' | 'desc'

export const PRESET_IDS = ['value', 'growth', 'dividend', 'quality', 'oversold', 'momentum'] as const
export type PresetId = (typeof PRESET_IDS)[number]

export interface ScreenerState {
  ranges: Partial<Record<RangeKey, { min?: number; max?: number }>>
  sectors: string[]
  sma: Partial<Record<SmaKey, SmaDir>>
  q?: string
  includeEtfs: boolean
  preset?: PresetId
  /** undefined: server default (the preset's sort, else market cap desc) */
  sort?: SortField
  order?: SortOrder
  page: number
}

export const EMPTY_STATE: ScreenerState = { ranges: {}, sectors: [], sma: {}, includeEtfs: false, page: 1 }

const SECTOR_RE = /^[A-Za-z0-9 &,.'/-]{1,100}$/
const Q_RE = /^[A-Za-z0-9 .&'-]{1,40}$/

function num(raw: string | null): number | undefined {
  if (raw == null || raw.trim() === '') return undefined
  const v = Number(raw)
  return Number.isFinite(v) ? v : undefined
}

/** Read a screen from the URL. Invalid or out-of-range values are dropped, never guessed. */
export function parseScreenerParams(input: URLSearchParams | string): ScreenerState {
  const p = typeof input === 'string' ? new URLSearchParams(input) : input
  const s: ScreenerState = { ranges: {}, sectors: [], sma: {}, includeEtfs: false, page: 1 }
  for (const f of RANGE_FILTERS) {
    let lo = num(p.get(`${f.key}_min`))
    let hi = num(p.get(`${f.key}_max`))
    if (lo != null && (lo < f.min || lo > f.max)) lo = undefined
    if (hi != null && (hi < f.min || hi > f.max)) hi = undefined
    if (lo != null && hi != null && lo > hi) [lo, hi] = [hi, lo]
    if (lo != null || hi != null) s.ranges[f.key] = { ...(lo != null ? { min: lo } : {}), ...(hi != null ? { max: hi } : {}) }
  }
  const sectors = (p.get('sector') || '').split('|').map((x) => x.trim()).filter((x) => SECTOR_RE.test(x))
  s.sectors = Array.from(new Set(sectors)).sort().slice(0, 15)
  for (const { key } of SMA_FILTERS) {
    const v = p.get(key)
    if (v === 'above' || v === 'below') s.sma[key] = v
  }
  const q = (p.get('q') || '').trim()
  if (q && Q_RE.test(q)) s.q = q
  s.includeEtfs = p.get('include_etfs') === 'true' || p.get('include_etfs') === '1'
  const preset = p.get('preset')
  if (preset && (PRESET_IDS as readonly string[]).includes(preset)) s.preset = preset as PresetId
  const sort = p.get('sort')
  if (sort && (SORT_FIELDS as readonly string[]).includes(sort)) s.sort = sort as SortField
  const order = p.get('order')
  if (order === 'asc' || order === 'desc') s.order = order
  const page = Math.trunc(num(p.get('page')) ?? 1)
  s.page = page >= 1 && page <= MAX_PAGE ? page : 1
  return s
}

/** Canonical URL params for a screen (stable order, defaults omitted). */
export function toSearchParams(s: ScreenerState): URLSearchParams {
  const p = new URLSearchParams()
  if (s.preset) p.set('preset', s.preset)
  for (const f of RANGE_FILTERS) {
    const r = s.ranges[f.key]
    if (r?.min != null) p.set(`${f.key}_min`, String(r.min))
    if (r?.max != null) p.set(`${f.key}_max`, String(r.max))
  }
  if (s.sectors.length) p.set('sector', [...s.sectors].sort().join('|'))
  for (const { key } of SMA_FILTERS) if (s.sma[key]) p.set(key, s.sma[key] as string)
  if (s.q) p.set('q', s.q)
  if (s.includeEtfs) p.set('include_etfs', 'true')
  if (s.sort) p.set('sort', s.sort)
  if (s.order) p.set('order', s.order)
  if (s.page > 1) p.set('page', String(s.page))
  return p
}

/** Params for the API call: the URL params with page turned into limit/offset. */
export function toApiParams(s: ScreenerState): URLSearchParams {
  const p = toSearchParams(s)
  p.delete('page')
  p.set('limit', String(PAGE_SIZE))
  if (s.page > 1) p.set('offset', String((s.page - 1) * PAGE_SIZE))
  return p
}

export function setRange(s: ScreenerState, key: RangeKey, bound: 'min' | 'max', value: number | undefined): ScreenerState {
  const cur = { ...(s.ranges[key] || {}) }
  if (value == null || !Number.isFinite(value)) delete cur[bound]
  else cur[bound] = value
  const ranges = { ...s.ranges }
  if (cur.min == null && cur.max == null) delete ranges[key]
  else ranges[key] = cur
  return { ...s, ranges, page: 1 }
}

/** Header click: first click sorts by the column's natural direction, the next flips it. */
export function nextSort(s: ScreenerState, field: SortField, activeSort: SortField, activeOrder: SortOrder): ScreenerState {
  const textual = field === 'symbol' || field === 'name' || field === 'sector'
  const order: SortOrder = activeSort === field ? (activeOrder === 'asc' ? 'desc' : 'asc') : textual ? 'asc' : 'desc'
  return { ...s, sort: field, order, page: 1 }
}

export function applyPreset(id: PresetId | undefined): ScreenerState {
  return { ...EMPTY_STATE, preset: id }
}

export function activeFilterCount(s: ScreenerState): number {
  return Object.keys(s.ranges).length + (s.sectors.length ? 1 : 0) + Object.keys(s.sma).length + (s.q ? 1 : 0) + (s.includeEtfs ? 1 : 0)
}

export function validateRangeInput(key: RangeKey, raw: string): string | null {
  if (raw.trim() === '') return null
  const v = Number(raw)
  const f = RANGE_BY_KEY[key]
  if (!Number.isFinite(v)) return 'Enter a number'
  if (v < f.min || v > f.max) return `Between ${f.min.toLocaleString('en-US')} and ${f.max.toLocaleString('en-US')}`
  return null
}

export interface Chip { id: string; label: string }

function fmtBound(f: RangeSpec, v: number): string {
  if (f.unit === '$B') return v >= 1000 ? `$${(v / 1000).toLocaleString('en-US')}T` : `$${v.toLocaleString('en-US')}B`
  if (f.unit === '$') return `$${v.toLocaleString('en-US')}`
  if (f.unit === '%') return `${v}%`
  if (f.unit === 'x') return `${v}x`
  return String(v)
}

/** Human-readable active filters (explicit ones; preset filters are described by the preset). */
export function filterChips(s: ScreenerState): Chip[] {
  const out: Chip[] = []
  for (const f of RANGE_FILTERS) {
    const r = s.ranges[f.key]
    if (!r) continue
    const label =
      r.min != null && r.max != null ? `${f.label} ${fmtBound(f, r.min)}–${fmtBound(f, r.max)}`
        : r.min != null ? `${f.label} ≥ ${fmtBound(f, r.min)}`
          : `${f.label} ≤ ${fmtBound(f, r.max as number)}`
    out.push({ id: `range:${f.key}`, label })
  }
  if (s.sectors.length) out.push({ id: 'sector', label: s.sectors.length === 1 ? s.sectors[0] : `${s.sectors.length} sectors` })
  for (const { key } of SMA_FILTERS) {
    if (s.sma[key]) out.push({ id: `sma:${key}`, label: `${s.sma[key] === 'above' ? 'Above' : 'Below'} ${key === 'sma50' ? '50' : '200'}-day SMA` })
  }
  if (s.q) out.push({ id: 'q', label: `“${s.q}”` })
  if (s.includeEtfs) out.push({ id: 'etfs', label: 'Including ETFs' })
  return out
}

export function removeChip(s: ScreenerState, id: string): ScreenerState {
  const next: ScreenerState = { ...s, ranges: { ...s.ranges }, sma: { ...s.sma }, page: 1 }
  if (id.startsWith('range:')) delete next.ranges[id.slice(6) as RangeKey]
  else if (id.startsWith('sma:')) delete next.sma[id.slice(4) as SmaKey]
  else if (id === 'sector') next.sectors = []
  else if (id === 'q') next.q = undefined
  else if (id === 'etfs') next.includeEtfs = false
  return next
}

// ── formatting (null -> em dash, never 0) ────────────────────────────────────

export const DASH = '—'

export function fmtMarketCap(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return DASH
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`
  if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`
  return `$${v.toLocaleString('en-US')}`
}

export function fmtPrice(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return DASH
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function fmtPct(v: number | null | undefined, signed = false, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return DASH
  return `${signed && v > 0 ? '+' : ''}${v.toFixed(digits)}%`
}

export function fmtRatio(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return DASH
  return v.toFixed(digits)
}

export function toneClass(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v) || v === 0) return 'text-fg-secondary'
  return v > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
}

export function rsiClass(v: number | null | undefined): string {
  if (v == null) return 'text-fg-secondary'
  if (v <= 30) return 'text-emerald-600 dark:text-emerald-400'
  if (v >= 70) return 'text-red-600 dark:text-red-400'
  return 'text-fg-primary'
}

export const FLAG_TEXT: Record<string, string> = {
  negative_earnings: 'Loss-making: no P/E',
  negative_equity: 'Negative book equity: ROE and D/E not meaningful',
  roe_outlier: 'ROE outside ±1000%: hidden',
  pe_outlier: 'P/E above 1000: hidden',
  ps_outlier: 'P/S above 1000: hidden',
  dividend_yield_outlier: 'Dividend yield above 30%: hidden',
  revenue_growth_outlier: 'Revenue growth outside −100% to 1000%: hidden',
  margin_outlier: 'Profit margin outside −1000% to 100%: hidden',
  debt_to_equity_outlier: 'Debt/equity above 100: hidden',
  change_outlier: 'Price change looks wrong: hidden',
  market_cap_outlier: 'Market cap looks wrong: hidden',
}

// ── columns (desktop table headers; mobile uses the same labels and sort keys) ──

export type RowKey = keyof Pick<ScreenerRow,
  'price' | 'change_1d_pct' | 'change_1m_pct' | 'market_cap' | 'pe_ratio' | 'ps_ratio' | 'dividend_yield_pct' |
  'revenue_growth_yoy_pct' | 'profit_margin_pct' | 'roe_pct' | 'debt_to_equity' | 'rsi_14' |
  'price_vs_sma50_pct' | 'price_vs_sma200_pct'>

export interface MetricColumn { key: RowKey; sort: SortField; label: string; short: string; format: (r: ScreenerRow) => string; tone?: (r: ScreenerRow) => string; title?: string }

export const METRIC_COLUMNS: MetricColumn[] = [
  { key: 'price', sort: 'price', label: 'Price', short: 'Price', format: (r) => fmtPrice(r.price) },
  { key: 'change_1d_pct', sort: 'change_1d', label: '1D', short: '1D', format: (r) => fmtPct(r.change_1d_pct, true, 2), tone: (r) => toneClass(r.change_1d_pct) },
  { key: 'change_1m_pct', sort: 'change_1m', label: '1M', short: '1M', format: (r) => fmtPct(r.change_1m_pct, true), tone: (r) => toneClass(r.change_1m_pct) },
  { key: 'market_cap', sort: 'market_cap', label: 'Mkt cap', short: 'Mkt cap', format: (r) => fmtMarketCap(r.market_cap) },
  { key: 'pe_ratio', sort: 'pe', label: 'P/E', short: 'P/E', format: (r) => fmtRatio(r.pe_ratio) },
  { key: 'ps_ratio', sort: 'ps', label: 'P/S', short: 'P/S', format: (r) => fmtRatio(r.ps_ratio) },
  { key: 'dividend_yield_pct', sort: 'dividend_yield', label: 'Div yield', short: 'Yield', format: (r) => fmtPct(r.dividend_yield_pct, false, 2) },
  { key: 'revenue_growth_yoy_pct', sort: 'revenue_growth', label: 'Rev growth', short: 'Rev YoY', format: (r) => fmtPct(r.revenue_growth_yoy_pct, true), tone: (r) => toneClass(r.revenue_growth_yoy_pct), title: 'Revenue growth, latest fiscal quarter year over year' },
  { key: 'profit_margin_pct', sort: 'profit_margin', label: 'Margin', short: 'Margin', format: (r) => fmtPct(r.profit_margin_pct), title: 'Net profit margin' },
  { key: 'roe_pct', sort: 'roe', label: 'ROE', short: 'ROE', format: (r) => fmtPct(r.roe_pct), title: 'Return on equity' },
  { key: 'debt_to_equity', sort: 'debt_to_equity', label: 'D/E', short: 'D/E', format: (r) => fmtRatio(r.debt_to_equity, 2), title: 'Debt to equity' },
  { key: 'rsi_14', sort: 'rsi', label: 'RSI', short: 'RSI', format: (r) => fmtRatio(r.rsi_14, 0), tone: (r) => rsiClass(r.rsi_14), title: 'RSI(14), daily' },
  { key: 'price_vs_sma50_pct', sort: 'vs_sma50', label: 'vs 50D', short: 'vs 50D', format: (r) => fmtPct(r.price_vs_sma50_pct, true), tone: (r) => toneClass(r.price_vs_sma50_pct), title: 'Price vs 50-day simple moving average' },
  { key: 'price_vs_sma200_pct', sort: 'vs_sma200', label: 'vs 200D', short: 'vs 200D', format: (r) => fmtPct(r.price_vs_sma200_pct, true), tone: (r) => toneClass(r.price_vs_sma200_pct), title: 'Price vs 200-day simple moving average' },
]

export const SORT_LABELS: Record<SortField, string> = {
  symbol: 'Symbol', name: 'Name', sector: 'Sector', price: 'Price', change_1d: '1D change', change_1m: '1M change',
  market_cap: 'Market cap', pe: 'P/E', ps: 'P/S', dividend_yield: 'Dividend yield', revenue_growth: 'Revenue growth',
  profit_margin: 'Profit margin', roe: 'ROE', debt_to_equity: 'Debt / equity', rsi: 'RSI (14)',
  vs_sma50: 'vs 50-day SMA', vs_sma200: 'vs 200-day SMA',
}

// ── API ──────────────────────────────────────────────────────────────────────

export interface ScreenerRow {
  symbol: string
  name: string | null
  sector: string | null
  industry: string | null
  exchange: string | null
  asset_type: string | null
  price: number | null
  change_1d_pct: number | null
  change_1m_pct: number | null
  market_cap: number | null
  pe_ratio: number | null
  ps_ratio: number | null
  dividend_yield_pct: number | null
  revenue_growth_yoy_pct: number | null
  profit_margin_pct: number | null
  roe_pct: number | null
  debt_to_equity: number | null
  rsi_14: number | null
  sma_50: number | null
  sma_200: number | null
  price_vs_sma50_pct: number | null
  price_vs_sma200_pct: number | null
  flags: string[]
  price_as_of: string | null
}

export interface ScreenerResponse {
  results: ScreenerRow[]
  total: number
  limit: number
  offset: number
  sort: SortField
  order: SortOrder
  preset: PresetId | null
  filters: Record<string, unknown>
  universe: number
  as_of: string | null
  refreshing: boolean
}

export interface ScreenerPreset { id: PresetId; label: string; description: string; params: Record<string, string> }

export interface ScreenerMeta {
  presets: ScreenerPreset[]
  sectors: { name: string; count: number }[]
  universe: number
  as_of: string | null
}

export class ScreenerApiError extends Error {
  status: number
  constructor(m: string, s: number) {
    super(m)
    this.status = s
  }
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}/api/v1/screener${path}`, { credentials: 'include' })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const d = (data as { detail?: unknown })?.detail
    throw new ScreenerApiError(typeof d === 'string' ? d : `Screener request failed (${res.status})`, res.status)
  }
  return data as T
}

export const screenerApi = {
  run: (s: ScreenerState) => get<ScreenerResponse>(`?${toApiParams(s).toString()}`),
  meta: () => get<ScreenerMeta>('/meta'),
}

export function useScreener(s: ScreenerState) {
  const key = toApiParams(s).toString()
  return useQuery({
    queryKey: ['screener', key],
    queryFn: () => screenerApi.run(s),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    retry: (n, e) => !(e instanceof ScreenerApiError && e.status === 422) && n < 2,
  })
}

export function useScreenerMeta() {
  return useQuery({ queryKey: ['screener-meta'], queryFn: screenerApi.meta, staleTime: 5 * 60_000 })
}

/** Description of what a preset filters on, for the preset bar tooltip. */
export function describePreset(p: ScreenerPreset): string {
  const s = parseScreenerParams(new URLSearchParams(p.params))
  return filterChips(s).map((c) => c.label).join(', ')
}

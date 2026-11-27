'use client'

/**
 * Free / public datasets served by the backend (/api/v1/datasets/...):
 * SEC Form 4 insiders, SEC 13F institutional ownership, FINRA short interest,
 * US Treasury yield curve. Shared by desktop and mobile (Research tabs and the
 * Markets yield-curve card render the same components).
 *
 * Every payload has `status` (ok | not_loaded | disabled), `attribution`
 * ({ text: "Source: <agency>, as of <date>", url }) and, for per-ticker data
 * refreshed on demand, `syncing` — while true the hooks poll every 5 s.
 */
import { useQuery } from '@tanstack/react-query'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || ''

export interface Attribution {
  text: string
  agency: string
  dataset: string
  url: string
  as_of: string | null
  licence?: string
  terms_url?: string
}

interface Base {
  status: 'ok' | 'not_loaded' | 'disabled' | 'empty'
  syncing?: boolean
  refresh_error?: string | null
  reason?: string
  notes?: string[]
  attribution: Attribution
}

export interface InsiderSummary {
  days: number
  buy_transactions: number
  sell_transactions: number
  buy_value: number
  sell_value: number
  net_value: number
  net_shares: number
  distinct_buyers: number
  distinct_sellers: number
  sells_under_10b5_1_plan: number
}

export interface InsiderTx {
  date: string | null
  filed: string | null
  insider: string | null
  title: string | null
  relationship: string | null
  code: string | null
  type: string | null
  derivative: boolean
  security: string | null
  shares: number | null
  price: number | null
  value: number | null
  acquired_disposed: string | null
  shares_after: number | null
  plan_10b5_1: boolean | null
  url: string | null
}

export interface InsidersPayload extends Base {
  ticker: string
  summary: Record<string, InsiderSummary>
  transactions: InsiderTx[]
  latest_filing: string | null
}

export interface Holder {
  filer: string | null
  shares: number | null
  value_usd: number | null
  filed: string | null
  prev_shares: number | null
  change_shares: number | null
  change_pct: number | null
}

export interface OwnershipPayload extends Base {
  ticker: string
  period?: string
  holders?: number
  total_shares?: number
  total_value_usd?: number
  previous?: { period: string; holders: number; total_shares: number; total_value_usd: number } | null
  qoq?: { holders_change: number | null; shares_change_pct: number | null } | null
  top_holders?: Holder[]
  cusip?: string
}

export interface ShortPayload extends Base {
  symbol: string
  terms_url?: string
  short_interest?: {
    settlement_date: string
    shares_short: number | null
    previous_shares_short: number | null
    change_pct: number | null
    avg_daily_volume: number | null
    days_to_cover: number | null
  } | null
  history?: { settlement_date: string; shares_short: number | null; days_to_cover: number | null }[]
  short_volume?: {
    days: { date: string; short_volume: number; total_volume: number; short_ratio_pct: number | null }[]
    avg_short_ratio_pct: number | null
    latest_date: string | null
  }
}

export interface CurvePoint {
  tenor: string
  years: number
  yield_pct: number
}

export interface YieldCurvePayload extends Base {
  date?: string
  points: CurvePoint[]
  comparisons?: { label: string; date: string; points: CurvePoint[] }[]
  spreads?: { '10y_2y_bp'?: number; '10y_3m_bp'?: number }
  inverted_10y_3m?: boolean | null
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<T>
}

const poll = (q: { state: { data?: unknown } }) => ((q.state.data as Base | undefined)?.syncing ? 5_000 : false)

export function useInsiders(symbol: string, enabled = true) {
  return useQuery<InsidersPayload>({
    queryKey: ['public-data', 'insiders', symbol],
    queryFn: () => getJson(`/api/v1/datasets/insiders/${encodeURIComponent(symbol)}`),
    enabled: !!symbol && enabled,
    staleTime: 30 * 60_000,
    refetchInterval: poll,
    retry: 1,
  })
}

export function useInstitutional(symbol: string, enabled = true) {
  return useQuery<OwnershipPayload>({
    queryKey: ['public-data', 'institutional', symbol],
    queryFn: () => getJson(`/api/v1/datasets/institutional/${encodeURIComponent(symbol)}?top=10`),
    enabled: !!symbol && enabled,
    staleTime: 6 * 60 * 60_000,
    retry: 1,
  })
}

export function useShortInterest(symbol: string, enabled = true) {
  return useQuery<ShortPayload>({
    queryKey: ['public-data', 'short', symbol],
    queryFn: () => getJson(`/api/v1/datasets/short-interest/${encodeURIComponent(symbol)}`),
    enabled: !!symbol && enabled,
    staleTime: 60 * 60_000,
    refetchInterval: poll,
    retry: 1,
  })
}

export function useYieldCurve() {
  return useQuery<YieldCurvePayload>({
    queryKey: ['public-data', 'yield-curve'],
    queryFn: () => getJson('/api/v1/datasets/macro/yield-curve'),
    staleTime: 30 * 60_000,
    refetchInterval: poll,
    retry: 1,
  })
}

// ── formatting (shared desktop + mobile) ─────────────────────────────────

export function fmtCompact(v: number | null | undefined, prefix = ''): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  const a = Math.abs(v)
  const sign = v < 0 ? '-' : ''
  if (a >= 1e12) return `${sign}${prefix}${(a / 1e12).toFixed(2)}T`
  if (a >= 1e9) return `${sign}${prefix}${(a / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${sign}${prefix}${(a / 1e6).toFixed(2)}M`
  if (a >= 1e3) return `${sign}${prefix}${(a / 1e3).toFixed(1)}K`
  return `${sign}${prefix}${a.toFixed(a < 10 && a % 1 ? 2 : 0)}`
}

export function fmtSignedPct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  return `${v > 0 ? '+' : ''}${v.toFixed(digits)}%`
}

/** "Net selling $812.3M" / "Net buying $1.2M" / "No open-market trades". */
export function netActivityLabel(s: InsiderSummary | undefined): { label: string; tone: 'buy' | 'sell' | 'none' } {
  if (!s || (s.buy_transactions === 0 && s.sell_transactions === 0)) return { label: 'No open-market trades', tone: 'none' }
  if (s.net_value > 0) return { label: `Net buying ${fmtCompact(s.net_value, '$')}`, tone: 'buy' }
  if (s.net_value < 0) return { label: `Net selling ${fmtCompact(-s.net_value, '$')}`, tone: 'sell' }
  return { label: 'Balanced', tone: 'none' }
}

/** Short-interest as % of float is not published by FINRA: days to cover + short volume ratio instead. */
export function shortVolumeTone(ratio: number | null | undefined): 'high' | 'normal' | 'unknown' {
  if (ratio === null || ratio === undefined) return 'unknown'
  return ratio >= 55 ? 'high' : 'normal'
}

/**
 * Polyline points for a yield-curve chart in a w x h box. x = the tenor's rank
 * in `tenors` (the latest curve's maturities), so curves from other dates line
 * up by maturity; tenors missing from `tenors` are skipped.
 */
export function curvePath(points: CurvePoint[], tenors: string[], w: number, h: number, lo: number, hi: number): string {
  if (tenors.length < 2 || hi <= lo) return ''
  const n = tenors.length - 1
  return points
    .filter((p) => tenors.includes(p.tenor))
    .map((p) => {
      const x = (tenors.indexOf(p.tenor) / n) * w
      const y = h - ((p.yield_pct - lo) / (hi - lo)) * h
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

/**
 * Portfolio performance history + CSV trade import: API client and view helpers
 * shared by the desktop and mobile Portfolio views.
 *
 * Backend: GET  /api/v1/portfolios/{id}/history?range=
 *          POST /api/v1/portfolios/{id}/history/backfill
 *          POST /api/v1/portfolios/{id}/import/preview | /import/commit
 */
import { ApiError, errorText } from '@/lib/portfolio'
import type { ChartSeries } from '@/lib/lineChart'

const API_URL = process.env.NEXT_PUBLIC_API_URL || ''

export const HISTORY_RANGES = ['1M', '3M', 'YTD', '1Y', 'ALL'] as const
export type HistoryRange = (typeof HISTORY_RANGES)[number]

export const RANGE_LABEL: Record<HistoryRange, string> = {
  '1M': '1M',
  '3M': '3M',
  YTD: 'YTD',
  '1Y': '1Y',
  ALL: 'All',
}

export interface HistoryPoint {
  date: string
  value: number
  cost_basis: number | null
  cash: number | null
  net_flow: number
  return_percent: number | null
  benchmark_percent: number | null
  source: string | null
}

export interface HistoryStats {
  twr_percent: number | null
  max_drawdown_percent: number | null
  benchmark_return_percent: number | null
  start_value: number | null
  end_value: number | null
  start: string | null
  end: string | null
  days: number
}

export interface PortfolioHistory {
  portfolio_id: number
  kind: 'tracked' | 'paper'
  simulated: boolean
  range: HistoryRange
  benchmark: string
  benchmark_available: boolean
  points: HistoryPoint[]
  stats: HistoryStats
  missing_symbols: string[]
  rebuilt: boolean
  /** First trade (or paper account opening) date. */
  history_start: string | null
  /** First day stored closes can value the holdings; earlier trades are rolled into its starting value. */
  coverage_start: string | null
}

export interface ImportRow {
  row: number
  date: string | null
  symbol: string | null
  type: 'BUY' | 'SELL' | 'DIVIDEND' | null
  quantity: number | null
  price: number | null
  fees: number
  amount: number | null
  notes: string | null
  errors: string[]
  warnings: string[]
  status: 'ok' | 'error'
}

export interface ImportPreview {
  rows: ImportRow[]
  summary: {
    total: number
    valid: number
    errors: number
    warnings: number
    buys: number
    sells: number
    dividends: number
    symbols: string[]
  }
  ledger_error: string | null
  can_commit: boolean
}

/** A 400 from /import/commit carries the full preview in `detail`. */
export class ImportRejected extends Error {
  preview: ImportPreview | null
  constructor(message: string, preview: ImportPreview | null) {
    super(message)
    this.preview = preview
  }
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_URL}/api/v1/portfolios${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const detail = (data as { detail?: unknown }).detail
    if (detail && typeof detail === 'object' && !Array.isArray(detail) && 'rows' in (detail as object)) {
      const d = detail as ImportPreview & { message?: string }
      throw new ImportRejected(d.message || 'Import rejected', d)
    }
    throw new ApiError(errorText(data, res.status), res.status)
  }
  return data as T
}

export const historyApi = {
  get: async (id: number, range: HistoryRange): Promise<PortfolioHistory> => {
    const res = await fetch(`${API_URL}/api/v1/portfolios/${id}/history?range=${range}`, { credentials: 'include' })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new ApiError(errorText(data, res.status), res.status)
    return data as PortfolioHistory
  },
  backfill: (id: number) => post<{ days: number; start: string | null; end: string | null; missing_symbols: string[] }>(`/${id}/history/backfill`),
  importPreview: (id: number, csv: string) => post<ImportPreview>(`/${id}/import/preview`, { csv }),
  importCommit: (id: number, csv: string) => post<{ imported: number; summary: ImportPreview['summary'] }>(`/${id}/import/commit`, { csv }),
}

export const historyKeys = {
  all: (id: number) => ['portfolios', id, 'history'] as const,
  range: (id: number, r: HistoryRange) => ['portfolios', id, 'history', r] as const,
}

/** Chart series for the equity curve: portfolio TWR % and SPY % from the range start. */
export function historySeries(h: PortfolioHistory | undefined): { dates: string[]; series: ChartSeries[] } {
  if (!h || !h.points.length) return { dates: [], series: [] }
  const dates = h.points.map((p) => p.date)
  const series: ChartSeries[] = [
    {
      key: 'portfolio',
      label: h.simulated ? 'Portfolio (simulated)' : 'Portfolio',
      values: h.points.map((p) => p.return_percent),
      color: '#6366f1',
    },
  ]
  if (h.benchmark_available) {
    series.push({
      key: 'benchmark',
      label: h.benchmark,
      values: h.points.map((p) => p.benchmark_percent),
      color: '#94a3b8',
      dashed: true,
    })
  }
  return { dates, series }
}

/** True when stored closes start after the first trade, so the curve begins later. */
export function startsAfterFirstTrade(h: PortfolioHistory | undefined): boolean {
  return !!h?.history_start && !!h.coverage_start && h.coverage_start > h.history_start
}

/** Portfolio minus SPY over the range, in percentage points (null if either is missing). */
export function excessReturn(stats: HistoryStats | undefined): number | null {
  if (!stats || stats.twr_percent == null || stats.benchmark_return_percent == null) return null
  return stats.twr_percent - stats.benchmark_return_percent
}

export const IMPORT_TEMPLATE =
  'date,symbol,type,quantity,price,fees,amount,notes\n' +
  '2026-01-05,AAPL,BUY,10,185.20,0,,first buy\n' +
  '2026-02-10,AAPL,SELL,4,192.00,1.00,,\n' +
  '2026-02-15,AAPL,DIVIDEND,,,,2.40,quarterly dividend\n'

export const MAX_IMPORT_BYTES = 512 * 1024

/** Client-side guard before uploading a file (the server re-checks everything). */
export function checkImportFile(file: { name: string; size: number }): string | null {
  if (file.size > MAX_IMPORT_BYTES) return `File is larger than ${MAX_IMPORT_BYTES / 1024} KB`
  if (!/\.(csv|txt)$/i.test(file.name)) return 'Choose a .csv file'
  return null
}

/** One-line description of a preview row's trade for the review table. */
export function describeImportRow(r: ImportRow): string {
  if (r.type === 'DIVIDEND') return r.amount != null ? `Dividend $${r.amount.toFixed(2)}` : 'Dividend'
  if (r.type && r.quantity != null && r.price != null) {
    return `${r.type === 'BUY' ? 'Buy' : 'Sell'} ${r.quantity.toLocaleString('en-US', { maximumFractionDigits: 6 })} @ $${r.price.toLocaleString('en-US', { maximumFractionDigits: 4 })}`
  }
  return '—'
}

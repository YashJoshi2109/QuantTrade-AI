'use client'

/**
 * Research page state that persists between visits (per user): the last
 * symbol viewed and the chart setup (period, chart type, indicators, panes).
 * Shared by the desktop page and MobileResearch.
 */
import { useCallback, useEffect } from 'react'
import type { OverlayIndicatorId, PaneIndicatorId } from './indicators'
import { arrayOf, isBool, objectOf, oneOf, usePersistentState } from './persistentState'

export const DEFAULT_RESEARCH_SYMBOL = 'NVDA'

const SYMBOL_RE = /^[A-Z0-9.\-^=]{1,15}$/

export function normalizeSymbol(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const s = v.trim().toUpperCase()
  return SYMBOL_RE.test(s) ? s : undefined
}

/**
 * The symbol to show: the URL's `?symbol=` when present (and remembered),
 * else the last one this user viewed, else NVDA.
 */
export function useResearchSymbol(urlSymbol: string | null | undefined): string {
  const fromUrl = normalizeSymbol(urlSymbol)
  const [last, setLast] = usePersistentState<string>('research.symbol', DEFAULT_RESEARCH_SYMBOL, {
    version: 1, validate: normalizeSymbol,
  })
  useEffect(() => {
    if (fromUrl) setLast(fromUrl)
  }, [fromUrl, setLast])
  return fromUrl ?? last
}

// ── Desktop chart ───────────────────────────────────────────────────────

export const DESKTOP_PERIODS = ['1D', '5D', '1M', '3M', '6M', '1Y', '2Y', '5Y'] as const
export const SERIES_TYPES = ['candlestick', 'line', 'area', 'heikin-ashi', 'baseline'] as const
export const OVERLAY_IDS: readonly OverlayIndicatorId[] = ['sma20', 'sma50', 'sma200', 'ema12', 'ema26', 'ema50', 'vwap', 'bbands']
export const PANE_IDS: readonly PaneIndicatorId[] = ['rsi', 'macd', 'stochastic', 'atr', 'obv', 'williamsR', 'cci', 'volume']

export interface ChartPrefs {
  period: (typeof DESKTOP_PERIODS)[number]
  seriesType: (typeof SERIES_TYPES)[number]
  showMa: boolean
  showVolume: boolean
  logScale: boolean
  showGrid: boolean
  overlays: OverlayIndicatorId[]
  panes: PaneIndicatorId[]
  extendedHours: boolean
}

export const DEFAULT_CHART_PREFS: ChartPrefs = {
  period: '1Y', seriesType: 'candlestick', showMa: true, showVolume: false, logScale: false, showGrid: true,
  overlays: ['sma20', 'ema50'], panes: ['volume'], extendedHours: false,
}

export const parseChartPrefs = objectOf<ChartPrefs>(DEFAULT_CHART_PREFS, {
  period: oneOf(DESKTOP_PERIODS), seriesType: oneOf(SERIES_TYPES), showMa: isBool, showVolume: isBool,
  logScale: isBool, showGrid: isBool, overlays: arrayOf(OVERLAY_IDS), panes: arrayOf(PANE_IDS), extendedHours: isBool,
})

type SetState<V> = (v: V | ((prev: V) => V)) => void

/** Desktop chart settings with `useState`-style setters and a reset. */
export function useChartPrefs() {
  const [prefs, setPrefs, ctl] = usePersistentState<ChartPrefs>('research.chart', DEFAULT_CHART_PREFS, {
    version: 1, validate: parseChartPrefs,
  })
  const field = useCallback(
    <K extends keyof ChartPrefs>(k: K): SetState<ChartPrefs[K]> =>
      (v) => setPrefs((p) => ({ ...p, [k]: typeof v === 'function' ? (v as (x: ChartPrefs[K]) => ChartPrefs[K])(p[k]) : v })),
    [setPrefs],
  )
  return { prefs, field, reset: ctl.reset }
}

/** Range tabs on the desktop chart card (2Y stays reachable in Chart settings). */
export const DESKTOP_PERIOD_TABS = ['1D', '5D', '1M', '3M', '6M', '1Y', '5Y'] as const

// ── Section tabs (desktop and mobile share one remembered tab) ─────────

/**
 * Every research panel lives under exactly one tab:
 * overview     - Key factors, price forecast range, option chain, AI summary
 * fundamentals - Fundamentals + valuation, company profile, earnings / short interest
 * financials   - SEC EDGAR statements and filings
 * news         - Live news
 * ai           - AI analysis, technical gauges, Copilot handoff
 */
export const RESEARCH_TABS = ['overview', 'fundamentals', 'financials', 'ownership', 'news', 'ai'] as const
export type ResearchTab = (typeof RESEARCH_TABS)[number]
export const RESEARCH_TAB_LABELS: Record<ResearchTab, string> = {
  overview: 'Overview',
  fundamentals: 'Fundamentals',
  financials: 'Financials',
  ownership: 'Ownership',
  news: 'News',
  ai: 'AI Insights',
}

export function useResearchTab() {
  return usePersistentState<ResearchTab>('research.tab', 'overview', { version: 1, validate: oneOf(RESEARCH_TABS) })
}

// ── Mobile ──────────────────────────────────────────────────────────────

export const MOBILE_TIMEFRAMES = ['1D', '5D', '1M', '3M', '6M', '1Y', 'ALL'] as const
export type MobileTimeframe = (typeof MOBILE_TIMEFRAMES)[number]
export const MOBILE_CHART_TYPES = ['area', 'candlestick'] as const
export type MobileChartType = (typeof MOBILE_CHART_TYPES)[number]

/** Start date for a mobile range ('ALL' = everything the backend has, capped at 30 years). */
export function mobileRangeStart(tf: MobileTimeframe, now = new Date()): Date {
  const d = new Date(now)
  const days: Record<MobileTimeframe, number> = { '1D': 2, '5D': 7, '1M': 31, '3M': 92, '6M': 183, '1Y': 366, ALL: 365 * 30 }
  d.setDate(d.getDate() - days[tf])
  return d
}

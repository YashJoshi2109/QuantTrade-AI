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

// ── Mobile ──────────────────────────────────────────────────────────────

export const MOBILE_TIMEFRAMES = ['1D', '1W', '1M', '3M', '6M', 'YTD', '1Y', '2Y'] as const
export const MOBILE_TABS = ['overview', 'financials', 'options', 'technicals', 'company'] as const

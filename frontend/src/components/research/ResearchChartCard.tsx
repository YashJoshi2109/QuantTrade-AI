'use client'

import { useEffect, useRef, useState } from 'react'
import { Activity, AlertTriangle, Maximize2, Settings2 } from 'lucide-react'
import Chart, { type ChartSeriesType } from '@/components/Chart'
import { SkeletonChart } from '@/components/Skeleton'
import { QuoteActivityFlash } from '@/components/QuoteActivityFlash'
import type { PriceBar } from '@/lib/api'
import type { OverlayIndicatorId, PaneIndicatorId } from '@/lib/indicators'
import { DESKTOP_PERIOD_TABS } from '@/lib/researchPrefs'
import { cn } from '@/lib/utils'
import IndicatorToolbar from './IndicatorToolbar'
import { AnchoredPopover, ChartSettingsPanel, type ChartSettingsProps, type ResearchChartPeriod } from './ResearchChartHeader'

const iconBtn = (active = false) =>
  cn(
    'inline-flex h-8 w-8 items-center justify-center rounded-lg border transition-colors disabled:opacity-40',
    active ? 'border-blue-500/40 bg-blue-500/10 text-blue-600 dark:text-blue-400' : 'border-line-default text-fg-muted hover:text-fg-primary',
  )

export interface ResearchChartCardProps extends Omit<ChartSettingsProps, 'onClose'> {
  symbol: string
  currency?: string | null
  priceData: PriceBar[]
  loading: boolean
  error: string | null
  onSyncData: () => void
  activeOverlays: OverlayIndicatorId[]
  activePanes: PaneIndicatorId[]
  setActiveOverlays: (fn: (prev: OverlayIndicatorId[]) => OverlayIndicatorId[]) => void
  setActivePanes: (fn: (prev: PaneIndicatorId[]) => PaneIndicatorId[]) => void
  extendedHours: boolean
  onToggleExtendedHours: () => void
  exchangeTimezone?: string
  onFullscreen: () => void
  dataSource?: string
  latency?: number
  quoteLoading: boolean
  quoteActivityFingerprint: number
}

/** Desktop chart card: range tabs, indicator/settings/full-screen icons, the existing Chart. */
export function ResearchChartCard(p: ResearchChartCardProps) {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [showIndicators, setShowIndicators] = useState(true)
  const settingsBtn = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!settingsOpen) return
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Element | null
      if (t?.closest?.('[data-chart-settings-portal]')) return
      if (settingsBtn.current?.contains(e.target as Node)) return
      setSettingsOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSettingsOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [settingsOpen])

  const hasData = !p.loading && !p.error && p.priceData.length > 0
  const overlays = p.chartShowMa ? p.activeOverlays : p.activeOverlays.filter((id) => !['sma20', 'ema50'].includes(id))
  const panes = p.chartShowVolume ? p.activePanes : p.activePanes.filter((id) => id !== 'volume')

  return (
    <section className="rs-card overflow-hidden" data-testid="research-chart-card">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3">
        <div className="flex items-center gap-1" role="group" aria-label="Chart range">
          {DESKTOP_PERIOD_TABS.map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={p.chartPeriod === t}
              onClick={() => p.setChartPeriod(t as ResearchChartPeriod)}
              className={cn(
                'h-7 rounded-full px-3 text-[12px] font-semibold tabular-nums transition-colors',
                p.chartPeriod === t ? 'bg-blue-600 text-white dark:bg-blue-500' : 'text-fg-muted hover:text-fg-primary',
              )}
            >
              {t}
            </button>
          ))}
          {p.chartPeriod === '2Y' && (
            <span className="ml-1 h-7 rounded-full bg-blue-600 px-3 text-[12px] font-semibold leading-7 text-white dark:bg-blue-500">2Y</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setShowIndicators((v) => !v)}
            aria-pressed={showIndicators}
            aria-label="Indicators"
            title="Indicators"
            className={iconBtn(showIndicators)}
          >
            <Activity className="h-4 w-4" />
          </button>
          <button
            ref={settingsBtn}
            type="button"
            onClick={() => setSettingsOpen((o) => !o)}
            aria-expanded={settingsOpen}
            aria-haspopup="dialog"
            aria-label="Chart settings"
            title="Chart settings"
            className={iconBtn(settingsOpen)}
          >
            <Settings2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={p.onFullscreen}
            disabled={!hasData}
            aria-label="Full screen chart"
            title="Full screen"
            className={iconBtn()}
          >
            <Maximize2 className="h-4 w-4" />
          </button>
          {settingsOpen && (
            <AnchoredPopover anchor={settingsBtn.current}>
              <ChartSettingsPanel {...p} onClose={() => setSettingsOpen(false)} />
            </AnchoredPopover>
          )}
        </div>
      </div>

      <div className="flex items-baseline justify-between px-4 pb-2 pt-3">
        <h2 className="text-[14px] font-semibold text-fg-primary">{p.symbol} · Price chart</h2>
        <span className="text-[12px] text-fg-muted">{p.currency || 'USD'}</span>
      </div>

      {showIndicators && (
        <IndicatorToolbar
          activeOverlays={p.activeOverlays}
          activePanes={p.activePanes}
          onToggleOverlay={(id) => p.setActiveOverlays((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))}
          onTogglePane={(id) => p.setActivePanes((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))}
          extendedHours={p.extendedHours}
          onToggleExtendedHours={p.onToggleExtendedHours}
        />
      )}

      <div className="relative h-[440px]">
        {p.loading ? (
          <SkeletonChart height={440} />
        ) : p.error ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
            <AlertTriangle className="h-8 w-8 text-amber-500" aria-hidden />
            <p className="text-sm text-fg-muted">{p.error}</p>
            <button type="button" onClick={p.onSyncData} className="text-sm font-semibold text-blue-600 hover:underline dark:text-blue-400">
              Sync data
            </button>
          </div>
        ) : (
          <Chart
            data={p.priceData}
            symbol={p.symbol}
            seriesType={p.chartSeriesType as ChartSeriesType}
            activeOverlays={overlays}
            activePanes={panes}
            logScale={p.chartLogScale}
            showGrid={p.chartShowGrid}
            exchangeTimezone={p.exchangeTimezone}
          />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-line-subtle px-4 py-2 text-[11px] text-fg-muted" data-testid="chart-source">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-line-subtle px-2 py-0.5">
          <span className={cn('h-1.5 w-1.5 rounded-full', p.dataSource ? 'bg-emerald-500' : 'bg-slate-400')} aria-hidden />
          Quote: {p.dataSource || (p.quoteLoading ? 'connecting…' : 'unavailable')}
        </span>
        {typeof p.latency === 'number' && p.latency < 500 && <span className="tabular-nums">{p.latency} ms</span>}
        <span className="tabular-nums">
          {p.chartPeriod === '1D' ? '1-min bars' : p.chartPeriod === '5D' ? '5-min bars' : 'Daily bars'}
          {hasData ? ` · ${p.priceData.length.toLocaleString('en-US')}` : ''}
        </span>
        <span className="ml-auto inline-flex items-center gap-1.5">
          Activity <QuoteActivityFlash fingerprint={p.quoteActivityFingerprint} />
        </span>
      </div>
    </section>
  )
}

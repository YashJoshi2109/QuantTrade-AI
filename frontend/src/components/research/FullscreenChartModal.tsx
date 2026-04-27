'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Chart, { ChartSeriesType } from '@/components/Chart'
import { PriceBar } from '@/lib/api'
import {
  INDICATOR_REGISTRY,
  type OverlayIndicatorId,
  type PaneIndicatorId,
} from '@/lib/indicators'

interface FullscreenChartModalProps {
  isOpen: boolean
  onClose: () => void
  symbol: string
  priceData: PriceBar[]
  chartSeriesType: ChartSeriesType
  chartShowMa: boolean
  exchangeTimezone?: string
}

type TimePeriod = '1D' | '1W' | '1M' | '3M' | 'YTD' | '1Y' | '5Y' | 'MAX'

function filterByPeriod(data: PriceBar[], period: TimePeriod): PriceBar[] {
  if (!data.length || period === 'MAX') return data
  const now = new Date()
  let cutoff: Date
  switch (period) {
    case '1D': cutoff = new Date(now.getTime() - 1 * 86400000); break
    case '1W': cutoff = new Date(now.getTime() - 7 * 86400000); break
    case '1M': cutoff = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate()); break
    case '3M': cutoff = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate()); break
    case 'YTD': cutoff = new Date(now.getFullYear(), 0, 1); break
    case '1Y': cutoff = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()); break
    case '5Y': cutoff = new Date(now.getFullYear() - 5, now.getMonth(), now.getDate()); break
    default: return data
  }
  const cutoffStr = cutoff.toISOString().slice(0, 10)
  return data.filter((bar) => bar.timestamp >= cutoffStr)
}

const TIME_PERIODS: TimePeriod[] = ['1D', '1W', '1M', '3M', 'YTD', '1Y', '5Y', 'MAX']

const OVERLAY_INDICATORS = INDICATOR_REGISTRY.filter((i) => i.type === 'overlay')
const PANE_INDICATORS = INDICATOR_REGISTRY.filter((i) => i.type === 'pane')

export default function FullscreenChartModal({
  isOpen, onClose, symbol, priceData, chartSeriesType, chartShowMa, exchangeTimezone,
}: FullscreenChartModalProps) {
  const [period, setPeriod] = useState<TimePeriod>('1Y')
  const [activeOverlays, setActiveOverlays] = useState<Set<OverlayIndicatorId>>(
    () => new Set<OverlayIndicatorId>(chartShowMa ? ['sma20', 'ema50'] : [])
  )
  const [activePanes, setActivePanes] = useState<Set<PaneIndicatorId>>(
    () => new Set<PaneIndicatorId>(['volume'])
  )
  const [sidebarOpen, setSidebarOpen] = useState(true)

  useEffect(() => {
    if (chartShowMa) setActiveOverlays((prev) => {
      const next = new Set<OverlayIndicatorId>(Array.from(prev))
      next.add('sma20'); next.add('ema50')
      return next
    })
  }, [chartShowMa])

  useEffect(() => {
    if (isOpen) document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    const so = screen?.orientation as any // eslint-disable-line
    if (so?.lock) so.lock('landscape').catch(() => {})
    return () => { if (so?.unlock) so.unlock() }
  }, [isOpen])

  const handleKeyDown = useCallback((e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }, [onClose])
  useEffect(() => {
    if (isOpen) window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, handleKeyDown])

  const toggleOverlay = (id: OverlayIndicatorId) => {
    setActiveOverlays((prev) => {
      const next = new Set<OverlayIndicatorId>(Array.from(prev))
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  const togglePane = (id: PaneIndicatorId) => {
    setActivePanes((prev) => {
      const next = new Set<PaneIndicatorId>(Array.from(prev))
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const filteredData = filterByPeriod(priceData, period)

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-[9999] flex bg-surface-base"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
        >
          {/* Portrait rotate prompt */}
          <style>{`
            @media (orientation: portrait) and (max-width: 768px) {
              .fullscreen-chart-landscape-only { display: none !important; }
              .fullscreen-chart-rotate-prompt { display: flex !important; }
            }
          `}</style>
          <div className="fullscreen-chart-rotate-prompt hidden fixed inset-0 z-[10000] items-center justify-center flex-col gap-4 bg-surface-base">
            <svg className="w-16 h-16 text-blue-400 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3" />
            </svg>
            <p className="text-fg-secondary text-lg font-medium">Rotate your device to landscape</p>
            <button onClick={onClose} className="mt-4 px-4 py-2 rounded-lg bg-surface-raised text-fg-secondary text-sm hover:bg-surface-active transition-colors">Close</button>
          </div>

          <div className="fullscreen-chart-landscape-only flex flex-1 min-h-0 min-w-0">
            {/* Indicator sidebar */}
            <motion.div
              className="shrink-0 border-r border-line-subtle flex flex-col overflow-y-auto bg-surface-glass"
              initial={false}
              animate={{ width: sidebarOpen ? 200 : 44 }}
              transition={{ duration: 0.2 }}
            >
              <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="p-3 text-fg-muted hover:text-white transition-colors self-end"
                title={sidebarOpen ? 'Collapse' : 'Expand'}
              >
                <svg className={`w-5 h-5 transition-transform ${sidebarOpen ? '' : 'rotate-180'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>

              {sidebarOpen && (
                <div className="flex flex-col gap-1 px-3 pb-4">
                  {/* Overlays */}
                  <span className="text-[10px] uppercase tracking-wider text-fg-muted mb-1 font-semibold">Overlays</span>
                  {OVERLAY_INDICATORS.map(({ id, label, color }) => (
                    <button
                      key={id}
                      onClick={() => toggleOverlay(id as OverlayIndicatorId)}
                      className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all ${
                        activeOverlays.has(id as OverlayIndicatorId)
                          ? 'bg-surface-raised text-fg-primary'
                          : 'text-fg-muted hover:text-fg-secondary hover:bg-surface-hover'
                      }`}
                    >
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{
                          background: activeOverlays.has(id as OverlayIndicatorId) ? (color || '#888') : 'transparent',
                          border: `2px solid ${color || '#888'}`,
                        }}
                      />
                      {label}
                    </button>
                  ))}

                  {/* Pane indicators */}
                  <span className="text-[10px] uppercase tracking-wider text-fg-muted mt-3 mb-1 font-semibold">Indicators</span>
                  {PANE_INDICATORS.map(({ id, label, color }) => (
                    <button
                      key={id}
                      onClick={() => togglePane(id as PaneIndicatorId)}
                      className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all ${
                        activePanes.has(id as PaneIndicatorId)
                          ? 'bg-surface-raised text-fg-primary'
                          : 'text-fg-muted hover:text-fg-secondary hover:bg-surface-hover'
                      }`}
                    >
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{
                          background: activePanes.has(id as PaneIndicatorId) ? (color || '#888') : 'transparent',
                          border: `2px solid ${color || '#888'}`,
                        }}
                      />
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </motion.div>

            {/* Chart area */}
            <div className="flex-1 flex flex-col min-w-0 min-h-0">
              {/* Top bar */}
              <div className="flex items-center justify-between px-4 py-2 border-b border-line-subtle shrink-0">
                <div className="flex items-center gap-3">
                  <span className="text-fg-primary font-bold text-lg tracking-wide">{symbol}</span>
                  <span className="text-[10px] uppercase tracking-wider text-fg-muted font-medium">Fullscreen</span>
                </div>
                <div className="flex items-center gap-1">
                  {TIME_PERIODS.map((tp) => (
                    <button
                      key={tp}
                      onClick={() => setPeriod(tp)}
                      className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-all ${
                        period === tp
                          ? 'bg-blue-600 text-white shadow-md shadow-blue-600/25'
                          : 'text-fg-muted hover:text-white hover:bg-surface-hover'
                      }`}
                    >
                      {tp}
                    </button>
                  ))}
                </div>
                <button onClick={onClose} className="ml-4 p-2 rounded-lg text-fg-muted hover:text-white hover:bg-surface-raised transition-colors" title="Close (Esc)">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Chart */}
              <div className="flex-1 min-h-0 p-2">
                {filteredData.length > 0 ? (
                  <Chart
                    data={filteredData}
                    symbol={symbol}
                    seriesType={chartSeriesType}
                    activeOverlays={Array.from(activeOverlays)}
                    activePanes={Array.from(activePanes)}
                    exchangeTimezone={exchangeTimezone}
                  />
                ) : (
                  <div className="flex items-center justify-center h-full text-fg-muted text-sm">
                    No data available for the selected period.
                  </div>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

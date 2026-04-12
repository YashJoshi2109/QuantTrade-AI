'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Chart, { ChartSeriesType } from '@/components/Chart'
import { PriceBar } from '@/lib/api'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface FullscreenChartModalProps {
  isOpen: boolean
  onClose: () => void
  symbol: string
  priceData: PriceBar[]
  chartSeriesType: ChartSeriesType
  chartShowMa: boolean
}

type TimePeriod = '1D' | '1W' | '1M' | '3M' | 'YTD' | '1Y' | '5Y' | 'MAX'

interface IndicatorState {
  ma: boolean
  ema: boolean
  rsi: boolean
  macd: boolean
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function filterByPeriod(data: PriceBar[], period: TimePeriod): PriceBar[] {
  if (!data.length) return data
  if (period === 'MAX') return data

  const now = new Date()
  let cutoff: Date

  switch (period) {
    case '1D':
      cutoff = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000)
      break
    case '1W':
      cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
      break
    case '1M':
      cutoff = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate())
      break
    case '3M':
      cutoff = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate())
      break
    case 'YTD':
      cutoff = new Date(now.getFullYear(), 0, 1)
      break
    case '1Y':
      cutoff = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate())
      break
    case '5Y':
      cutoff = new Date(now.getFullYear() - 5, now.getMonth(), now.getDate())
      break
    default:
      return data
  }

  const cutoffStr = cutoff.toISOString().slice(0, 10)
  return data.filter((bar) => bar.timestamp >= cutoffStr)
}

const TIME_PERIODS: TimePeriod[] = ['1D', '1W', '1M', '3M', 'YTD', '1Y', '5Y', 'MAX']

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function FullscreenChartModal({
  isOpen,
  onClose,
  symbol,
  priceData,
  chartSeriesType,
  chartShowMa,
}: FullscreenChartModalProps) {
  const [period, setPeriod] = useState<TimePeriod>('1Y')
  const [indicators, setIndicators] = useState<IndicatorState>({
    ma: chartShowMa,
    ema: false,
    rsi: false,
    macd: false,
  })
  const [sidebarOpen, setSidebarOpen] = useState(true)

  /* Sync initial MA prop */
  useEffect(() => {
    setIndicators((prev) => ({ ...prev, ma: chartShowMa }))
  }, [chartShowMa])

  /* Lock body scroll when open */
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen])

  /* Try landscape lock on mobile (experimental API — not in all TS libs) */
  useEffect(() => {
    if (!isOpen) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const so = screen?.orientation as any
    if (so && typeof so.lock === 'function') {
      so.lock('landscape').catch(() => {
        /* orientation lock not supported — silently ignore */
      })
    }
    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const so2 = screen?.orientation as any
      if (so2 && typeof so2.unlock === 'function') {
        so2.unlock()
      }
    }
  }, [isOpen])

  /* Escape key to close */
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    },
    [onClose],
  )

  useEffect(() => {
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown)
    }
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, handleKeyDown])

  const toggleIndicator = (key: keyof IndicatorState) => {
    setIndicators((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const filteredData = filterByPeriod(priceData, period)
  const showMa = indicators.ma || indicators.ema

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-[9999] flex"
          style={{ background: '#0a0e1a' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
        >
          {/* ---- Portrait rotate prompt (mobile only) ---- */}
          <style>{`
            @media (orientation: portrait) and (max-width: 768px) {
              .fullscreen-chart-landscape-only {
                display: none !important;
              }
              .fullscreen-chart-rotate-prompt {
                display: flex !important;
              }
            }
          `}</style>

          <div
            className="fullscreen-chart-rotate-prompt hidden fixed inset-0 z-[10000] items-center justify-center flex-col gap-4"
            style={{ background: '#0a0e1a' }}
          >
            <svg
              className="w-16 h-16 text-blue-400 animate-pulse"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3"
              />
            </svg>
            <p className="text-slate-300 text-lg font-medium">
              Rotate your device to landscape
            </p>
            <p className="text-slate-500 text-sm">
              For the best chart experience
            </p>
            <button
              onClick={onClose}
              className="mt-4 px-4 py-2 rounded-lg bg-slate-800 text-slate-300 text-sm hover:bg-slate-700 transition-colors"
            >
              Close
            </button>
          </div>

          {/* ---- Main fullscreen layout ---- */}
          <div className="fullscreen-chart-landscape-only flex flex-1 min-h-0 min-w-0">
            {/* Indicator sidebar */}
            <motion.div
              className="shrink-0 border-r border-slate-800/60 flex flex-col overflow-hidden"
              style={{ background: 'rgba(10,14,26,0.95)' }}
              initial={false}
              animate={{ width: sidebarOpen ? 180 : 44 }}
              transition={{ duration: 0.2 }}
            >
              <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="p-3 text-slate-400 hover:text-white transition-colors self-end"
                title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
              >
                <svg
                  className={`w-5 h-5 transition-transform ${sidebarOpen ? '' : 'rotate-180'}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>

              {sidebarOpen && (
                <div className="flex flex-col gap-1 px-3 pb-4">
                  <span className="text-[10px] uppercase tracking-wider text-slate-500 mb-1 font-semibold">
                    Indicators
                  </span>
                  {(
                    [
                      { key: 'ma' as const, label: 'MA (20)', color: '#3b82f6' },
                      { key: 'ema' as const, label: 'EMA (50)', color: '#a855f7' },
                      { key: 'rsi' as const, label: 'RSI', color: '#f59e0b' },
                      { key: 'macd' as const, label: 'MACD', color: '#10b981' },
                    ] as const
                  ).map(({ key, label, color }) => (
                    <button
                      key={key}
                      onClick={() => toggleIndicator(key)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                        indicators[key]
                          ? 'bg-slate-800 text-white'
                          : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/40'
                      }`}
                    >
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{
                          background: indicators[key] ? color : 'transparent',
                          border: `2px solid ${color}`,
                        }}
                      />
                      {label}
                    </button>
                  ))}

                  {(indicators.rsi || indicators.macd) && (
                    <p className="text-[10px] text-slate-600 mt-2 leading-snug px-1">
                      RSI/MACD overlays are indicative. Full sub-chart coming soon.
                    </p>
                  )}
                </div>
              )}
            </motion.div>

            {/* Chart area */}
            <div className="flex-1 flex flex-col min-w-0 min-h-0">
              {/* Top bar */}
              <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800/60 shrink-0">
                {/* Symbol badge */}
                <div className="flex items-center gap-3">
                  <span className="text-white font-bold text-lg tracking-wide">
                    {symbol}
                  </span>
                  <span className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">
                    Fullscreen
                  </span>
                </div>

                {/* Time period selectors */}
                <div className="flex items-center gap-1">
                  {TIME_PERIODS.map((tp) => (
                    <button
                      key={tp}
                      onClick={() => setPeriod(tp)}
                      className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-all ${
                        period === tp
                          ? 'bg-blue-600 text-white shadow-md shadow-blue-600/25'
                          : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                      }`}
                    >
                      {tp}
                    </button>
                  ))}
                </div>

                {/* Close button */}
                <button
                  onClick={onClose}
                  className="ml-4 p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                  title="Close (Esc)"
                >
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
                    showMovingAverages={showMa}
                  />
                ) : (
                  <div className="flex items-center justify-center h-full text-slate-500 text-sm">
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

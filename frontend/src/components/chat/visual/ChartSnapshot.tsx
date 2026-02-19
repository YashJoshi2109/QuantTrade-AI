'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { motion } from 'framer-motion'
import type { StockAnalysisData } from '../types'

interface Props {
  symbol: string
  data?: StockAnalysisData
}

const TIMEFRAMES = ['1D', '1M', '1Y'] as const
type Timeframe = (typeof TIMEFRAMES)[number]

function limitForTimeframe(tf: Timeframe): number {
  switch (tf) {
    case '1D': return 1
    case '1M': return 22
    case '1Y': return 252
    default: return 60
  }
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export default function ChartSnapshot({ symbol, data }: Props) {
  const [timeframe, setTimeframe] = useState<Timeframe>('1M')
  const [loading, setLoading] = useState(true)
  const [hasData, setHasData] = useState(true)
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const chartInstanceRef = useRef<any>(null)

  const fetchAndRender = useCallback(async () => {
    if (!chartContainerRef.current) return
    setLoading(true)

    try {
      const limit = limitForTimeframe(timeframe)

      // Trigger a price sync first so the chart has fresh data
      try {
        await fetch(`${API_URL}/api/v1/prices/${symbol}/sync`, { method: 'POST' })
      } catch {
        // Sync is best-effort; continue with whatever data the DB has
      }

      const res = await fetch(`${API_URL}/api/v1/prices/${symbol}?limit=${limit}`)
      if (!res.ok) {
        setHasData(false)
        setLoading(false)
        return
      }
      const priceData = await res.json()
      if (!priceData?.length) {
        setHasData(false)
        setLoading(false)
        return
      }

      setHasData(true)
      const { createChart, ColorType } = await import('lightweight-charts')

      if (chartInstanceRef.current) {
        chartInstanceRef.current.remove()
        chartInstanceRef.current = null
      }

      const chart = createChart(chartContainerRef.current, {
        width: chartContainerRef.current.clientWidth,
        height: 200,
        layout: {
          background: { type: ColorType.Solid, color: 'transparent' },
          textColor: '#64748b',
          fontSize: 10,
        },
        grid: {
          vertLines: { color: 'rgba(255,255,255,0.02)' },
          horzLines: { color: 'rgba(255,255,255,0.02)' },
        },
        crosshair: {
          vertLine: { color: 'rgba(0, 217, 255, 0.3)', width: 1 as any },
          horzLine: { color: 'rgba(0, 217, 255, 0.3)', width: 1 as any },
        },
        rightPriceScale: {
          borderVisible: false,
          scaleMargins: { top: 0.1, bottom: 0.25 },
        },
        timeScale: {
          borderVisible: false,
          timeVisible: timeframe === '1D',
        },
      })

      chartInstanceRef.current = chart

      const candlestickSeries = chart.addCandlestickSeries({
        upColor: '#00E676',
        downColor: '#FF5252',
        borderDownColor: '#FF5252',
        borderUpColor: '#00E676',
        wickDownColor: '#FF5252',
        wickUpColor: '#00E676',
      })

      const candleData = priceData.map((d: any) => {
        const ts = d.timestamp || d.date
        return {
          time: typeof ts === 'string' ? ts.split('T')[0] : ts,
          open: d.open,
          high: d.high,
          low: d.low,
          close: d.close,
        }
      })
      candlestickSeries.setData(candleData)

      const volumeSeries = chart.addHistogramSeries({
        priceFormat: { type: 'volume' },
        priceScaleId: 'volume',
      })

      chart.priceScale('volume').applyOptions({
        scaleMargins: { top: 0.8, bottom: 0 },
      })

      const volData = priceData.map((d: any) => {
        const ts = d.timestamp || d.date
        return {
          time: typeof ts === 'string' ? ts.split('T')[0] : ts,
          value: d.volume || 0,
          color: d.close >= d.open ? 'rgba(0,230,118,0.15)' : 'rgba(255,82,82,0.15)',
        }
      })
      volumeSeries.setData(volData)

      chart.timeScale().fitContent()

      const handleResize = () => {
        if (chartContainerRef.current && chartInstanceRef.current) {
          chartInstanceRef.current.applyOptions({ width: chartContainerRef.current.clientWidth })
        }
      }
      const resizeObserver = new ResizeObserver(handleResize)
      resizeObserver.observe(chartContainerRef.current)

      setLoading(false)

      return () => {
        resizeObserver.disconnect()
      }
    } catch (err) {
      console.error('Chart render error:', err)
      setHasData(false)
      setLoading(false)
    }
  }, [symbol, timeframe])

  useEffect(() => {
    fetchAndRender()
    return () => {
      if (chartInstanceRef.current) {
        chartInstanceRef.current.remove()
        chartInstanceRef.current = null
      }
    }
  }, [fetchAndRender])

  const indicatorChips: { label: string; value: string; color: string }[] = []
  const ind = data?.indicators
  if (ind?.rsi != null) {
    const rsiVal = ind.rsi
    const color = rsiVal > 70 ? 'text-red-400' : rsiVal < 30 ? 'text-emerald-400' : 'text-slate-400'
    indicatorChips.push({ label: 'RSI', value: rsiVal.toFixed(1), color })
  }
  if (ind?.macd?.macd != null) {
    const bullish = (ind.macd.histogram ?? 0) > 0
    indicatorChips.push({ label: 'MACD', value: bullish ? 'Bullish' : 'Bearish', color: bullish ? 'text-emerald-400' : 'text-red-400' })
  }
  if (ind?.sma_50 != null && ind?.sma_200 != null) {
    const above = ind.sma_50 > ind.sma_200
    indicatorChips.push({ label: 'SMA', value: above ? '50>200' : '50<200', color: above ? 'text-emerald-400' : 'text-red-400' })
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.1 }}
      className="rounded-2xl bg-[#15171E]/80 backdrop-blur-xl border border-white/[0.06] overflow-hidden"
    >
      {/* Timeframe tabs + indicator chips */}
      <div className="px-3 pt-3 pb-2 flex items-center justify-between gap-2">
        <div className="flex gap-1">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={`text-[10px] font-semibold px-2.5 py-1 rounded-md transition-all ${
                timeframe === tf
                  ? 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/30'
                  : 'text-slate-500 hover:text-slate-300 border border-transparent'
              }`}
            >
              {tf}
            </button>
          ))}
        </div>
        <div className="flex gap-1.5">
          {indicatorChips.map((chip) => (
            <span key={chip.label} className={`text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded bg-white/[0.03] ${chip.color}`}>
              {chip.label} {chip.value}
            </span>
          ))}
        </div>
      </div>

      {/* Chart */}
      <div className="relative">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center z-10">
            <div className="w-5 h-5 border-2 border-cyan-500/30 border-t-cyan-400 rounded-full animate-spin" />
          </div>
        )}
        {!hasData && !loading && (
          <div className="flex items-center justify-center h-[200px] text-[11px] text-slate-500">
            No price data available
          </div>
        )}
        <div ref={chartContainerRef} className={`w-full h-[200px] ${!hasData && !loading ? 'hidden' : ''}`} />
      </div>
    </motion.div>
  )
}

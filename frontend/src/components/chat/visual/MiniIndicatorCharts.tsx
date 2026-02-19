'use client'

import { useEffect, useRef, useCallback, useState } from 'react'
import { motion } from 'framer-motion'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

interface PriceBar {
  timestamp: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

function computeRSI(closes: number[], period = 14): number[] {
  const rsi: number[] = []
  if (closes.length < period + 1) return rsi

  let avgGain = 0
  let avgLoss = 0

  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1]
    if (diff > 0) avgGain += diff
    else avgLoss += Math.abs(diff)
  }
  avgGain /= period
  avgLoss /= period

  for (let i = 0; i < period; i++) rsi.push(NaN)
  rsi.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss))

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1]
    const gain = diff > 0 ? diff : 0
    const loss = diff < 0 ? Math.abs(diff) : 0
    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period
    rsi.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss))
  }
  return rsi
}

function computeEMA(data: number[], period: number): number[] {
  const ema: number[] = []
  if (data.length === 0) return ema
  const k = 2 / (period + 1)
  ema.push(data[0])
  for (let i = 1; i < data.length; i++) {
    ema.push(data[i] * k + ema[i - 1] * (1 - k))
  }
  return ema
}

function computeMACD(closes: number[]): { macd: number[]; signal: number[]; histogram: number[] } {
  const ema12 = computeEMA(closes, 12)
  const ema26 = computeEMA(closes, 26)
  const macd = ema12.map((v, i) => v - ema26[i])
  const signal = computeEMA(macd, 9)
  const histogram = macd.map((v, i) => v - signal[i])
  return { macd, signal, histogram }
}

async function fetchPriceData(symbol: string, limit = 120): Promise<PriceBar[]> {
  try {
    const res = await fetch(`${API_URL}/api/v1/prices/${symbol}?limit=${limit}`)
    if (!res.ok) return []
    return await res.json()
  } catch {
    return []
  }
}

interface MiniChartProps {
  symbol: string
}

export function RSIChart({ symbol }: MiniChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<any>(null)
  const [loading, setLoading] = useState(true)

  const render = useCallback(async () => {
    if (!containerRef.current) return
    setLoading(true)

    const bars = await fetchPriceData(symbol, 120)
    if (!bars.length) { setLoading(false); return }

    const closes = bars.map((b) => b.close)
    const rsiValues = computeRSI(closes)
    const dates = bars.map((b) => {
      const ts = b.timestamp || (b as any).date
      return typeof ts === 'string' ? ts.split('T')[0] : ts
    })

    const { createChart, ColorType } = await import('lightweight-charts')

    if (chartRef.current) {
      chartRef.current.remove()
      chartRef.current = null
    }

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 100,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: '#64748b', fontSize: 9 },
      grid: { vertLines: { color: 'rgba(255,255,255,0.02)' }, horzLines: { color: 'rgba(255,255,255,0.02)' } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.05, bottom: 0.05 } },
      timeScale: { borderVisible: false, visible: false },
      crosshair: { vertLine: { visible: false }, horzLine: { color: 'rgba(0,217,255,0.2)', width: 1 as any } },
    })
    chartRef.current = chart

    const lineSeries = chart.addLineSeries({
      color: '#7C3AED',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
    })

    const rsiData = rsiValues
      .map((v, i) => ({ time: dates[i], value: v }))
      .filter((d) => !isNaN(d.value))
    lineSeries.setData(rsiData as any)

    const overbought = chart.addLineSeries({ color: 'rgba(255,82,82,0.4)', lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false })
    const oversold = chart.addLineSeries({ color: 'rgba(0,230,118,0.4)', lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false })
    overbought.setData(rsiData.map((d) => ({ time: d.time, value: 70 })) as any)
    oversold.setData(rsiData.map((d) => ({ time: d.time, value: 30 })) as any)

    chart.timeScale().fitContent()
    setLoading(false)

    const ro = new ResizeObserver(() => {
      if (containerRef.current && chartRef.current)
        chartRef.current.applyOptions({ width: containerRef.current.clientWidth })
    })
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [symbol])

  useEffect(() => {
    render()
    return () => { chartRef.current?.remove(); chartRef.current = null }
  }, [render])

  return (
    <div className="mt-2 rounded-lg bg-white/[0.01] border border-white/[0.03] overflow-hidden relative">
      <div className="px-2 pt-1.5 flex items-center justify-between">
        <span className="text-[8px] text-slate-500 font-semibold uppercase tracking-wider">RSI (14)</span>
        <div className="flex gap-2 text-[7px] text-slate-600">
          <span className="text-red-400/70">70 Overbought</span>
          <span className="text-emerald-400/70">30 Oversold</span>
        </div>
      </div>
      {loading && (
        <div className="flex items-center justify-center h-[100px]">
          <div className="w-4 h-4 border-2 border-purple-500/30 border-t-purple-400 rounded-full animate-spin" />
        </div>
      )}
      <div ref={containerRef} className={`w-full h-[100px] ${loading ? 'hidden' : ''}`} />
    </div>
  )
}

export function MACDChart({ symbol }: MiniChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<any>(null)
  const [loading, setLoading] = useState(true)

  const render = useCallback(async () => {
    if (!containerRef.current) return
    setLoading(true)

    const bars = await fetchPriceData(symbol, 120)
    if (!bars.length) { setLoading(false); return }

    const closes = bars.map((b) => b.close)
    const { macd, signal, histogram } = computeMACD(closes)
    const dates = bars.map((b) => {
      const ts = b.timestamp || (b as any).date
      return typeof ts === 'string' ? ts.split('T')[0] : ts
    })

    const { createChart, ColorType } = await import('lightweight-charts')

    if (chartRef.current) {
      chartRef.current.remove()
      chartRef.current = null
    }

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 100,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: '#64748b', fontSize: 9 },
      grid: { vertLines: { color: 'rgba(255,255,255,0.02)' }, horzLines: { color: 'rgba(255,255,255,0.02)' } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.1, bottom: 0.1 } },
      timeScale: { borderVisible: false, visible: false },
      crosshair: { vertLine: { visible: false }, horzLine: { color: 'rgba(0,217,255,0.2)', width: 1 as any } },
    })
    chartRef.current = chart

    const startIdx = 26

    const histSeries = chart.addHistogramSeries({
      priceFormat: { type: 'price', precision: 4 },
    })
    const histData = histogram.slice(startIdx).map((v, i) => ({
      time: dates[startIdx + i],
      value: v,
      color: v >= 0 ? 'rgba(0,230,118,0.5)' : 'rgba(255,82,82,0.5)',
    }))
    histSeries.setData(histData as any)

    const macdLine = chart.addLineSeries({ color: '#00D9FF', lineWidth: 2 as any, priceLineVisible: false, lastValueVisible: false })
    const sigLine = chart.addLineSeries({ color: '#FF6B35', lineWidth: 2 as any, priceLineVisible: false, lastValueVisible: false })

    macdLine.setData(macd.slice(startIdx).map((v, i) => ({ time: dates[startIdx + i], value: v })) as any)
    sigLine.setData(signal.slice(startIdx).map((v, i) => ({ time: dates[startIdx + i], value: v })) as any)

    chart.timeScale().fitContent()
    setLoading(false)

    const ro = new ResizeObserver(() => {
      if (containerRef.current && chartRef.current)
        chartRef.current.applyOptions({ width: containerRef.current.clientWidth })
    })
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [symbol])

  useEffect(() => {
    render()
    return () => { chartRef.current?.remove(); chartRef.current = null }
  }, [render])

  return (
    <div className="mt-2 rounded-lg bg-white/[0.01] border border-white/[0.03] overflow-hidden relative">
      <div className="px-2 pt-1.5 flex items-center justify-between">
        <span className="text-[8px] text-slate-500 font-semibold uppercase tracking-wider">MACD (12, 26, 9)</span>
        <div className="flex gap-2 text-[7px]">
          <span className="text-cyan-400/70">MACD</span>
          <span className="text-orange-400/70">Signal</span>
        </div>
      </div>
      {loading && (
        <div className="flex items-center justify-center h-[100px]">
          <div className="w-4 h-4 border-2 border-cyan-500/30 border-t-cyan-400 rounded-full animate-spin" />
        </div>
      )}
      <div ref={containerRef} className={`w-full h-[100px] ${loading ? 'hidden' : ''}`} />
    </div>
  )
}

export function VolumeProfileChart({ symbol }: MiniChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<any>(null)
  const [loading, setLoading] = useState(true)

  const render = useCallback(async () => {
    if (!containerRef.current) return
    setLoading(true)

    const bars = await fetchPriceData(symbol, 60)
    if (!bars.length) { setLoading(false); return }

    const dates = bars.map((b) => {
      const ts = b.timestamp || (b as any).date
      return typeof ts === 'string' ? ts.split('T')[0] : ts
    })

    const { createChart, ColorType } = await import('lightweight-charts')

    if (chartRef.current) {
      chartRef.current.remove()
      chartRef.current = null
    }

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 80,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: '#64748b', fontSize: 9 },
      grid: { vertLines: { color: 'rgba(255,255,255,0.02)' }, horzLines: { color: 'rgba(255,255,255,0.02)' } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, visible: false },
      crosshair: { vertLine: { visible: false }, horzLine: { visible: false } },
    })
    chartRef.current = chart

    const volSeries = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
    })

    volSeries.setData(bars.map((b, i) => ({
      time: dates[i],
      value: b.volume,
      color: b.close >= b.open ? 'rgba(0,230,118,0.35)' : 'rgba(255,82,82,0.35)',
    })) as any)

    chart.timeScale().fitContent()
    setLoading(false)

    const ro = new ResizeObserver(() => {
      if (containerRef.current && chartRef.current)
        chartRef.current.applyOptions({ width: containerRef.current.clientWidth })
    })
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [symbol])

  useEffect(() => {
    render()
    return () => { chartRef.current?.remove(); chartRef.current = null }
  }, [render])

  return (
    <div className="mt-2 rounded-lg bg-white/[0.01] border border-white/[0.03] overflow-hidden relative">
      <div className="px-2 pt-1.5">
        <span className="text-[8px] text-slate-500 font-semibold uppercase tracking-wider">Volume (60D)</span>
      </div>
      {loading && (
        <div className="flex items-center justify-center h-[80px]">
          <div className="w-4 h-4 border-2 border-slate-500/30 border-t-slate-400 rounded-full animate-spin" />
        </div>
      )}
      <div ref={containerRef} className={`w-full h-[80px] ${loading ? 'hidden' : ''}`} />
    </div>
  )
}

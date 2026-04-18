'use client'

import { useEffect, useRef } from 'react'
import {
  createChart,
  ColorType,
  IChartApi,
  ISeriesApi,
  Time,
} from 'lightweight-charts'
import { PriceBar } from '@/lib/api'

export type ChartSeriesType = 'candlestick' | 'line' | 'area' | 'heikin-ashi' | 'baseline'

interface ChartProps {
  data: PriceBar[]
  symbol: string
  seriesType?: ChartSeriesType
  /** Moving averages (SMA 20 / EMA 50) — shown on candlesticks only. */
  showMovingAverages?: boolean
  /** Show volume histogram below price chart */
  showVolume?: boolean
  /** Use logarithmic price scale */
  logScale?: boolean
  /** Show grid lines */
  showGrid?: boolean
}

export default function Chart({
  data,
  symbol,
  seriesType = 'candlestick',
  showMovingAverages = true,
  showVolume = false,
  logScale = false,
  showGrid = true,
}: ChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const mainSeriesRef = useRef<
    ISeriesApi<'Candlestick'> | ISeriesApi<'Line'> | ISeriesApi<'Area'> | ISeriesApi<'Baseline'> | null
  >(null)
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const overlayLineRefs = useRef<ISeriesApi<'Line'>[]>([])

  useEffect(() => {
    if (!chartContainerRef.current) return

    const gridColor = showGrid ? '#2B2B43' : 'transparent'

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#131722' },
        textColor: '#d1d4dc',
      },
      width: chartContainerRef.current.clientWidth,
      height: chartContainerRef.current.clientHeight,
      grid: {
        vertLines: { color: gridColor },
        horzLines: { color: gridColor },
      },
      crosshair: {
        mode: 0,
      },
      rightPriceScale: {
        borderColor: '#485065',
        mode: logScale ? 1 : 0, // 1 = Logarithmic, 0 = Normal
      },
      timeScale: {
        borderColor: '#485065',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 5,
        minBarSpacing: 1,
      },
    })

    chartRef.current = chart

    const handleResize = () => {
      if (chartContainerRef.current && chart) {
        chart.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
        })
      }
    }

    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      chart.remove()
      chartRef.current = null
      mainSeriesRef.current = null
      volumeSeriesRef.current = null
      overlayLineRefs.current = []
    }
  }, [showGrid, logScale])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return

    overlayLineRefs.current.forEach((series) => {
      try {
        chart.removeSeries(series)
      } catch {
        /* already removed */
      }
    })
    overlayLineRefs.current = []

    if (mainSeriesRef.current) {
      try {
        chart.removeSeries(mainSeriesRef.current)
      } catch {
        /* already removed */
      }
      mainSeriesRef.current = null
    }

    if (seriesType === 'candlestick' || seriesType === 'heikin-ashi') {
      mainSeriesRef.current = chart.addCandlestickSeries({
        upColor: '#26a69a',
        downColor: '#ef5350',
        borderVisible: false,
        wickUpColor: '#26a69a',
        wickDownColor: '#ef5350',
      })
    } else if (seriesType === 'line') {
      mainSeriesRef.current = chart.addLineSeries({
        color: '#38bdf8',
        lineWidth: 2,
        title: 'Close',
      })
    } else if (seriesType === 'baseline') {
      mainSeriesRef.current = chart.addBaselineSeries({
        baseValue: { type: 'price', price: 0 },
        topLineColor: '#26a69a',
        bottomLineColor: '#ef5350',
        topFillColor1: 'rgba(38, 166, 154, 0.28)',
        topFillColor2: 'rgba(38, 166, 154, 0.05)',
        bottomFillColor1: 'rgba(239, 83, 80, 0.05)',
        bottomFillColor2: 'rgba(239, 83, 80, 0.28)',
        lineWidth: 2,
      })
    } else {
      mainSeriesRef.current = chart.addAreaSeries({
        lineColor: '#38bdf8',
        topColor: 'rgba(56, 189, 248, 0.35)',
        bottomColor: 'rgba(56, 189, 248, 0.02)',
        lineWidth: 2,
        title: 'Close',
      })
    }
  }, [seriesType])

  useEffect(() => {
    const chart = chartRef.current
    const main = mainSeriesRef.current
    if (!chart || !main) return

    overlayLineRefs.current.forEach((series) => {
      try {
        chart.removeSeries(series)
      } catch {
        /* ignore */
      }
    })
    overlayLineRefs.current = []

    if (!data?.length) {
      try {
        main.setData([])
      } catch {
        /* ignore */
      }
      return
    }

    // Remove old volume series
    if (volumeSeriesRef.current) {
      try { chart.removeSeries(volumeSeriesRef.current) } catch { /* */ }
      volumeSeriesRef.current = null
    }

    const rawCandles = data.map((bar) => ({
      time: (new Date(bar.timestamp).getTime() / 1000) as Time,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume || 0,
    }))

    if (seriesType === 'heikin-ashi') {
      // Convert to Heikin-Ashi candles
      const ha: typeof rawCandles = []
      for (let i = 0; i < rawCandles.length; i++) {
        const c = rawCandles[i]
        const prev = i > 0 ? ha[i - 1] : c
        const haClose = (c.open + c.high + c.low + c.close) / 4
        const haOpen = (prev.open + prev.close) / 2
        ha.push({
          time: c.time,
          open: haOpen,
          high: Math.max(c.high, haOpen, haClose),
          low: Math.min(c.low, haOpen, haClose),
          close: haClose,
          volume: c.volume,
        })
      }
      ;(main as ISeriesApi<'Candlestick'>).setData(ha)
    } else if (seriesType === 'candlestick') {
      ;(main as ISeriesApi<'Candlestick'>).setData(rawCandles)
    } else if (seriesType === 'baseline') {
      // Baseline uses first price as the base
      const basePrice = rawCandles.length > 0 ? rawCandles[0].close : 0
      ;(main as ISeriesApi<'Baseline'>).applyOptions({
        baseValue: { type: 'price', price: basePrice },
      })
      const baselineData = rawCandles.map((c) => ({ time: c.time, value: c.close }))
      ;(main as ISeriesApi<'Baseline'>).setData(baselineData)
    } else {
      const lineData = rawCandles.map((c) => ({ time: c.time, value: c.close }))
      if (seriesType === 'line') {
        ;(main as ISeriesApi<'Line'>).setData(lineData)
      } else {
        ;(main as ISeriesApi<'Area'>).setData(lineData)
      }
    }

    // Moving averages (candlestick and heikin-ashi only)
    if (showMovingAverages && (seriesType === 'candlestick' || seriesType === 'heikin-ashi') && data.length >= 50) {
      const sma20Data: { time: Time; value: number }[] = []
      for (let i = 19; i < rawCandles.length; i++) {
        const sum = rawCandles.slice(i - 19, i + 1).reduce((acc, d) => acc + d.close, 0)
        sma20Data.push({ time: rawCandles[i].time, value: sum / 20 })
      }

      const ema50Data: { time: Time; value: number }[] = []
      let ema = rawCandles[0].close
      const multiplier = 2 / (50 + 1)
      ema50Data.push({ time: rawCandles[0].time, value: ema })
      for (let i = 1; i < rawCandles.length; i++) {
        ema = (rawCandles[i].close - ema) * multiplier + ema
        ema50Data.push({ time: rawCandles[i].time, value: ema })
      }

      if (sma20Data.length > 0) {
        const s = chart.addLineSeries({ color: '#3b82f6', lineWidth: 2, title: 'SMA 20' })
        s.setData(sma20Data)
        overlayLineRefs.current.push(s)
      }
      if (ema50Data.length > 0) {
        const s = chart.addLineSeries({ color: '#f97316', lineWidth: 2, title: 'EMA 50' })
        s.setData(ema50Data)
        overlayLineRefs.current.push(s)
      }
    }

    // Volume histogram
    if (showVolume && rawCandles.some((c) => c.volume > 0)) {
      const volSeries = chart.addHistogramSeries({
        priceFormat: { type: 'volume' },
        priceScaleId: 'vol',
      })
      chart.priceScale('vol').applyOptions({
        scaleMargins: { top: 0.8, bottom: 0 },
      })
      volSeries.setData(
        rawCandles.map((c) => ({
          time: c.time,
          value: c.volume,
          color: c.close >= c.open ? 'rgba(38,166,154,0.35)' : 'rgba(239,83,80,0.35)',
        })),
      )
      volumeSeriesRef.current = volSeries
    }

    chart.timeScale().fitContent()
  }, [data, seriesType, showMovingAverages, showVolume, symbol])

  return (
    <div className="w-full h-full">
      <div ref={chartContainerRef} className="w-full h-full" />
    </div>
  )
}

'use client'

import { useEffect, useRef, useState, useMemo } from 'react'
import {
  createChart,
  ColorType,
  IChartApi,
  ISeriesApi,
  Time,
} from 'lightweight-charts'
import { PriceBar } from '@/lib/api'
import { useChartSync } from '@/hooks/useChartSync'
import {
  sma, ema, vwap, rsi, macd, bollingerBands, stochastic, atr, obv, williamsR, cci,
  type Candle, type OverlayIndicatorId, type PaneIndicatorId,
} from '@/lib/indicators'

export type ChartSeriesType = 'candlestick' | 'line' | 'area' | 'heikin-ashi' | 'baseline'

interface ChartProps {
  data: PriceBar[]
  symbol: string
  seriesType?: ChartSeriesType
  /** @deprecated Use activeOverlays instead */
  showMovingAverages?: boolean
  /** @deprecated Use activePanes with 'volume' instead */
  showVolume?: boolean
  logScale?: boolean
  showGrid?: boolean
  chartId?: string
  /** Overlay indicators to show on the price chart */
  activeOverlays?: OverlayIndicatorId[]
  /** Pane indicators to show below the price chart */
  activePanes?: PaneIndicatorId[]
  /** Comparison symbols data — normalized to % change from first bar */
  comparisonData?: { symbol: string; data: PriceBar[]; color: string }[]
  /** IANA timezone of the exchange (e.g. 'America/New_York', 'Europe/London') */
  exchangeTimezone?: string
}

// Deduplicate timestamps — lightweight-charts requires strictly increasing times
function dedup<T extends { time: Time }>(arr: T[]): T[] {
  const seen = new Set<number>()
  return arr.filter((p) => {
    const t = p.time as number
    if (seen.has(t)) return false
    seen.add(t)
    return true
  })
}

export default function Chart({
  data,
  symbol,
  seriesType = 'candlestick',
  showMovingAverages = false,
  showVolume = false,
  logScale = false,
  showGrid = true,
  chartId,
  activeOverlays = [],
  activePanes = [],
  comparisonData,
  exchangeTimezone = 'America/New_York',
}: ChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const mainSeriesRef = useRef<ISeriesApi<'Candlestick'> | ISeriesApi<'Line'> | ISeriesApi<'Area'> | ISeriesApi<'Baseline'> | null>(null)
  const extraSeriesRef = useRef<(ISeriesApi<'Line'> | ISeriesApi<'Histogram'> | ISeriesApi<'Area'>)[]>([])
  const [chartApiForSync, setChartApiForSync] = useState<IChartApi | null>(null)
  useChartSync(chartId ?? '', chartId ? chartApiForSync : null)

  // Backwards compat: merge legacy props into activeOverlays/activePanes
  const overlays = useMemo(() => {
    const set = new Set(activeOverlays)
    if (showMovingAverages) { set.add('sma20'); set.add('ema50') }
    return Array.from(set)
  }, [activeOverlays, showMovingAverages])

  const panes = useMemo(() => {
    const set = new Set(activePanes)
    if (showVolume) set.add('volume')
    return Array.from(set)
  }, [activePanes, showVolume])

  // Compute candle array once.
  // lightweight-charts treats all timestamps as UTC. To display times in the
  // exchange's native timezone (like Yahoo Finance), we compute the UTC offset
  // for the target timezone and shift each timestamp accordingly.
  const rawCandles = useMemo<{ time: Time; open: number; high: number; low: number; close: number; volume: number }[]>(() => {
    if (!data?.length) return []
    function tzOffsetMinutes(date: Date, tz: string): number {
      const utcParts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      }).formatToParts(date)
      const tzParts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      }).formatToParts(date)
      const get = (parts: Intl.DateTimeFormatPart[], type: string) =>
        parseInt(parts.find((p) => p.type === type)?.value || '0', 10)
      const utcD = Date.UTC(get(utcParts, 'year'), get(utcParts, 'month') - 1, get(utcParts, 'day'),
        get(utcParts, 'hour'), get(utcParts, 'minute'), get(utcParts, 'second'))
      const tzD = Date.UTC(get(tzParts, 'year'), get(tzParts, 'month') - 1, get(tzParts, 'day'),
        get(tzParts, 'hour'), get(tzParts, 'minute'), get(tzParts, 'second'))
      return (tzD - utcD) / 60000
    }
    return data.map((bar) => {
      const d = new Date(bar.timestamp)
      const offsetMin = tzOffsetMinutes(d, exchangeTimezone)
      const utcSec = Math.floor(d.getTime() / 1000)
      return {
        time: (utcSec + offsetMin * 60) as Time,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume || 0,
      }
    })
  }, [data, exchangeTimezone])

  // Create chart instance
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
      grid: { vertLines: { color: gridColor }, horzLines: { color: gridColor } },
      crosshair: { mode: 0 },
      rightPriceScale: { borderColor: '#485065', mode: logScale ? 1 : 0 },
      timeScale: { borderColor: '#485065', timeVisible: true, secondsVisible: false, rightOffset: 5, minBarSpacing: 1 },
    })

    chartRef.current = chart
    if (chartId) setChartApiForSync(chart)

    const handleResize = () => {
      if (chartContainerRef.current && chart) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth, height: chartContainerRef.current.clientHeight })
      }
    }
    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
      chart.remove()
      chartRef.current = null
      if (chartId) setChartApiForSync(null)
      mainSeriesRef.current = null
      extraSeriesRef.current = []
    }
  }, [showGrid, logScale, chartId])

  // Create main series
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return

    // Clean up all extra series
    extraSeriesRef.current.forEach((s) => { try { chart.removeSeries(s) } catch { /* */ } })
    extraSeriesRef.current = []

    if (mainSeriesRef.current) {
      try { chart.removeSeries(mainSeriesRef.current) } catch { /* */ }
      mainSeriesRef.current = null
    }

    if (seriesType === 'candlestick' || seriesType === 'heikin-ashi') {
      mainSeriesRef.current = chart.addCandlestickSeries({
        upColor: '#26a69a', downColor: '#ef5350',
        borderVisible: false, wickUpColor: '#26a69a', wickDownColor: '#ef5350',
      })
    } else if (seriesType === 'line') {
      mainSeriesRef.current = chart.addLineSeries({ color: '#38bdf8', lineWidth: 2 })
    } else if (seriesType === 'baseline') {
      mainSeriesRef.current = chart.addBaselineSeries({
        baseValue: { type: 'price', price: 0 },
        topLineColor: '#26a69a', bottomLineColor: '#ef5350',
        topFillColor1: 'rgba(38,166,154,0.28)', topFillColor2: 'rgba(38,166,154,0.05)',
        bottomFillColor1: 'rgba(239,83,80,0.05)', bottomFillColor2: 'rgba(239,83,80,0.28)',
        lineWidth: 2,
      })
    } else {
      mainSeriesRef.current = chart.addAreaSeries({
        lineColor: '#38bdf8', topColor: 'rgba(56,189,248,0.35)', bottomColor: 'rgba(56,189,248,0.02)', lineWidth: 2,
      })
    }
  }, [seriesType])

  // Set data + indicators
  useEffect(() => {
    const chart = chartRef.current
    const main = mainSeriesRef.current
    if (!chart || !main) return

    // Remove old extra series
    extraSeriesRef.current.forEach((s) => { try { chart.removeSeries(s) } catch { /* */ } })
    extraSeriesRef.current = []

    if (!rawCandles.length) {
      try { main.setData([]) } catch { /* */ }
      return
    }

    // ── Set main price data ──
    if (seriesType === 'heikin-ashi') {
      const ha: typeof rawCandles = []
      for (let i = 0; i < rawCandles.length; i++) {
        const c = rawCandles[i]
        const prev = i > 0 ? ha[i - 1] : c
        const haClose = (c.open + c.high + c.low + c.close) / 4
        const haOpen = (prev.open + prev.close) / 2
        ha.push({ time: c.time, open: haOpen, high: Math.max(c.high, haOpen, haClose), low: Math.min(c.low, haOpen, haClose), close: haClose, volume: c.volume })
      }
      ;(main as ISeriesApi<'Candlestick'>).setData(ha)
    } else if (seriesType === 'candlestick') {
      ;(main as ISeriesApi<'Candlestick'>).setData(rawCandles)
    } else if (seriesType === 'baseline') {
      const basePrice = rawCandles[0]?.close || 0
      ;(main as ISeriesApi<'Baseline'>).applyOptions({ baseValue: { type: 'price', price: basePrice } })
      ;(main as ISeriesApi<'Baseline'>).setData(rawCandles.map((c) => ({ time: c.time, value: c.close })))
    } else {
      const lineData = rawCandles.map((c) => ({ time: c.time, value: c.close }))
      if (seriesType === 'line') (main as ISeriesApi<'Line'>).setData(lineData)
      else (main as ISeriesApi<'Area'>).setData(lineData)
    }

    const candles: Candle[] = rawCandles.map((c) => ({ time: Number(c.time), open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume }))

    // Helper to add a line overlay
    const addOverlayLine = (pts: { time: number; value: number }[], color: string, title: string) => {
      if (pts.length === 0) return
      const s = chart.addLineSeries({ color, lineWidth: 2, title, priceLineVisible: false, lastValueVisible: true })
      s.setData(dedup(pts.map((p) => ({ time: p.time as Time, value: p.value }))))
      extraSeriesRef.current.push(s)
    }

    // ── Overlay indicators ──
    for (const id of overlays) {
      switch (id) {
        case 'sma20': addOverlayLine(sma(candles, 20), '#3b82f6', 'SMA 20'); break
        case 'sma50': addOverlayLine(sma(candles, 50), '#f97316', 'SMA 50'); break
        case 'sma200': addOverlayLine(sma(candles, 200), '#a855f7', 'SMA 200'); break
        case 'ema12': addOverlayLine(ema(candles, 12), '#06b6d4', 'EMA 12'); break
        case 'ema26': addOverlayLine(ema(candles, 26), '#ec4899', 'EMA 26'); break
        case 'ema50': addOverlayLine(ema(candles, 50), '#f97316', 'EMA 50'); break
        case 'vwap': addOverlayLine(vwap(candles), '#eab308', 'VWAP'); break
        case 'bbands': {
          const bb = bollingerBands(candles)
          if (bb.length > 0) {
            const upperLine = chart.addLineSeries({ color: '#8b5cf680', lineWidth: 1, title: 'BB Upper', priceLineVisible: false, lastValueVisible: false })
            upperLine.setData(dedup(bb.map((p) => ({ time: p.time as Time, value: p.upper }))))
            extraSeriesRef.current.push(upperLine)
            const middleLine = chart.addLineSeries({ color: '#8b5cf6', lineWidth: 1, title: 'BB Mid', priceLineVisible: false, lastValueVisible: false, lineStyle: 2 })
            middleLine.setData(dedup(bb.map((p) => ({ time: p.time as Time, value: p.middle }))))
            extraSeriesRef.current.push(middleLine)
            const lowerLine = chart.addLineSeries({ color: '#8b5cf680', lineWidth: 1, title: 'BB Lower', priceLineVisible: false, lastValueVisible: false })
            lowerLine.setData(dedup(bb.map((p) => ({ time: p.time as Time, value: p.lower }))))
            extraSeriesRef.current.push(lowerLine)
          }
          break
        }
      }
    }

    // ── Pane indicators (separate price scales) ──
    const addPaneLine = (pts: { time: number; value: number }[], color: string, scaleId: string, title: string, topMargin: number) => {
      if (pts.length === 0) return
      const s = chart.addLineSeries({ color, lineWidth: 1, title, priceScaleId: scaleId, priceLineVisible: false, lastValueVisible: true })
      s.setData(dedup(pts.map((p) => ({ time: p.time as Time, value: p.value }))))
      chart.priceScale(scaleId).applyOptions({ scaleMargins: { top: topMargin, bottom: 0.02 } })
      extraSeriesRef.current.push(s)
    }

    // Calculate pane stacking margins
    let paneCount = 0
    const paneTop = (idx: number) => {
      // Stack pane indicators in bottom portion of chart
      const paneHeight = 0.12
      return 1 - (paneCount - idx) * paneHeight - 0.02
    }

    // Pre-count panes
    paneCount = panes.length

    panes.forEach((id, idx) => {
      const top = paneTop(idx)
      switch (id) {
        case 'volume': {
          if (rawCandles.some((c) => c.volume > 0)) {
            const volSeries = chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: 'vol' })
            chart.priceScale('vol').applyOptions({ scaleMargins: { top: Math.max(top, 0.75), bottom: 0 } })
            volSeries.setData(dedup(rawCandles.map((c) => ({ time: c.time, value: c.volume, color: c.close >= c.open ? 'rgba(38,166,154,0.35)' : 'rgba(239,83,80,0.35)' }))))
            extraSeriesRef.current.push(volSeries)
          }
          break
        }
        case 'rsi': {
          const pts = rsi(candles)
          addPaneLine(pts, '#f59e0b', 'rsi', 'RSI(14)', top)
          // Overbought/oversold reference lines
          if (pts.length > 0) {
            const ob = chart.addLineSeries({ color: '#ef535040', lineWidth: 1, priceScaleId: 'rsi', priceLineVisible: false, lastValueVisible: false, lineStyle: 2 })
            ob.setData(dedup([{ time: pts[0].time as Time, value: 70 }, { time: pts[pts.length - 1].time as Time, value: 70 }]))
            extraSeriesRef.current.push(ob)
            const os = chart.addLineSeries({ color: '#26a69a40', lineWidth: 1, priceScaleId: 'rsi', priceLineVisible: false, lastValueVisible: false, lineStyle: 2 })
            os.setData(dedup([{ time: pts[0].time as Time, value: 30 }, { time: pts[pts.length - 1].time as Time, value: 30 }]))
            extraSeriesRef.current.push(os)
          }
          break
        }
        case 'macd': {
          const pts = macd(candles)
          if (pts.length > 0) {
            // MACD histogram
            const hist = chart.addHistogramSeries({ priceScaleId: 'macd', priceLineVisible: false, lastValueVisible: false })
            hist.setData(dedup(pts.map((p) => ({ time: p.time as Time, value: p.histogram, color: p.histogram >= 0 ? 'rgba(38,166,154,0.6)' : 'rgba(239,83,80,0.6)' }))))
            chart.priceScale('macd').applyOptions({ scaleMargins: { top, bottom: 0.02 } })
            extraSeriesRef.current.push(hist)
            // MACD line
            const macdLine = chart.addLineSeries({ color: '#3b82f6', lineWidth: 1, priceScaleId: 'macd', priceLineVisible: false, lastValueVisible: false, title: 'MACD' })
            macdLine.setData(dedup(pts.map((p) => ({ time: p.time as Time, value: p.macd }))))
            extraSeriesRef.current.push(macdLine)
            // Signal line
            const sigLine = chart.addLineSeries({ color: '#f97316', lineWidth: 1, priceScaleId: 'macd', priceLineVisible: false, lastValueVisible: false, title: 'Signal' })
            sigLine.setData(dedup(pts.map((p) => ({ time: p.time as Time, value: p.signal }))))
            extraSeriesRef.current.push(sigLine)
          }
          break
        }
        case 'stochastic': {
          const pts = stochastic(candles)
          if (pts.length > 0) {
            const kLine = chart.addLineSeries({ color: '#3b82f6', lineWidth: 1, priceScaleId: 'stoch', priceLineVisible: false, lastValueVisible: true, title: '%K' })
            kLine.setData(dedup(pts.map((p) => ({ time: p.time as Time, value: p.k }))))
            chart.priceScale('stoch').applyOptions({ scaleMargins: { top, bottom: 0.02 } })
            extraSeriesRef.current.push(kLine)
            const dLine = chart.addLineSeries({ color: '#f97316', lineWidth: 1, priceScaleId: 'stoch', priceLineVisible: false, lastValueVisible: true, title: '%D' })
            dLine.setData(dedup(pts.map((p) => ({ time: p.time as Time, value: p.d }))))
            extraSeriesRef.current.push(dLine)
          }
          break
        }
        case 'atr':
          addPaneLine(atr(candles), '#14b8a6', 'atr', 'ATR(14)', top)
          break
        case 'obv':
          addPaneLine(obv(candles), '#6366f1', 'obv', 'OBV', top)
          break
        case 'williamsR':
          addPaneLine(williamsR(candles), '#f43f5e', 'willr', 'W%R(14)', top)
          break
        case 'cci':
          addPaneLine(cci(candles), '#84cc16', 'cci', 'CCI(20)', top)
          break
      }
    })

    // ── Comparison overlays (% change) ──
    if (comparisonData && comparisonData.length > 0) {
      for (const comp of comparisonData) {
        if (!comp.data?.length) continue
        const compCandles = comp.data.map((bar) => ({
          time: (new Date(bar.timestamp).getTime() / 1000) as Time,
          value: bar.close,
        }))
        if (compCandles.length === 0) continue
        // Normalize to % change from first bar
        const firstPrice = compCandles[0].value
        const normalizedData = compCandles.map((c) => ({
          time: c.time,
          value: ((c.value - firstPrice) / firstPrice) * 100,
        }))
        const compSeries = chart.addLineSeries({
          color: comp.color,
          lineWidth: 2,
          title: comp.symbol,
          priceScaleId: 'comparison',
          priceLineVisible: false,
          lastValueVisible: true,
          priceFormat: { type: 'custom', formatter: (p: number) => `${p >= 0 ? '+' : ''}${p.toFixed(2)}%` },
        })
        compSeries.setData(dedup(normalizedData))
        chart.priceScale('comparison').applyOptions({
          scaleMargins: { top: 0.1, bottom: 0.1 },
        })
        extraSeriesRef.current.push(compSeries)
      }
    }

    chart.timeScale().fitContent()
  }, [rawCandles, seriesType, overlays, panes, comparisonData, symbol])

  return (
    <div className="w-full h-full">
      <div ref={chartContainerRef} className="w-full h-full" />
    </div>
  )
}

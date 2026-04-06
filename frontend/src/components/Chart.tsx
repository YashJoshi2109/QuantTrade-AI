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

export type ChartSeriesType = 'candlestick' | 'line' | 'area'

interface ChartProps {
  data: PriceBar[]
  symbol: string
  seriesType?: ChartSeriesType
  /** Moving averages (SMA 20 / EMA 50) — shown on candlesticks only. */
  showMovingAverages?: boolean
}

export default function Chart({
  data,
  symbol,
  seriesType = 'candlestick',
  showMovingAverages = true,
}: ChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const mainSeriesRef = useRef<
    ISeriesApi<'Candlestick'> | ISeriesApi<'Line'> | ISeriesApi<'Area'> | null
  >(null)
  const overlayLineRefs = useRef<ISeriesApi<'Line'>[]>([])

  useEffect(() => {
    if (!chartContainerRef.current) return

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#131722' },
        textColor: '#d1d4dc',
      },
      width: chartContainerRef.current.clientWidth,
      height: chartContainerRef.current.clientHeight,
      grid: {
        vertLines: { color: '#2B2B43' },
        horzLines: { color: '#2B2B43' },
      },
      crosshair: {
        mode: 0,
      },
      rightPriceScale: {
        borderColor: '#485065',
      },
      timeScale: {
        borderColor: '#485065',
        timeVisible: true,
        secondsVisible: false,
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
      overlayLineRefs.current = []
    }
  }, [])

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

    if (seriesType === 'candlestick') {
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

    if (seriesType === 'candlestick') {
      const candleData = data.map((bar) => ({
        time: (new Date(bar.timestamp).getTime() / 1000) as Time,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
      }))
      ;(main as ISeriesApi<'Candlestick'>).setData(candleData)

      if (showMovingAverages && data.length >= 50) {
        const chartData = candleData
        const sma20Data: { time: Time; value: number }[] = []
        for (let i = 19; i < chartData.length; i++) {
          const sum = chartData
            .slice(i - 19, i + 1)
            .reduce((acc, d) => acc + d.close, 0)
          sma20Data.push({
            time: chartData[i].time,
            value: sum / 20,
          })
        }

        const ema50Data: { time: Time; value: number }[] = []
        let ema = chartData[0].close
        const multiplier = 2 / (50 + 1)
        ema50Data.push({ time: chartData[0].time, value: ema })

        for (let i = 1; i < chartData.length; i++) {
          ema = (chartData[i].close - ema) * multiplier + ema
          ema50Data.push({ time: chartData[i].time, value: ema })
        }

        if (sma20Data.length > 0) {
          const s = chart.addLineSeries({
            color: '#3b82f6',
            lineWidth: 2,
            title: 'SMA 20',
          })
          s.setData(sma20Data)
          overlayLineRefs.current.push(s)
        }
        if (ema50Data.length > 0) {
          const s = chart.addLineSeries({
            color: '#f97316',
            lineWidth: 2,
            title: 'EMA 50',
          })
          s.setData(ema50Data)
          overlayLineRefs.current.push(s)
        }
      }
    } else {
      const lineData = data.map((bar) => ({
        time: (new Date(bar.timestamp).getTime() / 1000) as Time,
        value: bar.close,
      }))
      if (seriesType === 'line') {
        ;(main as ISeriesApi<'Line'>).setData(lineData)
      } else {
        ;(main as ISeriesApi<'Area'>).setData(lineData)
      }
    }

    chart.timeScale().fitContent()
  }, [data, seriesType, showMovingAverages, symbol])

  return (
    <div className="w-full h-full">
      <div ref={chartContainerRef} className="w-full h-full" />
    </div>
  )
}

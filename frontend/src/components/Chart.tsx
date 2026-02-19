'use client'

import { useEffect, useRef } from 'react'
import { createChart, ColorType, IChartApi, ISeriesApi } from 'lightweight-charts'
import { PriceBar } from '@/lib/api'

interface ChartProps {
  data: PriceBar[]
  symbol: string
}

export default function Chart({ data, symbol }: ChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candlestickSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const lineSeriesRefs = useRef<ISeriesApi<'Line'>[]>([])

  useEffect(() => {
    if (!chartContainerRef.current) return

    // Create chart
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

    // Create candlestick series
    const candlestickSeries = chart.addCandlestickSeries({
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderVisible: false,
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
    })

    candlestickSeriesRef.current = candlestickSeries

    // Handle resize
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
    }
  }, [])

  useEffect(() => {
    if (!chartRef.current || !candlestickSeriesRef.current) return
    
    // If no data, clear the chart
    if (!data || data.length === 0) {
      if (candlestickSeriesRef.current) {
        try {
          candlestickSeriesRef.current.setData([])
        } catch (e) {
          // Ignore errors when clearing
        }
      }
      return
    }

    const chart = chartRef.current

    // Transform data for lightweight-charts
    const chartData = data.map((bar) => ({
      time: new Date(bar.timestamp).getTime() / 1000 as any,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
    }))

    candlestickSeriesRef.current.setData(chartData)

    // Remove existing line series
    lineSeriesRefs.current.forEach((series) => {
      try {
        chart.removeSeries(series)
      } catch (e) {
        // Series might already be removed
      }
    })
    lineSeriesRefs.current = []

    // Add moving averages if we have enough data
    if (data.length >= 50) {
      // Calculate SMA 20
      const sma20Data: any[] = []
      for (let i = 19; i < chartData.length; i++) {
        const sum = chartData.slice(i - 19, i + 1).reduce((acc, d) => acc + d.close, 0)
        sma20Data.push({
          time: chartData[i].time,
          value: sum / 20,
        })
      }

      // Calculate EMA 50
      const ema50Data: any[] = []
      let ema = chartData[0].close
      const multiplier = 2 / (50 + 1)
      ema50Data.push({ time: chartData[0].time, value: ema })
      
      for (let i = 1; i < chartData.length; i++) {
        ema = (chartData[i].close - ema) * multiplier + ema
        ema50Data.push({ time: chartData[i].time, value: ema })
      }

      // Add SMA 20 (blue)
      if (sma20Data.length > 0) {
        const sma20Series = chart.addLineSeries({
          color: '#3b82f6',
          lineWidth: 2,
          title: 'SMA 20',
        })
        sma20Series.setData(sma20Data)
        lineSeriesRefs.current.push(sma20Series)
      }

      // Add EMA 50 (orange)
      if (ema50Data.length > 0) {
        const ema50Series = chart.addLineSeries({
          color: '#f97316',
          lineWidth: 2,
          title: 'EMA 50',
        })
        ema50Series.setData(ema50Data)
        lineSeriesRefs.current.push(ema50Series)
      }
    }
  }, [data])

  return (
    <div className="w-full h-full">
      <div ref={chartContainerRef} className="w-full h-full" />
    </div>
  )
}

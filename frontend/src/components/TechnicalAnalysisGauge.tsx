'use client'

import { useMemo } from 'react'
import { Indicators, FundamentalsData } from '@/lib/api'
import { isNumber } from '@/lib/format'

/* ────────────────── Signal Colors (strict palette) ────────────────── */
const SIGNAL_COLORS = {
  STRONG_BUY:  '#00C853',
  BUY:         '#2ECC71',
  NEUTRAL:     '#9CA3AF',
  SELL:        '#FF7043',
  STRONG_SELL: '#FF3B30',
} as const

type SignalLevel = 'Strong Buy' | 'Buy' | 'Neutral' | 'Sell' | 'Strong Sell'

interface SignalResult {
  label: SignalLevel
  /** -1 (Strong Sell) → 0 (Neutral) → +1 (Strong Buy) */
  value: number
  color: string
}

/* ────────────────── Signal computation ────────────────── */

function classifyValue(val: number): SignalResult {
  // val expected in [-1, +1]
  if (val >= 0.5)  return { label: 'Strong Buy',  value: val, color: SIGNAL_COLORS.STRONG_BUY }
  if (val >= 0.1)  return { label: 'Buy',          value: val, color: SIGNAL_COLORS.BUY }
  if (val > -0.1)  return { label: 'Neutral',      value: val, color: SIGNAL_COLORS.NEUTRAL }
  if (val > -0.5)  return { label: 'Sell',          value: val, color: SIGNAL_COLORS.SELL }
  return               { label: 'Strong Sell', value: val, color: SIGNAL_COLORS.STRONG_SELL }
}

function computeMovingAverages(
  price: number | undefined,
  indicators: Indicators['indicators'] | undefined,
): SignalResult {
  if (!isNumber(price) || !indicators) return classifyValue(0)

  let buy = 0
  let sell = 0
  let total = 0

  const smas: (number | undefined)[] = [
    indicators.sma_20,
    indicators.sma_50,
    indicators.sma_200,
  ]

  for (const sma of smas) {
    if (!isNumber(sma)) continue
    total++
    if (price > sma) buy++
    else sell++
  }

  if (total === 0) return classifyValue(0)
  // Map buy ratio to [-1, 1]
  const ratio = (buy - sell) / total
  return classifyValue(ratio)
}

function computeTechnicalIndicators(
  price: number | undefined,
  indicators: Indicators['indicators'] | undefined,
): SignalResult {
  if (!indicators) return classifyValue(0)

  let signals: number[] = []

  // RSI
  const rsi = indicators.rsi
  if (isNumber(rsi)) {
    if (rsi > 70) signals.push(-0.8)       // overbought → sell
    else if (rsi > 60) signals.push(-0.3)   // slightly overbought
    else if (rsi > 50) signals.push(0.2)    // mildly bullish
    else if (rsi > 40) signals.push(-0.2)   // mildly bearish
    else if (rsi > 30) signals.push(0.3)    // slightly oversold
    else signals.push(0.8)                  // oversold → buy
  }

  // MACD
  const macd = indicators.macd
  if (macd && isNumber(macd.macd) && isNumber(macd.signal)) {
    const diff = macd.macd - macd.signal
    if (diff > 0) signals.push(0.6)
    else if (diff < 0) signals.push(-0.6)
    else signals.push(0)
  }

  // Bollinger Bands
  const bb = indicators.bollinger_bands
  if (bb && isNumber(bb.upper) && isNumber(bb.lower) && isNumber(bb.middle) && isNumber(price)) {
    const range = bb.upper - bb.lower
    if (range > 0) {
      const pos = (price - bb.lower) / range // 0 (at lower) → 1 (at upper)
      if (pos > 0.9) signals.push(-0.7)      // near upper → sell
      else if (pos > 0.6) signals.push(-0.2)
      else if (pos > 0.4) signals.push(0)
      else if (pos > 0.1) signals.push(0.2)
      else signals.push(0.7)                 // near lower → buy
    }
  }

  if (signals.length === 0) return classifyValue(0)
  const avg = signals.reduce((a, b) => a + b, 0) / signals.length
  return classifyValue(avg)
}

function computeSummary(tech: SignalResult, ma: SignalResult): SignalResult {
  const avg = (tech.value + ma.value) / 2
  return classifyValue(avg)
}

/* ────────────────── SVG Gauge ────────────────── */

interface GaugeProps {
  signal: SignalResult
  title: string
}

function Gauge({ signal, title }: GaugeProps) {
  // Gauge geometry: semicircle from 180° (left) to 0° (right)
  // signal.value: -1 (left, Strong Sell) → +1 (right, Strong Buy)
  const cx = 100
  const cy = 90
  const r = 70

  // Map value [-1, 1] to angle [180, 0] (in degrees)
  const needleAngle = 180 - ((signal.value + 1) / 2) * 180
  const needleRad = (needleAngle * Math.PI) / 180
  const needleLen = 55
  const nx = cx + needleLen * Math.cos(needleRad)
  const ny = cy - needleLen * Math.sin(needleRad)

  // Gradient arc segments (5 zones from Strong Sell to Strong Buy)
  const zones = [
    { start: 180, end: 144, color: SIGNAL_COLORS.STRONG_SELL },
    { start: 144, end: 108, color: SIGNAL_COLORS.SELL },
    { start: 108, end: 72,  color: SIGNAL_COLORS.NEUTRAL },
    { start: 72,  end: 36,  color: SIGNAL_COLORS.BUY },
    { start: 36,  end: 0,   color: SIGNAL_COLORS.STRONG_BUY },
  ]

  const arcPath = (startDeg: number, endDeg: number, radius: number) => {
    const startRad = (startDeg * Math.PI) / 180
    const endRad = (endDeg * Math.PI) / 180
    const x1 = cx + radius * Math.cos(startRad)
    const y1 = cy - radius * Math.sin(startRad)
    const x2 = cx + radius * Math.cos(endRad)
    const y2 = cy - radius * Math.sin(endRad)
    const largeArc = startDeg - endDeg > 180 ? 1 : 0
    return `M ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 0 ${x2} ${y2}`
  }

  return (
    <div className="flex flex-col items-center">
      <div className="text-[11px] font-semibold text-[#A1A1AA] tracking-wide mb-1 uppercase">
        {title}
      </div>
      <svg viewBox="0 0 200 110" className="w-full max-w-[180px]" aria-label={`${title}: ${signal.label}`}>
        {/* Background track */}
        <path
          d={arcPath(180, 0, r)}
          fill="none"
          stroke="#1F2630"
          strokeWidth="14"
          strokeLinecap="round"
        />
        {/* Colored zone arcs */}
        {zones.map((z, i) => (
          <path
            key={i}
            d={arcPath(z.start, z.end, r)}
            fill="none"
            stroke={z.color}
            strokeWidth="14"
            strokeLinecap="butt"
            opacity={0.85}
          />
        ))}
        {/* Zone tick marks */}
        {[180, 144, 108, 72, 36, 0].map((deg) => {
          const rad = (deg * Math.PI) / 180
          const innerR = r - 10
          const outerR = r + 10
          return (
            <line
              key={deg}
              x1={cx + innerR * Math.cos(rad)}
              y1={cy - innerR * Math.sin(rad)}
              x2={cx + outerR * Math.cos(rad)}
              y2={cy - outerR * Math.sin(rad)}
              stroke="#0A0E1A"
              strokeWidth="2"
            />
          )
        })}
        {/* Needle */}
        <line
          x1={cx}
          y1={cy}
          x2={nx}
          y2={ny}
          stroke="#F3F4F6"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        {/* Center dot */}
        <circle cx={cx} cy={cy} r="5" fill="#1F2630" stroke="#F3F4F6" strokeWidth="2" />
      </svg>
      {/* Signal label pill */}
      <div
        className="mt-1 text-xs font-bold px-3 py-1 rounded-md"
        style={{
          backgroundColor: signal.color + '18',
          color: signal.color,
          border: `1px solid ${signal.color}33`,
        }}
      >
        {signal.label}
      </div>
    </div>
  )
}

/* ────────────────── Zone labels row ────────────────── */

function ZoneLabels() {
  const labels: { text: string; color: string }[] = [
    { text: 'Strong\nSell', color: SIGNAL_COLORS.STRONG_SELL },
    { text: 'Sell',          color: SIGNAL_COLORS.SELL },
    { text: 'Neutral',      color: SIGNAL_COLORS.NEUTRAL },
    { text: 'Buy',           color: SIGNAL_COLORS.BUY },
    { text: 'Strong\nBuy',  color: SIGNAL_COLORS.STRONG_BUY },
  ]

  return (
    <div className="flex items-center justify-between w-full max-w-md mx-auto px-2 mt-3">
      {labels.map((l, i) => (
        <div key={i} className="flex flex-col items-center gap-1">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: l.color }} />
          <span className="text-[9px] text-center leading-tight whitespace-pre-line" style={{ color: l.color }}>
            {l.text}
          </span>
        </div>
      ))}
    </div>
  )
}

/* ────────────────── Exported Component ────────────────── */

interface TechnicalAnalysisGaugeProps {
  indicators: Indicators | null
  price: number | undefined
  loading?: boolean
}

export default function TechnicalAnalysisGauge({
  indicators,
  price,
  loading,
}: TechnicalAnalysisGaugeProps) {
  const indData = indicators?.indicators

  const techSignal = useMemo(() => computeTechnicalIndicators(price, indData), [price, indData])
  const maSignal   = useMemo(() => computeMovingAverages(price, indData), [price, indData])
  const summary    = useMemo(() => computeSummary(techSignal, maSignal), [techSignal, maSignal])

  if (loading) {
    return (
      <div className="hud-panel p-5 h-full animate-pulse">
        <div className="h-4 w-40 bg-[#1F2630] rounded mb-6" />
        <div className="grid grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex flex-col items-center gap-2">
              <div className="w-[140px] h-[80px] bg-[#1F2630] rounded" />
              <div className="h-3 w-16 bg-[#1F2630] rounded" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="hud-panel p-5 h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-bold text-[#F3F4F6] tracking-wide">
          Technical Analysis
        </h3>
        <span className="text-[10px] font-mono text-[#6B7280] bg-[#1F2630] px-2 py-0.5 rounded">
          30 Min
        </span>
      </div>

      {/* Subtitle row: Summary label */}
      <div className="text-center mb-2">
        <span className="text-[11px] font-semibold text-[#A1A1AA] tracking-wider uppercase">
          Summary
        </span>
      </div>

      {/* Gauges */}
      <div className="grid grid-cols-3 gap-2">
        <Gauge signal={techSignal} title="Oscillators" />
        <Gauge signal={summary}    title="Summary" />
        <Gauge signal={maSignal}   title="Moving Averages" />
      </div>

      {/* Zone legend */}
      <ZoneLabels />

      {/* Signal detail counts */}
      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <SignalCounts label="Oscillators" signal={techSignal} indicators={indData} price={price} type="oscillators" />
        <SignalCounts label="Summary" signal={summary} indicators={indData} price={price} type="summary" />
        <SignalCounts label="Moving Avg" signal={maSignal} indicators={indData} price={price} type="ma" />
      </div>
    </div>
  )
}

/* ────────────────── Signal detail mini-counts ────────────────── */

interface SignalCountsProps {
  label: string
  signal: SignalResult
  indicators: Indicators['indicators'] | undefined
  price: number | undefined
  type: 'oscillators' | 'ma' | 'summary'
}

function SignalCounts({ signal, indicators, price, type }: SignalCountsProps) {
  const counts = useMemo(() => {
    if (!indicators) return { buy: 0, neutral: 0, sell: 0 }

    if (type === 'ma') {
      let buy = 0, sell = 0
      const smas = [indicators.sma_20, indicators.sma_50, indicators.sma_200]
      for (const s of smas) {
        if (!isNumber(s) || !isNumber(price)) continue
        if (price > s) buy++
        else sell++
      }
      return { buy, neutral: 0, sell }
    }

    if (type === 'oscillators') {
      let buy = 0, sell = 0, neutral = 0
      // RSI
      if (isNumber(indicators.rsi)) {
        if (indicators.rsi > 60) sell++
        else if (indicators.rsi < 40) buy++
        else neutral++
      }
      // MACD
      if (indicators.macd && isNumber(indicators.macd.macd) && isNumber(indicators.macd.signal)) {
        if (indicators.macd.macd > indicators.macd.signal) buy++
        else sell++
      }
      // BB
      if (
        indicators.bollinger_bands &&
        isNumber(indicators.bollinger_bands.upper) &&
        isNumber(indicators.bollinger_bands.lower) &&
        isNumber(price)
      ) {
        const range = indicators.bollinger_bands.upper - indicators.bollinger_bands.lower
        if (range > 0) {
          const pos = (price - indicators.bollinger_bands.lower) / range
          if (pos > 0.7) sell++
          else if (pos < 0.3) buy++
          else neutral++
        }
      }
      return { buy, neutral, sell }
    }

    // Summary: combine
    let buy = 0, sell = 0, neutral = 0
    const smas = [indicators.sma_20, indicators.sma_50, indicators.sma_200]
    for (const s of smas) {
      if (!isNumber(s) || !isNumber(price)) continue
      if (price > s) buy++
      else sell++
    }
    if (isNumber(indicators.rsi)) {
      if (indicators.rsi > 60) sell++
      else if (indicators.rsi < 40) buy++
      else neutral++
    }
    if (indicators.macd && isNumber(indicators.macd.macd) && isNumber(indicators.macd.signal)) {
      if (indicators.macd.macd > indicators.macd.signal) buy++
      else sell++
    }
    return { buy, neutral, sell }
  }, [indicators, price, type])

  return (
    <div className="flex items-center justify-center gap-3 text-[10px] font-mono">
      <div className="flex flex-col items-center">
        <span className="text-[#FF3B30] font-bold">{counts.sell}</span>
        <span className="text-[#6B7280]">Sell</span>
      </div>
      <div className="flex flex-col items-center">
        <span className="text-[#9CA3AF] font-bold">{counts.neutral}</span>
        <span className="text-[#6B7280]">Neutral</span>
      </div>
      <div className="flex flex-col items-center">
        <span className="text-[#00C853] font-bold">{counts.buy}</span>
        <span className="text-[#6B7280]">Buy</span>
      </div>
    </div>
  )
}

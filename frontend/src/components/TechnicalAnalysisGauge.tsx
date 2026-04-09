'use client'

import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { Indicators } from '@/lib/api'
import { isNumber } from '@/lib/format'

/* ────────────────── Premium Signal Colors (Glowing Palette) ────────────────── */
const SIGNAL_COLORS = {
  STRONG_BUY:  '#00FF88', // Electric Emerald
  BUY:         '#00D4FF', // Cyan Glow
  NEUTRAL:     '#94A3B8', // Slate Grey
  SELL:        '#FF9F43', // Warning Orange
  STRONG_SELL: '#FF3366', // Neon Crimson
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
  const ratio = (buy - sell) / total
  return classifyValue(ratio)
}

function computeTechnicalIndicators(
  price: number | undefined,
  indicators: Indicators['indicators'] | undefined,
): SignalResult {
  if (!indicators) return classifyValue(0)

  let signals: number[] = []

  const rsi = indicators.rsi
  if (isNumber(rsi)) {
    if (rsi > 70) signals.push(-0.8)
    else if (rsi > 60) signals.push(-0.3)
    else if (rsi > 50) signals.push(0.2)
    else if (rsi > 40) signals.push(-0.2)
    else if (rsi > 30) signals.push(0.3)
    else signals.push(0.8)
  }

  const macd = indicators.macd
  if (macd && isNumber(macd.macd) && isNumber(macd.signal)) {
    const diff = macd.macd - macd.signal
    if (diff > 0) signals.push(0.6)
    else if (diff < 0) signals.push(-0.6)
    else signals.push(0)
  }

  const bb = indicators.bollinger_bands
  if (bb && isNumber(bb.upper) && isNumber(bb.lower) && isNumber(bb.middle) && isNumber(price)) {
    const range = bb.upper - bb.lower
    if (range > 0) {
      const pos = (price - bb.lower) / range
      if (pos > 0.9) signals.push(-0.7)
      else if (pos > 0.6) signals.push(-0.2)
      else if (pos > 0.4) signals.push(0)
      else if (pos > 0.1) signals.push(0.2)
      else signals.push(0.7)
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

/* ────────────────── SVG Premium Animated Gauge ────────────────── */

interface GaugeProps {
  signal: SignalResult
  title: string
  delay?: number
}

function Gauge({ signal, title, delay = 0 }: GaugeProps) {
  const cx = 100
  const cy = 90
  const r = 70

  const needleAngle = 180 - ((signal.value + 1) / 2) * 180

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
    <div className="flex flex-col items-center relative group">
      <div className="text-[10px] font-bold text-slate-400 tracking-widest mb-2 uppercase drop-shadow-md">
        {title}
      </div>
      
      <div className="relative w-full max-w-[180px]">
        <svg viewBox="0 0 200 110" className="w-full drop-shadow-2xl overflow-visible">
          <defs>
            <filter id={`glow-${title.replace(/\s+/g, '')}`}>
              <feGaussianBlur stdDeviation="3.5" result="coloredBlur"/>
              <feMerge>
                <feMergeNode in="coloredBlur"/>
                <feMergeNode in="SourceGraphic"/>
              </feMerge>
            </filter>
            <linearGradient id="needle-grad" x1="0%" y1="100%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#CBD5E1" />
              <stop offset="100%" stopColor="#FFFFFF" />
            </linearGradient>
          </defs>

          {/* Premium Glass Track */}
          <path
            d={arcPath(180, 0, r)}
            fill="none"
            stroke="rgba(30,41,59,0.5)"
            strokeWidth="14"
            strokeLinecap="round"
          />

          {/* Animated Glow Arcs */}
          {zones.map((z, i) => (
            <motion.path
              key={i}
              d={arcPath(z.start, z.end, r)}
              fill="none"
              stroke={z.color}
              strokeWidth="14"
              strokeLinecap="butt"
              opacity={0.8}
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 0.8 }}
              transition={{ duration: 1.2, delay: delay + i * 0.1, ease: 'easeOut' }}
              filter={signal.color === z.color ? `url(#glow-${title.replace(/\s+/g, '')})` : undefined}
            />
          ))}

          {/* Tick marks */}
          {[180, 144, 108, 72, 36, 0].map((deg) => {
            const rad = (deg * Math.PI) / 180
            return (
              <line
                key={deg}
                x1={cx + (r - 10) * Math.cos(rad)}
                y1={cy - (r - 10) * Math.sin(rad)}
                x2={cx + (r + 10) * Math.cos(rad)}
                y2={cy - (r + 10) * Math.sin(rad)}
                stroke="#020617"
                strokeWidth="2.5"
              />
            )
          })}

          {/* Animated Needle */}
          <motion.g
            initial={{ rotate: -90 }}
            animate={{ rotate: 90 - needleAngle }}
            transition={{ duration: 1.5, delay: delay + 0.5, type: 'spring', bounce: 0.4 }}
            style={{ originX: '100px', originY: '90px' }}
          >
            <line
              x1={cx}
              y1={cy}
              x2={cx}
              y2={cy - 55}
              stroke="url(#needle-grad)"
              strokeWidth="3.5"
              strokeLinecap="round"
            />
            {/* Center Hub */}
            <circle cx={cx} cy={cy} r="6" fill="#0F172A" stroke="#FFFFFF" strokeWidth="2.5" />
          </motion.g>
        </svg>

        {/* Floating Glowing Pill */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: delay + 1.2 }}
          className="absolute -bottom-2 left-1/2 -translate-x-1/2 text-[11px] font-extrabold px-4 py-1.5 rounded-full backdrop-blur-md shadow-lg"
          style={{
            backgroundColor: `${signal.color}15`,
            color: signal.color,
            border: `1px solid ${signal.color}40`,
            boxShadow: `0 0 15px ${signal.color}20`,
          }}
        >
          {signal.label}
        </motion.div>
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
    <div className="flex items-center justify-between w-full max-w-md mx-auto px-4 mt-6">
      {labels.map((l, i) => (
        <div key={i} className="flex flex-col items-center gap-1.5 transition-transform hover:scale-110">
          <div className="w-2.5 h-2.5 rounded-full shadow-sm" style={{ backgroundColor: l.color, boxShadow: `0 0 8px ${l.color}` }} />
          <span className="text-[10px] font-bold text-center leading-tight whitespace-pre-line" style={{ color: l.color }}>
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
      <div className="hud-panel p-6 h-full bg-slate-900/50 flex flex-col justify-center">
        <div className="h-4 w-40 bg-slate-800/80 rounded mb-8 animate-pulse" />
        <div className="grid grid-cols-3 gap-6">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex flex-col items-center gap-4 animate-pulse">
              <div className="w-[140px] h-[70px] bg-slate-800/60 rounded-t-full" />
              <div className="h-4 w-20 bg-slate-800/60 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="hud-panel p-6 h-full relative overflow-hidden group">
      {/* Dynamic Background Gradient */}
      <div 
        className="absolute inset-0 opacity-10 transition-colors duration-1000 ease-in-out"
        style={{
          background: `radial-gradient(circle at top right, ${summary.color}, transparent 60%)`
        }}
      />

      <div className="relative z-10">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-extrabold text-white tracking-wider flex items-center gap-2 drop-shadow-md">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-[#00D4FF]"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>
            Technical Analysis
          </h3>
          <span className="text-[10px] font-mono font-bold text-slate-300 bg-slate-800/80 border border-slate-700 px-2.5 py-1 rounded-md shadow-inner">
            LIVE
          </span>
        </div>

        <div className="grid grid-cols-3 gap-2 mt-6">
          <Gauge signal={techSignal} title="Oscillators" delay={0.1} />
          <Gauge signal={summary}    title="Summary" delay={0.3} />
          <Gauge signal={maSignal}   title="Moving Averages" delay={0.5} />
        </div>

        <ZoneLabels />

        <div className="mt-8 grid grid-cols-3 gap-3">
          <SignalCounts signal={techSignal} indicators={indData} price={price} type="oscillators" />
          <SignalCounts signal={summary} indicators={indData} price={price} type="summary" />
          <SignalCounts signal={maSignal} indicators={indData} price={price} type="ma" />
        </div>
      </div>
    </div>
  )
}

/* ────────────────── Signal detail mini-counts ────────────────── */

interface SignalCountsProps {
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
      if (isNumber(indicators.rsi)) {
        if (indicators.rsi > 60) sell++
        else if (indicators.rsi < 40) buy++
        else neutral++
      }
      if (indicators.macd && isNumber(indicators.macd.macd) && isNumber(indicators.macd.signal)) {
        if (indicators.macd.macd > indicators.macd.signal) buy++
        else sell++
      }
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
    <div className="flex items-center justify-center gap-3 bg-slate-800/40 p-2.5 rounded-xl border border-slate-700/50 backdrop-blur-sm shadow-inner mt-2">
      <div className="flex flex-col items-center min-w-[28px]">
        <span className="text-[#FF3366] font-extrabold text-sm drop-shadow-[0_0_5px_rgba(255,51,102,0.4)]">{counts.sell}</span>
      </div>
      <div className="flex flex-col items-center min-w-[28px]">
        <span className="text-slate-400 font-extrabold text-sm">{counts.neutral}</span>
      </div>
      <div className="flex flex-col items-center min-w-[28px]">
        <span className="text-[#00FF88] font-extrabold text-sm drop-shadow-[0_0_5px_rgba(0,255,136,0.4)]">{counts.buy}</span>
      </div>
    </div>
  )
}

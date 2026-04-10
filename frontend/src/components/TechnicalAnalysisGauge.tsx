'use client'

import { useId, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Activity, Minus, Radio, TrendingDown, TrendingUp } from 'lucide-react'
import { Indicators } from '@/lib/api'
import { isNumber } from '@/lib/format'

/* ────────────────── Premium Signal Colors (Glowing Palette) ────────────────── */
const SIGNAL_COLORS = {
  STRONG_BUY: '#00FF88',
  BUY: '#00D4FF',
  NEUTRAL: '#94A3B8',
  SELL: '#FF9F43',
  STRONG_SELL: '#FF3366',
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
  if (val >= 0.5) return { label: 'Strong Buy', value: val, color: SIGNAL_COLORS.STRONG_BUY }
  if (val >= 0.1) return { label: 'Buy', value: val, color: SIGNAL_COLORS.BUY }
  if (val > -0.1) return { label: 'Neutral', value: val, color: SIGNAL_COLORS.NEUTRAL }
  if (val > -0.5) return { label: 'Sell', value: val, color: SIGNAL_COLORS.SELL }
  return { label: 'Strong Sell', value: val, color: SIGNAL_COLORS.STRONG_SELL }
}

function computeMovingAverages(
  price: number | undefined,
  indicators: Indicators['indicators'] | undefined,
): SignalResult {
  if (!isNumber(price) || !indicators) return classifyValue(0)

  let buy = 0
  let sell = 0
  let total = 0

  const smas: (number | undefined)[] = [indicators.sma_20, indicators.sma_50, indicators.sma_200]

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

  const signals: number[] = []

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
  subtitle?: string
  delay?: number
}

function Gauge({ signal, title, subtitle, delay = 0 }: GaugeProps) {
  const reactId = useId().replace(/:/g, '')
  const filterId = `glow-${reactId}`
  const needleGradId = `needle-grad-${reactId}`
  const trackGradId = `track-${reactId}`

  const cx = 100
  const cy = 94
  const rTrack = 62
  const rColor = 56
  const needleLen = 46
  /** Semicircle: sell (left) = -90°, buy (right) = +90°, neutral = 0° (up) */
  const needleRotate = signal.value * 90
  const biasScore = Math.round(signal.value * 50)

  const zones = [
    { start: 180, end: 144, color: SIGNAL_COLORS.STRONG_SELL },
    { start: 144, end: 108, color: SIGNAL_COLORS.SELL },
    { start: 108, end: 72, color: SIGNAL_COLORS.NEUTRAL },
    { start: 72, end: 36, color: SIGNAL_COLORS.BUY },
    { start: 36, end: 0, color: SIGNAL_COLORS.STRONG_BUY },
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

  const dialTicks = [180, 135, 90, 45, 0]

  return (
    <div className="flex flex-col items-center relative group rounded-xl bg-slate-950/40 border border-slate-700/35 px-2 pt-3 pb-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] transition-colors duration-500 hover:border-slate-600/45">
      <div className="text-center mb-1">
        <div className="text-[10px] font-bold text-slate-400 tracking-[0.18em] uppercase">{title}</div>
        {subtitle ? <div className="text-[9px] text-slate-500 mt-0.5 leading-snug px-1">{subtitle}</div> : null}
      </div>

      <div className="relative w-full max-w-[188px]">
        <svg
          viewBox="0 0 200 108"
          className="w-full overflow-hidden"
          role="img"
          aria-label={`${title}: ${signal.label}, bias ${biasScore >= 0 ? '+' : ''}${biasScore}`}
        >
          <defs>
            <linearGradient id={trackGradId} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#020617" />
              <stop offset="50%" stopColor="#0f172a" />
              <stop offset="100%" stopColor="#020617" />
            </linearGradient>
            <filter id={filterId}>
              <feGaussianBlur stdDeviation="2.5" result="coloredBlur" />
              <feMerge>
                <feMergeNode in="coloredBlur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <linearGradient id={needleGradId} x1="0%" y1="100%" x2="0%" y2="0%">
              <stop offset="0%" stopColor="#64748b" />
              <stop offset="55%" stopColor="#f1f5f9" />
              <stop offset="100%" stopColor="#ffffff" />
            </linearGradient>
          </defs>

          {/* Recessed track — reads as one dark slot, not a gray ring */}
          <path
            d={arcPath(180, 0, rTrack)}
            fill="none"
            stroke={`url(#${trackGradId})`}
            strokeWidth="20"
            strokeLinecap="round"
            opacity={0.92}
          />

          {zones.map((z, i) => (
            <motion.path
              key={i}
              d={arcPath(z.start, z.end, rColor)}
              fill="none"
              stroke={z.color}
              strokeWidth="9"
              strokeLinecap="butt"
              opacity={0.88}
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 0.88 }}
              transition={{ duration: 1.05, delay: delay + i * 0.08, ease: [0.22, 1, 0.36, 1] }}
              filter={signal.color === z.color ? `url(#${filterId})` : undefined}
            />
          ))}

          {dialTicks.map((deg) => {
            const rad = (deg * Math.PI) / 180
            const tx = cx + (rColor - 2) * Math.cos(rad)
            const ty = cy - (rColor - 2) * Math.sin(rad)
            return (
              <circle
                key={deg}
                cx={tx}
                cy={ty}
                r={deg === 90 ? 2.2 : 1.5}
                fill={deg === 90 ? 'rgba(148,163,184,0.5)' : 'rgba(51,65,85,0.85)'}
              />
            )
          })}

          <g transform={`translate(${cx} ${cy})`}>
            <motion.g
              style={{ transformOrigin: '0px 0px' }}
              initial={{ rotate: -90 }}
              animate={{ rotate: needleRotate }}
              transition={{
                type: 'spring',
                stiffness: 118,
                damping: 16,
                mass: 0.85,
                delay: delay + 0.2,
              }}
            >
              <path
                d={`M -2.2 1.5 L 0 ${-needleLen} L 2.2 1.5 Z`}
                fill={`url(#${needleGradId})`}
                stroke="rgba(255,255,255,0.35)"
                strokeWidth="0.5"
                strokeLinejoin="round"
              />
              <circle r="8" fill="#070b12" stroke="rgba(226,232,240,0.9)" strokeWidth="2" />
              <circle r="3.5" fill={signal.color} opacity={0.9} />
            </motion.g>
          </g>
        </svg>

        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: delay + 0.65 }}
          className="mt-0.5 flex flex-col items-center gap-1"
        >
          <div className="flex items-baseline justify-center gap-1.5">
            <span className="text-[9px] font-mono text-slate-500 uppercase tracking-wider">Bias</span>
            <span className="text-xs font-black tabular-nums text-slate-200">
              {biasScore >= 0 ? '+' : ''}
              {biasScore}
            </span>
          </div>
          <div
            className="text-[10px] font-extrabold px-3 py-1 rounded-full backdrop-blur-md max-w-[min(100%,12rem)] truncate text-center border"
            style={{
              backgroundColor: `${signal.color}14`,
              color: signal.color,
              borderColor: `${signal.color}40`,
              boxShadow: `0 0 14px ${signal.color}18`,
            }}
          >
            {signal.label}
          </div>
        </motion.div>
      </div>
    </div>
  )
}

/* ────────────────── Zone labels row ────────────────── */

function ZoneLabels() {
  const labels: { text: string; color: string }[] = [
    { text: 'Strong\nSell', color: SIGNAL_COLORS.STRONG_SELL },
    { text: 'Sell', color: SIGNAL_COLORS.SELL },
    { text: 'Neutral', color: SIGNAL_COLORS.NEUTRAL },
    { text: 'Buy', color: SIGNAL_COLORS.BUY },
    { text: 'Strong\nBuy', color: SIGNAL_COLORS.STRONG_BUY },
  ]

  return (
    <div
      className="flex items-stretch justify-between w-full max-w-md mx-auto px-1 sm:px-4 mt-5 gap-0.5 sm:gap-1"
      aria-hidden
    >
      {labels.map((l, i) => (
        <div
          key={i}
          className="flex flex-col items-center gap-1 min-w-0 flex-1 transition-transform hover:scale-105"
        >
          <div
            className="w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full shrink-0"
            style={{ backgroundColor: l.color, boxShadow: `0 0 8px ${l.color}` }}
          />
          <span
            className="text-[8px] sm:text-[10px] font-bold text-center leading-tight whitespace-pre-line"
            style={{ color: l.color }}
          >
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
  const maSignal = useMemo(() => computeMovingAverages(price, indData), [price, indData])
  const summary = useMemo(() => computeSummary(techSignal, maSignal), [techSignal, maSignal])

  const panelId = useId()

  if (loading) {
    return (
      <div className="hud-panel p-6 h-full bg-slate-900/50 flex flex-col justify-center min-h-[320px]">
        <div className="h-4 w-48 bg-slate-800/80 rounded mb-4 animate-pulse" />
        <div className="h-16 w-full bg-slate-800/40 rounded-xl mb-6 animate-pulse" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex flex-col items-center gap-4 animate-pulse rounded-xl border border-slate-800/80 p-4">
              <div className="w-[140px] h-[70px] bg-slate-800/60 rounded-t-full" />
              <div className="h-4 w-20 bg-slate-800/60 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <section
      className="hud-panel p-5 sm:p-6 h-full relative overflow-hidden group noise"
      aria-labelledby={`${panelId}-heading`}
    >
      {/* Slow conic wash — “magic” ambient motion */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[140%] h-[140%] opacity-[0.11]"
        style={{
          background: `conic-gradient(from 0deg, transparent 0%, ${summary.color} 18%, transparent 42%, transparent 100%)`,
        }}
        animate={{ rotate: 360 }}
        transition={{ duration: 28, repeat: Infinity, ease: 'linear' }}
      />

      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.14] transition-colors duration-1000 ease-out"
        style={{
          background: `
            radial-gradient(ellipse 85% 70% at 100% 0%, ${summary.color} 0%, transparent 55%),
            radial-gradient(ellipse 60% 50% at 0% 100%, rgba(0, 212, 255, 0.35) 0%, transparent 50%)
          `,
        }}
      />

      <div className="ta-gauge-magic-sheen" aria-hidden />

      <div className="relative z-10 flex flex-col gap-5">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <h3
              id={`${panelId}-heading`}
              className="text-base font-extrabold text-white tracking-wide flex items-center gap-2 drop-shadow-md"
            >
              <Activity className="w-[18px] h-[18px] text-[#00D4FF] shrink-0" aria-hidden />
              Technical analysis
            </h3>
            <p className="text-[11px] text-slate-500 mt-1 max-w-md leading-relaxed">
              Gauges blend RSI, MACD, Bollinger position, and SMA alignment into a single readable bias.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-40" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            <span className="text-[10px] font-mono font-bold text-slate-200 bg-slate-800/90 border border-slate-600/60 px-2.5 py-1 rounded-md shadow-inner tracking-wide">
              LIVE
            </span>
          </div>
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={summary.label}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            className="rounded-xl border border-slate-700/50 bg-slate-950/40 backdrop-blur-sm px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
          >
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
                <Radio className="w-3.5 h-3.5 text-slate-400" aria-hidden />
                Composite signal
              </div>
              <div
                className="text-xl sm:text-2xl font-black tracking-tight"
                style={{
                  color: summary.color,
                  textShadow: `0 0 28px ${summary.color}33`,
                }}
              >
                {summary.label}
              </div>
            </div>
            <p className="text-[11px] text-slate-500 mt-2 leading-snug border-t border-slate-700/40 pt-2">
              Mid-gauge is the weighted blend; side gauges isolate oscillators vs. moving-average trend.
            </p>
          </motion.div>
        </AnimatePresence>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-2">
          <Gauge
            signal={techSignal}
            title="Oscillators"
            subtitle="RSI · MACD · Bands"
            delay={0.1}
          />
          <Gauge signal={summary} title="Summary" subtitle="Blended bias" delay={0.3} />
          <Gauge signal={maSignal} title="Moving averages" subtitle="Price vs SMAs" delay={0.5} />
        </div>

        <ZoneLabels />

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <SignalCounts indicators={indData} price={price} type="oscillators" />
          <SignalCounts indicators={indData} price={price} type="summary" />
          <SignalCounts indicators={indData} price={price} type="ma" />
        </div>
      </div>
    </section>
  )
}

/* ────────────────── Signal detail mini-counts ────────────────── */

interface SignalCountsProps {
  indicators: Indicators['indicators'] | undefined
  price: number | undefined
  type: 'oscillators' | 'ma' | 'summary'
}

function SignalCounts({ indicators, price, type }: SignalCountsProps) {
  const counts = useMemo(() => {
    if (!indicators) return { buy: 0, neutral: 0, sell: 0 }

    if (type === 'ma') {
      let buy = 0,
        sell = 0
      const smas = [indicators.sma_20, indicators.sma_50, indicators.sma_200]
      for (const s of smas) {
        if (!isNumber(s) || !isNumber(price)) continue
        if (price > s) buy++
        else sell++
      }
      return { buy, neutral: 0, sell }
    }

    if (type === 'oscillators') {
      let buy = 0,
        sell = 0,
        neutral = 0
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

    let buy = 0,
      sell = 0,
      neutral = 0
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

  const typeLabel =
    type === 'oscillators' ? 'Oscillator votes' : type === 'ma' ? 'MA alignment' : 'Mixed tally'

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[9px] uppercase tracking-wider text-slate-500 font-semibold text-center">
        {typeLabel}
      </span>
      <div className="flex items-center justify-center gap-2 sm:gap-3 bg-slate-800/35 p-2.5 rounded-xl border border-slate-700/45 backdrop-blur-sm shadow-inner">
        <div className="flex flex-col items-center min-w-[36px] gap-0.5">
          <TrendingDown className="w-3.5 h-3.5 text-[#FF3366]/80" aria-hidden />
          <span className="text-[9px] text-slate-500 font-medium">Sell</span>
          <span className="text-[#FF3366] font-extrabold text-sm tabular-nums drop-shadow-[0_0_5px_rgba(255,51,102,0.35)]">
            {counts.sell}
          </span>
        </div>
        <div className="flex flex-col items-center min-w-[36px] gap-0.5">
          <Minus className="w-3.5 h-3.5 text-slate-500" aria-hidden />
          <span className="text-[9px] text-slate-500 font-medium">Neutral</span>
          <span className="text-slate-400 font-extrabold text-sm tabular-nums">{counts.neutral}</span>
        </div>
        <div className="flex flex-col items-center min-w-[36px] gap-0.5">
          <TrendingUp className="w-3.5 h-3.5 text-[#00FF88]/80" aria-hidden />
          <span className="text-[9px] text-slate-500 font-medium">Buy</span>
          <span className="text-[#00FF88] font-extrabold text-sm tabular-nums drop-shadow-[0_0_5px_rgba(0,255,136,0.35)]">
            {counts.buy}
          </span>
        </div>
      </div>
    </div>
  )
}

'use client'

import { useId, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Activity, Minus, Radio, TrendingDown, TrendingUp } from 'lucide-react'
import { Indicators } from '@/lib/api'
import { isNumber } from '@/lib/format'
import { AnimatedRadialChart } from '@/components/ui/animated-radial-chart'

/* ────────────────── Premium Signal Colors (Glowing Palette) ────────────────── */
const SIGNAL_COLORS = {
  STRONG_BUY: '#00FF88',
  BUY: '#00D4FF',
  NEUTRAL: '#94A3B8',
  SELL: '#FF9F43',
  STRONG_SELL: '#FF3366',
} as const

type SignalLevel = 'Bullish' | 'Buy' | 'Neutral' | 'Sell' | 'Bearish'

interface SignalResult {
  label: SignalLevel
  /** -1 (Bearish) → 0 (Neutral) → +1 (Bullish) */
  value: number
  color: string
}

/* ────────────────── Signal computation ────────────────── */

function classifyValue(val: number): SignalResult {
  if (val >= 0.5) return { label: 'Bullish', value: val, color: SIGNAL_COLORS.STRONG_BUY }
  if (val >= 0.1) return { label: 'Buy', value: val, color: SIGNAL_COLORS.BUY }
  if (val > -0.1) return { label: 'Neutral', value: val, color: SIGNAL_COLORS.NEUTRAL }
  if (val > -0.5) return { label: 'Sell', value: val, color: SIGNAL_COLORS.SELL }
  return { label: 'Bearish', value: val, color: SIGNAL_COLORS.STRONG_SELL }
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

/* ────────────────── Gradient palette per signal level ────────────────── */

const SIGNAL_GRADIENTS: Record<string, [string, string]> = {
  [SIGNAL_COLORS.STRONG_BUY]:  ['#059669', '#00FF88'],
  [SIGNAL_COLORS.BUY]:         ['#0284c7', '#00D4FF'],
  [SIGNAL_COLORS.NEUTRAL]:     ['#475569', '#94A3B8'],
  [SIGNAL_COLORS.SELL]:        ['#c2410c', '#FF9F43'],
  [SIGNAL_COLORS.STRONG_SELL]: ['#be123c', '#FF3366'],
}

/* ────────────────── Radial-chart-powered Gauge ────────────────── */

interface GaugeProps {
  signal: SignalResult
  title: string
  subtitle?: string
  delay?: number
}

function Gauge({ signal, title, subtitle, delay = 0 }: GaugeProps) {
  const pct = ((signal.value + 1) / 2) * 100
  const biasScore = Math.round(signal.value * 50)
  const gradient = SIGNAL_GRADIENTS[signal.color] ?? ['#475569', '#94A3B8']

  return (
    <div className="flex flex-col items-center relative rounded-xl bg-slate-950/40 border border-slate-700/35 px-2 pt-3 pb-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] transition-colors duration-500 hover:border-slate-600/45">
      <div className="text-center mb-0.5">
        <div className="text-[10px] font-bold text-slate-400 tracking-[0.18em] uppercase">{title}</div>
        {subtitle && <div className="text-[9px] text-slate-500 mt-0.5 leading-snug px-1">{subtitle}</div>}
      </div>

      <div className="w-full flex justify-center -mb-2">
        <AnimatedRadialChart
          value={pct}
          size={160}
          strokeWidth={14}
          showLabels={false}
          duration={1.6}
          gradientColors={gradient}
          valueColor={signal.color}
          centerLabel={signal.label}
          bottomLabel={`bias ${biasScore >= 0 ? '+' : ''}${biasScore}`}
        />
      </div>
    </div>
  )
}

/* ────────────────── Zone labels row ────────────────── */

function ZoneLabels() {
  const labels: { text: string; color: string }[] = [
    { text: 'Bearish', color: SIGNAL_COLORS.STRONG_SELL },
    { text: 'Sell', color: SIGNAL_COLORS.SELL },
    { text: 'Neutral', color: SIGNAL_COLORS.NEUTRAL },
    { text: 'Buy', color: SIGNAL_COLORS.BUY },
    { text: 'Bullish', color: SIGNAL_COLORS.STRONG_BUY },
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

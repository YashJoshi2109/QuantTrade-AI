'use client'

/**
 * QuantTrade AI — Ideas Lab (Pro)
 * AI-powered trade idea generation with live market scanning
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import AppLayout from '@/components/AppLayout'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Sparkles, TrendingUp, TrendingDown, RefreshCw, Activity,
  Target, Shield, Zap, ChevronDown, ChevronUp, BarChart3,
  Clock, Crosshair, AlertTriangle, Layers, ArrowUpRight,
  ArrowDownRight, Flame, Brain,
} from 'lucide-react'
import MobileLayout from '@/components/layout/MobileLayout'
import BottomNav from '@/components/layout/BottomNav'
import { getToken } from '@/lib/auth'
import {
  generateIdeas, getTrendingIdeas,
  fetchBatchLoad, refreshIndex,
  type TradeIdea, type IdeasResponse,
  type IndexDefinition, type IndexSnapshot, type RegimeData,
} from '@/lib/api'

// ── Types ────────────────────────────────────────────────────────────────────

type Sentiment = 'all' | 'bullish' | 'bearish'
type Timeframe = 'all' | 'intraday' | 'swing' | 'position'

const SECTORS = [
  'All Sectors', 'Technology', 'Healthcare', 'Financials',
  'Consumer', 'Energy', 'Industrials',
]

const TIMEFRAME_MAP: Record<string, string> = {
  intraday: 'Intraday',
  swing: 'Swing 1-5d',
  position: 'Position 1-4w',
}

// ── AI Basket Loader (engaging animated loader) ─────────────────────────────

const LOADER_STEPS = [
  { label: 'Scanning market universe', icon: '🔍', duration: 2000 },
  { label: 'Detecting market regime', icon: '📊', duration: 1800 },
  { label: 'Computing factor scores', icon: '🧮', duration: 2200 },
  { label: 'Analyzing 166 stocks across 10 sectors', icon: '📈', duration: 2500 },
  { label: 'Building AI baskets', icon: '🧠', duration: 2000 },
  { label: 'Running risk analysis', icon: '🛡️', duration: 1500 },
  { label: 'Almost ready...', icon: '✨', duration: 3000 },
]

function BasketLoader() {
  const [step, setStep] = useState(0)
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    const totalDuration = LOADER_STEPS.reduce((s, l) => s + l.duration, 0)
    let elapsed = 0
    const interval = setInterval(() => {
      elapsed += 100
      setProgress(Math.min((elapsed / totalDuration) * 100, 95))

      let acc = 0
      for (let i = 0; i < LOADER_STEPS.length; i++) {
        acc += LOADER_STEPS[i].duration
        if (elapsed < acc) { setStep(i); break }
      }
    }, 100)
    return () => clearInterval(interval)
  }, [])

  const currentStep = LOADER_STEPS[step] || LOADER_STEPS[LOADER_STEPS.length - 1]

  return (
    <div className="flex flex-col items-center justify-center py-16">
      {/* Stock chart GIF animation */}
      <motion.div
        className="relative mb-6"
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
      >
        <div className="relative w-48 h-32 rounded-2xl overflow-hidden border border-violet-500/20 shadow-lg shadow-violet-500/10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/basket-loader.gif"
            alt="Loading baskets"
            className="w-full h-full object-cover"
          />
          {/* Gradient overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-[#0a0f1a] via-transparent to-transparent opacity-60" />
        </div>
        {/* Glow ring */}
        <motion.div
          className="absolute -inset-1 rounded-2xl border border-violet-500/20"
          animate={{ opacity: [0.2, 0.5, 0.2] }}
          transition={{ repeat: Infinity, duration: 2, ease: 'easeInOut' }}
        />
      </motion.div>

      {/* Step label */}
      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.3 }}
          className="flex items-center gap-2 mb-4"
        >
          <span className="text-lg">{currentStep.icon}</span>
          <span className="text-sm font-bold text-white">{currentStep.label}</span>
        </motion.div>
      </AnimatePresence>

      {/* Progress bar */}
      <div className="w-72 h-2 bg-slate-800 rounded-full overflow-hidden mb-3">
        <motion.div
          className="h-full bg-gradient-to-r from-violet-500 via-cyan-500 to-violet-500 rounded-full"
          style={{ backgroundSize: '200% 100%' }}
          animate={{
            width: `${progress}%`,
            backgroundPosition: ['0% 0%', '100% 0%', '0% 0%'],
          }}
          transition={{
            width: { duration: 0.3, ease: 'linear' },
            backgroundPosition: { repeat: Infinity, duration: 2, ease: 'linear' },
          }}
        />
      </div>

      {/* Progress percentage */}
      <span className="text-xs text-slate-500 font-mono">{Math.round(progress)}%</span>

      {/* Step indicators */}
      <div className="flex items-center gap-1.5 mt-4">
        {LOADER_STEPS.map((_, i) => (
          <motion.div
            key={i}
            className={`w-1.5 h-1.5 rounded-full ${i <= step ? 'bg-violet-400' : 'bg-slate-700'}`}
            animate={i === step ? { scale: [1, 1.4, 1] } : {}}
            transition={{ repeat: Infinity, duration: 1 }}
          />
        ))}
      </div>
    </div>
  )
}

// ── Skeleton ─────────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="bg-[#0F1629]/80 border border-slate-800/50 rounded-2xl p-5 animate-pulse">
      <div className="flex items-center gap-3 mb-4">
        <div className="h-7 w-16 bg-slate-800 rounded-full" />
        <div className="h-4 w-24 bg-slate-800 rounded" />
        <div className="ml-auto h-8 w-14 bg-slate-800 rounded-lg" />
      </div>
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="h-12 bg-slate-800/60 rounded-xl" />
        <div className="h-12 bg-slate-800/60 rounded-xl" />
        <div className="h-12 bg-slate-800/60 rounded-xl" />
      </div>
      <div className="h-3 w-full bg-slate-800 rounded mb-2" />
      <div className="h-3 w-2/3 bg-slate-800 rounded" />
    </div>
  )
}

function SkeletonPulse() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 animate-pulse">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="h-14 bg-slate-800/40 rounded-xl" />
      ))}
    </div>
  )
}

// ── Confidence ring ──────────────────────────────────────────────────────────

function ConfidenceRing({ value, size = 48 }: { value: number; size?: number }) {
  const r = (size - 6) / 2
  const circ = 2 * Math.PI * r
  const offset = circ - (value / 100) * circ
  const color =
    value >= 75 ? '#10b981' : value >= 55 ? '#f59e0b' : '#ef4444'

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1e293b" strokeWidth={3} />
        <motion.circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={color} strokeWidth={3} strokeLinecap="round"
          initial={{ strokeDashoffset: circ }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
          strokeDasharray={circ}
        />
      </svg>
      <span
        className="absolute inset-0 flex items-center justify-center text-xs font-black font-mono"
        style={{ color }}
      >
        {value}
      </span>
    </div>
  )
}

// ── Idea Card ────────────────────────────────────────────────────────────────

function IdeaCard({ idea, index }: { idea: TradeIdea; index: number }) {
  const [expanded, setExpanded] = useState(false)
  const isLong = idea.idea_type === 'long'
  const dirColor = isLong ? 'emerald' : 'red'

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.3, delay: index * 0.04 }}
    >
      <div
        className={`
          relative overflow-hidden rounded-2xl border backdrop-blur-sm
          bg-gradient-to-br from-[#0F1629]/90 to-[#0A0E1A]/90
          ${isLong
            ? 'border-emerald-500/15 hover:border-emerald-500/30'
            : 'border-red-500/15 hover:border-red-500/30'
          }
          transition-all duration-300 group cursor-pointer
        `}
        onClick={() => setExpanded(e => !e)}
      >
        {/* Gradient accent bar */}
        <div
          className={`absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r ${
            isLong ? 'from-emerald-500/60 via-cyan-500/40 to-transparent' : 'from-red-500/60 via-orange-500/40 to-transparent'
          }`}
        />

        <div className="p-5">
          {/* Top row: badge + symbol + confidence */}
          <div className="flex items-start justify-between gap-3 mb-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1.5">
                {/* Direction badge */}
                <span
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black tracking-wider border
                    ${isLong
                      ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400'
                      : 'bg-red-500/10 border-red-500/25 text-red-400'
                    }`}
                >
                  {isLong ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                  {isLong ? 'LONG' : 'SHORT'}
                </span>
                {/* Timeframe */}
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/10 border border-blue-500/20 text-blue-400">
                  <Clock className="w-2.5 h-2.5 inline mr-0.5 -mt-px" />
                  {TIMEFRAME_MAP[idea.timeframe] || idea.timeframe}
                </span>
                {/* Sector */}
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-800/80 border border-slate-700/40 text-slate-400">
                  {idea.sector}
                </span>
              </div>
              {/* Symbol + name */}
              <div className="flex items-baseline gap-2">
                <Link
                  href={`/research?symbol=${idea.symbol}`}
                  onClick={e => e.stopPropagation()}
                  className="text-lg font-black text-white hover:text-cyan-300 transition-colors font-mono"
                >
                  {idea.symbol}
                </Link>
                <span className="text-xs text-slate-500 truncate">{idea.company_name}</span>
              </div>
            </div>
            {/* Confidence ring */}
            <ConfidenceRing value={idea.confidence} />
          </div>

          {/* Price levels */}
          <div className="grid grid-cols-3 gap-2 mb-4">
            <div className="bg-slate-800/30 rounded-xl px-3 py-2 text-center">
              <div className="text-[9px] text-slate-600 uppercase tracking-wider mb-0.5">Entry</div>
              <div className="text-sm font-black text-white font-mono">
                ${idea.entry_price?.toFixed(2) ?? '--'}
              </div>
            </div>
            <div className={`bg-${dirColor}-500/5 rounded-xl px-3 py-2 text-center border border-${dirColor}-500/10`}>
              <div className="text-[9px] text-slate-600 uppercase tracking-wider mb-0.5">Target</div>
              <div className={`text-sm font-black font-mono text-${dirColor}-400`}>
                ${idea.target_price?.toFixed(2) ?? '--'}
              </div>
            </div>
            <div className="bg-orange-500/5 rounded-xl px-3 py-2 text-center border border-orange-500/10">
              <div className="text-[9px] text-slate-600 uppercase tracking-wider mb-0.5">Stop</div>
              <div className="text-sm font-black text-orange-400 font-mono">
                ${idea.stop_loss?.toFixed(2) ?? '--'}
              </div>
            </div>
          </div>

          {/* Risk/Reward + change */}
          <div className="flex items-center gap-3 mb-3">
            {idea.risk_reward != null && (
              <span className="flex items-center gap-1 text-xs font-bold text-cyan-400">
                <Target className="w-3 h-3" />
                R:R {idea.risk_reward}
              </span>
            )}
            {idea.rsi != null && (
              <span className="text-xs text-slate-500 font-mono">
                RSI {idea.rsi.toFixed(0)}
              </span>
            )}
            {idea.volume_ratio != null && idea.volume_ratio > 1.5 && (
              <span className="flex items-center gap-0.5 text-xs text-amber-400 font-bold">
                <Flame className="w-3 h-3" />
                {idea.volume_ratio}x vol
              </span>
            )}
            {idea.change_percent && (
              <span className={`ml-auto text-xs font-bold font-mono ${
                idea.change_percent.startsWith('-') ? 'text-red-400' : 'text-emerald-400'
              }`}>
                {idea.change_percent}
              </span>
            )}
          </div>

          {/* Catalyst */}
          <p className={`text-xs text-slate-400 leading-relaxed ${expanded ? '' : 'line-clamp-2'}`}>
            <Zap className="w-3 h-3 inline text-yellow-500 mr-1 -mt-px" />
            {idea.catalyst}
          </p>

          {/* Expand indicator */}
          <div className="flex justify-center mt-3">
            {expanded ? (
              <ChevronUp className="w-4 h-4 text-slate-600" />
            ) : (
              <ChevronDown className="w-4 h-4 text-slate-600 group-hover:text-slate-400 transition-colors" />
            )}
          </div>

          {/* Expanded detail */}
          <AnimatePresence>
            {expanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="mt-4 pt-4 border-t border-slate-800/50">
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <span className="text-slate-600">Risk per share</span>
                      <div className="text-white font-mono font-bold">
                        ${idea.entry_price && idea.stop_loss
                          ? Math.abs(idea.entry_price - idea.stop_loss).toFixed(2)
                          : '--'}
                      </div>
                    </div>
                    <div>
                      <span className="text-slate-600">Reward per share</span>
                      <div className="text-white font-mono font-bold">
                        ${idea.entry_price && idea.target_price
                          ? Math.abs(idea.target_price - idea.entry_price).toFixed(2)
                          : '--'}
                      </div>
                    </div>
                    <div>
                      <span className="text-slate-600">Direction</span>
                      <div className={`font-bold ${isLong ? 'text-emerald-400' : 'text-red-400'}`}>
                        {isLong ? 'Bullish Setup' : 'Bearish Setup'}
                      </div>
                    </div>
                    <div>
                      <span className="text-slate-600">Timeframe</span>
                      <div className="text-white font-bold">
                        {TIMEFRAME_MAP[idea.timeframe] || idea.timeframe}
                      </div>
                    </div>
                  </div>
                  <Link
                    href={`/research?symbol=${idea.symbol}`}
                    onClick={e => e.stopPropagation()}
                    className="mt-4 flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-xs font-bold hover:bg-cyan-500/20 transition-all"
                  >
                    <BarChart3 className="w-3.5 h-3.5" /> Full Analysis
                  </Link>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  )
}

// ── Market Pulse Panel ───────────────────────────────────────────────────────

function MarketPulse({
  pulse,
  loading,
}: {
  pulse: IdeasResponse['market_pulse']
  loading: boolean
}) {
  if (loading) return <SkeletonPulse />
  if (!pulse || (!pulse.top_bullish?.length && !pulse.top_bearish?.length)) return null

  return (
    <div className="space-y-4">
      {/* Bullish signals */}
      {pulse.top_bullish && pulse.top_bullish.length > 0 && (
        <div>
          <h3 className="text-xs font-bold text-emerald-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5" /> Top Bullish Signals
          </h3>
          <div className="space-y-1.5">
            {pulse.top_bullish.map((s, i) => (
              <div key={i} className="flex items-center gap-2 bg-emerald-500/5 border border-emerald-500/10 rounded-lg px-3 py-2">
                <span className="text-xs font-black text-emerald-400 font-mono w-12">{s.symbol}</span>
                <span className="text-[11px] text-slate-400 flex-1 truncate">{s.catalyst}</span>
                <span className="text-xs font-bold text-emerald-400 font-mono">{s.confidence}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Bearish signals */}
      {pulse.top_bearish && pulse.top_bearish.length > 0 && (
        <div>
          <h3 className="text-xs font-bold text-red-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <TrendingDown className="w-3.5 h-3.5" /> Top Bearish Signals
          </h3>
          <div className="space-y-1.5">
            {pulse.top_bearish.map((s, i) => (
              <div key={i} className="flex items-center gap-2 bg-red-500/5 border border-red-500/10 rounded-lg px-3 py-2">
                <span className="text-xs font-black text-red-400 font-mono w-12">{s.symbol}</span>
                <span className="text-[11px] text-slate-400 flex-1 truncate">{s.catalyst}</span>
                <span className="text-xs font-bold text-red-400 font-mono">{s.confidence}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sector rotation */}
      {pulse.sector_rotation && Object.keys(pulse.sector_rotation).length > 0 && (
        <div>
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5" /> Sector Rotation
          </h3>
          <div className="grid grid-cols-2 gap-1.5">
            {Object.entries(pulse.sector_rotation).map(([sector, counts]) => {
              const total = counts.bullish + counts.bearish
              const bullPct = total > 0 ? (counts.bullish / total) * 100 : 50
              return (
                <div key={sector} className="bg-slate-800/30 rounded-lg px-3 py-2">
                  <div className="text-[10px] text-slate-500 mb-1">{sector}</div>
                  <div className="w-full h-1.5 bg-slate-700/50 rounded-full overflow-hidden flex">
                    <div
                      className="h-full bg-emerald-500/70 rounded-l-full"
                      style={{ width: `${bullPct}%` }}
                    />
                    <div
                      className="h-full bg-red-500/70 rounded-r-full"
                      style={{ width: `${100 - bullPct}%` }}
                    />
                  </div>
                  <div className="flex justify-between mt-1 text-[9px] font-mono">
                    <span className="text-emerald-400">{counts.bullish}B</span>
                    <span className="text-red-400">{counts.bearish}S</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Live Pulse Dot ───────────────────────────────────────────────────────────

function PulseDot() {
  return (
    <span className="relative flex h-2.5 w-2.5">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
    </span>
  )
}

// ── Regime Badge ────────────────────────────────────────────────────────────

function RegimeBadge({ regime }: { regime: RegimeData | null }) {
  if (!regime) return null
  const colors: Record<string, string> = {
    risk_on_growth: 'from-emerald-500/20 to-cyan-500/20 border-emerald-500/30 text-emerald-400',
    risk_off_defensive: 'from-red-500/20 to-orange-500/20 border-red-500/30 text-red-400',
    high_volatility: 'from-amber-500/20 to-red-500/20 border-amber-500/30 text-amber-400',
    recession_fear: 'from-red-500/20 to-rose-500/20 border-red-500/30 text-red-400',
    momentum_leadership: 'from-violet-500/20 to-blue-500/20 border-violet-500/30 text-violet-400',
    soft_landing: 'from-blue-500/20 to-cyan-500/20 border-blue-500/30 text-blue-400',
    fed_easing: 'from-green-500/20 to-emerald-500/20 border-green-500/30 text-green-400',
    fed_tightening: 'from-orange-500/20 to-red-500/20 border-orange-500/30 text-orange-400',
  }
  const colorClass = colors[regime.regime] || 'from-slate-500/20 to-slate-600/20 border-slate-500/30 text-slate-400'

  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-gradient-to-r ${colorClass} border`}>
      <Activity className="w-3.5 h-3.5" />
      <span className="text-xs font-bold">{regime.regime_label}</span>
      <span className="text-[10px] opacity-60">{regime.confidence?.toFixed(0)}%</span>
    </div>
  )
}

// ── Factor Bar ──────────────────────────────────────────────────────────────

function FactorBar({ label, score, compact }: { label: string; score: number; compact?: boolean }) {
  const color = score >= 70 ? 'bg-emerald-500' : score >= 55 ? 'bg-cyan-500' : score >= 40 ? 'bg-amber-500' : 'bg-red-500'
  return (
    <div className={compact ? 'flex items-center gap-2' : ''}>
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-[10px] text-slate-500">{label}</span>
        <span className="text-[10px] font-mono font-bold text-slate-300">{score?.toFixed(0)}</span>
      </div>
      <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all duration-500`} style={{ width: `${Math.min(score, 100)}%` }} />
      </div>
    </div>
  )
}

// ── Basket Card ─────────────────────────────────────────────────────────────

function BasketCard({
  index,
  snapshot,
  onRefresh,
  refreshing,
}: {
  index: IndexDefinition
  snapshot: IndexSnapshot | null
  onRefresh: (id: string) => void
  refreshing: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const hasData = snapshot && snapshot.holdings && snapshot.holdings.length > 0

  const riskColors: Record<string, string> = {
    'Low': 'text-emerald-400', 'Low-Medium': 'text-green-400', 'Medium': 'text-amber-400',
    'High': 'text-orange-400', 'Very High': 'text-red-400',
  }
  const categoryColors: Record<string, string> = {
    Growth: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400',
    Defensive: 'bg-blue-500/10 border-blue-500/20 text-blue-400',
    Value: 'bg-amber-500/10 border-amber-500/20 text-amber-400',
    Momentum: 'bg-violet-500/10 border-violet-500/20 text-violet-400',
    Core: 'bg-cyan-500/10 border-cyan-500/20 text-cyan-400',
    Thematic: 'bg-pink-500/10 border-pink-500/20 text-pink-400',
    Macro: 'bg-orange-500/10 border-orange-500/20 text-orange-400',
    Tactical: 'bg-red-500/10 border-red-500/20 text-red-400',
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative overflow-hidden rounded-2xl border border-slate-800/50 bg-gradient-to-br from-[#0F1629]/90 to-[#0A0E1A]/90 hover:border-cyan-500/20 transition-all duration-300"
    >
      {/* Top accent */}
      <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-violet-500/60 via-cyan-500/40 to-transparent" />

      <div className="p-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${categoryColors[index.category] || 'bg-slate-800 border-slate-700 text-slate-400'}`}>
                {index.category}
              </span>
              <span className={`text-[10px] font-bold ${riskColors[index.risk_profile] || 'text-slate-400'}`}>
                {index.risk_profile} Risk
              </span>
            </div>
            <h3 className="text-base font-black text-white">{index.short_name}</h3>
            <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-2">{index.description}</p>
          </div>

          {hasData && (
            <ConfidenceRing value={Math.round(snapshot!.avg_ai_score || 0)} size={48} />
          )}
        </div>

        {/* Quick stats when data available */}
        {hasData && (
          <div className="grid grid-cols-4 gap-2 mb-3">
            {[
              { label: 'Holdings', value: snapshot!.num_holdings, color: 'text-white' },
              { label: 'Avg Score', value: `${snapshot!.avg_ai_score?.toFixed(0)}`, color: 'text-cyan-400' },
              { label: 'Beta', value: snapshot!.portfolio_beta?.toFixed(2), color: 'text-blue-400' },
              { label: 'Risk', value: snapshot!.risk_level, color: riskColors[snapshot!.risk_level || ''] || 'text-slate-400' },
            ].map(s => (
              <div key={s.label} className="bg-slate-800/30 rounded-lg px-2 py-1.5 text-center">
                <div className="text-[8px] text-slate-600 uppercase">{s.label}</div>
                <div className={`text-xs font-black font-mono ${s.color}`}>{s.value}</div>
              </div>
            ))}
          </div>
        )}

        {/* Sector allocation bar */}
        {hasData && snapshot!.sector_allocation && (
          <div className="mb-3">
            <div className="text-[9px] text-slate-600 uppercase mb-1">Sector Allocation</div>
            <div className="h-2 rounded-full overflow-hidden flex bg-slate-800/50">
              {Object.entries(snapshot!.sector_allocation).map(([sector, pct], i) => {
                const sectorColors = ['bg-violet-500', 'bg-cyan-500', 'bg-emerald-500', 'bg-amber-500', 'bg-blue-500', 'bg-pink-500', 'bg-orange-500', 'bg-red-500', 'bg-green-500', 'bg-indigo-500']
                return (
                  <div
                    key={sector}
                    className={`h-full ${sectorColors[i % sectorColors.length]}`}
                    style={{ width: `${pct}%` }}
                    title={`${sector}: ${pct.toFixed(1)}%`}
                  />
                )
              })}
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
              {Object.entries(snapshot!.sector_allocation).slice(0, 4).map(([sector, pct]) => (
                <span key={sector} className="text-[9px] text-slate-500">{sector} {pct.toFixed(0)}%</span>
              ))}
            </div>
          </div>
        )}

        {/* Expand / Generate buttons */}
        <div className="flex items-center gap-2">
          {hasData ? (
            <button
              onClick={() => setExpanded(e => !e)}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800/50 border border-slate-700/30 text-xs font-bold text-slate-300 hover:bg-slate-700/50 transition-all"
            >
              {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              {expanded ? 'Collapse' : `View ${snapshot!.num_holdings} Holdings`}
            </button>
          ) : (
            <motion.button
              onClick={() => onRefresh(index.index_id)}
              disabled={refreshing}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
              className="flex-1 relative flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-cyan-600 text-white text-xs font-bold disabled:opacity-70 transition-all overflow-hidden shadow-lg shadow-violet-500/15"
            >
              {/* Shimmer sweep */}
              {!refreshing && (
                <motion.div
                  className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent"
                  animate={{ x: ['-100%', '200%'] }}
                  transition={{ repeat: Infinity, duration: 2.5, ease: 'linear', repeatDelay: 1 }}
                />
              )}
              {/* Loading pulse overlay */}
              {refreshing && (
                <motion.div
                  className="absolute inset-0 bg-gradient-to-r from-violet-600/50 via-cyan-600/50 to-violet-600/50"
                  style={{ backgroundSize: '200% 100%' }}
                  animate={{ backgroundPosition: ['0% 0%', '100% 0%', '0% 0%'] }}
                  transition={{ repeat: Infinity, duration: 1.5, ease: 'linear' }}
                />
              )}
              <span className="relative flex items-center gap-2">
                {refreshing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                {refreshing ? 'Building Basket...' : 'Generate Basket'}
              </span>
            </motion.button>
          )}
          {hasData && (
            <button
              onClick={() => onRefresh(index.index_id)}
              disabled={refreshing}
              className="p-2 rounded-xl bg-slate-800/50 border border-slate-700/30 text-slate-400 hover:text-cyan-400 transition-all disabled:opacity-40"
              title="Refresh basket"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
          )}
        </div>

        {/* Expanded: Holdings Table */}
        <AnimatePresence>
          {expanded && hasData && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="overflow-hidden"
            >
              <div className="mt-4 border-t border-slate-800/50 pt-4">
                {/* Factor exposure */}
                {snapshot!.factor_exposure && (
                  <div className="mb-4">
                    <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Factor Exposure</div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                      {Object.entries(snapshot!.factor_exposure).map(([factor, score]) => (
                        <FactorBar key={factor} label={factor.replace(/_/g, ' ')} score={score} />
                      ))}
                    </div>
                  </div>
                )}

                {/* Thesis */}
                {snapshot!.explanation?.basket_thesis && (
                  <div className="mb-3 px-3 py-2 bg-violet-500/5 border border-violet-500/15 rounded-xl">
                    <div className="text-[10px] text-violet-400 font-bold uppercase mb-1">AI Thesis</div>
                    <p className="text-[11px] text-slate-400 leading-relaxed">{snapshot!.explanation.basket_thesis}</p>
                  </div>
                )}

                {/* Monte Carlo */}
                {snapshot!.monte_carlo && (
                  <div className="grid grid-cols-3 gap-2 mb-3">
                    <div className="bg-emerald-500/5 border border-emerald-500/10 rounded-lg px-2 py-1.5 text-center">
                      <div className="text-[8px] text-slate-600 uppercase">Bull Case</div>
                      <div className="text-xs font-black text-emerald-400 font-mono">+{snapshot!.monte_carlo.bull_case.return_pct}%</div>
                    </div>
                    <div className="bg-blue-500/5 border border-blue-500/10 rounded-lg px-2 py-1.5 text-center">
                      <div className="text-[8px] text-slate-600 uppercase">Base Case</div>
                      <div className="text-xs font-black text-blue-400 font-mono">{snapshot!.monte_carlo.base_case.return_pct > 0 ? '+' : ''}{snapshot!.monte_carlo.base_case.return_pct}%</div>
                    </div>
                    <div className="bg-red-500/5 border border-red-500/10 rounded-lg px-2 py-1.5 text-center">
                      <div className="text-[8px] text-slate-600 uppercase">Bear Case</div>
                      <div className="text-xs font-black text-red-400 font-mono">{snapshot!.monte_carlo.bear_case.return_pct}%</div>
                    </div>
                  </div>
                )}

                {/* Holdings list */}
                <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Holdings ({snapshot!.num_holdings})</div>
                <div className="space-y-1 max-h-[400px] overflow-y-auto custom-scrollbar">
                  {snapshot!.holdings.map((h, i) => (
                    <div
                      key={h.ticker}
                      className="flex items-center gap-3 px-3 py-2 rounded-lg bg-slate-800/20 hover:bg-slate-800/40 transition-colors group"
                    >
                      <span className="text-[10px] text-slate-600 font-mono w-4">{i + 1}</span>
                      <Link
                        href={`/research?symbol=${h.ticker}`}
                        className="text-xs font-black text-white group-hover:text-cyan-300 transition-colors font-mono min-w-[50px]"
                      >
                        {h.ticker}
                      </Link>
                      <span className="text-[10px] text-slate-500 flex-1 truncate">{h.company_name}</span>
                      <span className="text-[10px] text-slate-500">{h.sector}</span>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                        h.grade?.startsWith('A') ? 'bg-emerald-500/10 text-emerald-400' :
                        h.grade?.startsWith('B') ? 'bg-cyan-500/10 text-cyan-400' :
                        h.grade?.startsWith('C') ? 'bg-amber-500/10 text-amber-400' :
                        'bg-red-500/10 text-red-400'
                      }`}>
                        {h.grade}
                      </span>
                      <span className="text-[10px] font-bold text-cyan-400 font-mono w-8 text-right">{h.overall_ai_score?.toFixed(0)}</span>
                      <span className="text-[10px] text-slate-400 font-mono w-12 text-right">{h.weight_pct?.toFixed(1)}%</span>
                      {h.role?.role_label && (
                        <span className="text-[9px] text-slate-600 hidden lg:inline">{h.role.role_label}</span>
                      )}
                    </div>
                  ))}
                </div>

                {/* Risks */}
                {snapshot!.explanation?.top_risks && snapshot!.explanation.top_risks.length > 0 && (
                  <div className="mt-3 px-3 py-2 bg-red-500/5 border border-red-500/15 rounded-xl">
                    <div className="text-[10px] text-red-400 font-bold uppercase mb-1">Key Risks</div>
                    <ul className="space-y-0.5">
                      {snapshot!.explanation.top_risks.slice(0, 3).map((r, i) => (
                        <li key={i} className="text-[10px] text-slate-500 flex items-start gap-1.5">
                          <AlertTriangle className="w-3 h-3 text-red-400/50 shrink-0 mt-0.5" />
                          {r}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Scenarios */}
                {snapshot!.scenarios && snapshot!.scenarios.length > 0 && (
                  <div className="mt-3">
                    <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5">Stress Scenarios</div>
                    <div className="grid grid-cols-2 gap-1.5">
                      {snapshot!.scenarios.slice(0, 4).map(s => (
                        <div key={s.scenario_label} className="bg-slate-800/30 rounded-lg px-2 py-1.5">
                          <div className="text-[9px] text-slate-500 truncate">{s.scenario_label}</div>
                          <div className={`text-xs font-black font-mono ${s.projected_basket_return_pct > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {s.projected_basket_return_pct > 0 ? '+' : ''}{s.projected_basket_return_pct?.toFixed(1)}%
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Generated timestamp */}
                {snapshot!.generated_at && (
                  <div className="mt-3 text-[9px] text-slate-700 text-right">
                    Generated {new Date(snapshot!.generated_at).toLocaleString()}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}


// ── Desktop Layout ───────────────────────────────────────────────────────────

type Tab = 'ideas' | 'baskets'

function DesktopIdeasLab() {
  const [activeTab, setActiveTab] = useState<Tab>('baskets')
  const [ideas, setIdeas] = useState<TradeIdea[]>([])
  const [pulse, setPulse] = useState<IdeasResponse['market_pulse']>({})
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sentiment, setSentiment] = useState<Sentiment>('all')
  const [timeframe, setTimeframe] = useState<Timeframe>('all')
  const [sector, setSector] = useState('All Sectors')
  const isAuthed = typeof window !== 'undefined' && !!getToken()

  // ── Basket state ──────────────────────────────────────────────────────────
  const [indices, setIndices] = useState<IndexDefinition[]>([])
  const [snapshots, setSnapshots] = useState<Record<string, IndexSnapshot>>({})
  const [regime, setRegime] = useState<RegimeData | null>(null)
  const [basketLoading, setBasketLoading] = useState(true)
  const [refreshingIndex, setRefreshingIndex] = useState<string | null>(null)
  const qc = useQueryClient()

  // Load basket data — uses React Query cache (prefetched by PrefetchEngine)
  useEffect(() => {
    loadBasketData()
  }, [])

  const loadBasketData = async () => {
    setBasketLoading(true)
    try {
      // Check if PrefetchEngine already warmed the cache
      const cached = qc.getQueryData<{ indices: IndexDefinition[]; snapshots: Record<string, IndexSnapshot>; regime: RegimeData | null }>(['modelIndexBatch'])
      const batch = cached || await fetchBatchLoad()

      setIndices(batch.indices)
      if (batch.regime) setRegime(batch.regime)
      const validSnaps: Record<string, IndexSnapshot> = {}
      for (const [id, snap] of Object.entries(batch.snapshots || {})) {
        if (snap?.holdings?.length > 0) validSnaps[id] = snap
      }
      setSnapshots(validSnaps)
    } catch (err) {
      console.error('Failed to load basket data:', err)
    } finally {
      setBasketLoading(false)
    }
  }

  const handleRefreshIndex = async (indexId: string) => {
    if (!isAuthed) {
      setError('Sign in to generate AI baskets')
      return
    }
    setRefreshingIndex(indexId)
    try {
      const snap = await refreshIndex(indexId, true)
      if (snap && !('error' in snap)) {
        setSnapshots(prev => ({ ...prev, [indexId]: snap }))
      }
    } catch (err) {
      setError('Failed to generate basket. Please try again.')
    } finally {
      setRefreshingIndex(null)
    }
  }

  // Load trending ideas on mount
  useEffect(() => {
    loadTrending()
  }, [])

  const loadTrending = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await getTrendingIdeas()
      setIdeas(res.ideas)
      setPulse(res.market_pulse)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load ideas')
    } finally {
      setLoading(false)
    }
  }

  const handleGenerate = async () => {
    if (!isAuthed) {
      setError('Sign in to generate personalized AI ideas')
      return
    }
    setGenerating(true)
    setError(null)
    try {
      const res = await generateIdeas()
      setIdeas(res.ideas)
      setPulse(res.market_pulse)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Generation failed')
    } finally {
      setGenerating(false)
    }
  }

  // Filter ideas
  const filtered = ideas.filter(idea => {
    if (sentiment === 'bullish' && idea.idea_type !== 'long') return false
    if (sentiment === 'bearish' && idea.idea_type !== 'short') return false
    if (timeframe !== 'all' && idea.timeframe !== timeframe) return false
    if (sector !== 'All Sectors' && idea.sector !== sector) return false
    return true
  })

  const bullishCount = ideas.filter(i => i.idea_type === 'long').length
  const bearishCount = ideas.filter(i => i.idea_type === 'short').length
  const avgConfidence = ideas.length
    ? Math.round(ideas.reduce((s, i) => s + i.confidence, 0) / ideas.length)
    : 0

  return (
    <AppLayout>
      <div className="min-h-screen bg-[#0A0E1A] -mx-4 md:-mx-6 -my-4 md:-my-6">
        <div className="max-w-7xl mx-auto px-6 py-8">

          {/* ── Header ─────────────────────────────────────────── */}
          <motion.div
            className="mb-8"
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
          >
            <div className="flex items-center justify-between gap-4 mb-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-600/20 to-cyan-600/20 border border-violet-500/20 flex items-center justify-center">
                  <Brain className="w-5 h-5 text-violet-400" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h1 className="text-xl font-black text-white">AI Ideas Lab</h1>
                    <PulseDot />
                    <span className="text-[10px] text-slate-500 font-mono">LIVE</span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    AI-powered stock baskets & trade setups
                  </p>
                </div>
              </div>

              {/* Tab switcher */}
              <div className="flex items-center gap-1 bg-[#0F1629]/80 border border-slate-800/50 rounded-xl p-1 mr-3">
                <button
                  onClick={() => setActiveTab('baskets')}
                  className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                    activeTab === 'baskets'
                      ? 'bg-violet-500/15 text-violet-400 border border-violet-500/25'
                      : 'text-slate-500 hover:text-slate-300 border border-transparent'
                  }`}
                >
                  <Layers className="w-3.5 h-3.5" /> AI Baskets
                </button>
                <button
                  onClick={() => setActiveTab('ideas')}
                  className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                    activeTab === 'ideas'
                      ? 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/25'
                      : 'text-slate-500 hover:text-slate-300 border border-transparent'
                  }`}
                >
                  <Zap className="w-3.5 h-3.5" /> Trade Ideas
                </button>
              </div>

              <motion.button
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                onClick={handleGenerate}
                disabled={generating}
                className="relative flex items-center gap-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-cyan-600 text-white text-sm font-bold shadow-lg shadow-violet-500/20 hover:shadow-violet-500/30 disabled:opacity-60 disabled:cursor-not-allowed transition-all overflow-hidden"
              >
                {generating && (
                  <motion.div
                    className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent"
                    animate={{ x: ['-100%', '100%'] }}
                    transition={{ repeat: Infinity, duration: 1.2, ease: 'linear' }}
                  />
                )}
                {generating ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Sparkles className="w-4 h-4" />
                )}
                {generating ? 'Scanning Market...' : 'Generate New Ideas'}
              </motion.button>
            </div>

            {/* Stats strip + Filters — ideas tab only */}
            {activeTab === 'ideas' && <>
            <div className="grid grid-cols-4 gap-3 mb-6">
              {[
                { label: 'Total Ideas', value: ideas.length, color: 'text-white', icon: Crosshair },
                { label: 'Bullish', value: bullishCount, color: 'text-emerald-400', icon: TrendingUp },
                { label: 'Bearish', value: bearishCount, color: 'text-red-400', icon: TrendingDown },
                { label: 'Avg Confidence', value: `${avgConfidence}%`, color: 'text-cyan-400', icon: Activity },
              ].map(s => (
                <div key={s.label} className="bg-[#0F1629]/80 border border-slate-800/50 rounded-xl px-4 py-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <s.icon className="w-3 h-3 text-slate-600" />
                    <span className="text-[10px] text-slate-600 uppercase tracking-wider">{s.label}</span>
                  </div>
                  <div className={`text-xl font-black ${s.color} font-mono`}>{s.value}</div>
                </div>
              ))}
            </div>

            {/* Filters Bar */}
            <div className="flex items-center gap-3 flex-wrap">
              {/* Sentiment */}
              <div className="flex items-center gap-1 bg-[#0F1629]/80 border border-slate-800/50 rounded-xl p-1">
                {(['all', 'bullish', 'bearish'] as const).map(s => (
                  <button
                    key={s}
                    onClick={() => setSentiment(s)}
                    className={`px-4 py-1.5 rounded-lg text-xs font-bold capitalize transition-all ${
                      sentiment === s
                        ? s === 'bullish' ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25'
                          : s === 'bearish' ? 'bg-red-500/15 text-red-400 border border-red-500/25'
                          : 'bg-slate-700/50 text-white border border-slate-600/30'
                        : 'text-slate-500 hover:text-slate-300 border border-transparent'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>

              {/* Timeframe */}
              <div className="flex items-center gap-1 bg-[#0F1629]/80 border border-slate-800/50 rounded-xl p-1">
                {(['all', 'intraday', 'swing', 'position'] as const).map(t => (
                  <button
                    key={t}
                    onClick={() => setTimeframe(t)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold capitalize transition-all ${
                      timeframe === t
                        ? 'bg-blue-500/15 text-blue-400 border border-blue-500/25'
                        : 'text-slate-500 hover:text-slate-300 border border-transparent'
                    }`}
                  >
                    {t === 'all' ? 'All TF' : t}
                  </button>
                ))}
              </div>

              {/* Sector dropdown */}
              <select
                value={sector}
                onChange={e => setSector(e.target.value)}
                className="bg-[#0F1629]/80 border border-slate-800/50 rounded-xl px-3 py-2 text-xs font-bold text-slate-300 outline-none focus:border-cyan-500/30 cursor-pointer appearance-none"
                style={{ backgroundImage: 'none' }}
              >
                {SECTORS.map(s => (
                  <option key={s} value={s} className="bg-[#0F1629] text-slate-300">{s}</option>
                ))}
              </select>
            </div>
            </>}
          </motion.div>

          {/* Error */}
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-2 px-4 py-3 mb-6 bg-red-500/10 border border-red-500/20 rounded-xl"
            >
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
              <span className="text-xs text-red-300">{error}</span>
            </motion.div>
          )}

          {/* ── Tab Content ──────────────────────────── */}
          {activeTab === 'baskets' ? (
            /* ── AI BASKETS TAB ─────────────────────────── */
            <div>
              {/* Regime indicator */}
              <div className="flex items-center gap-3 mb-6">
                <RegimeBadge regime={regime} />
                {regime?.signals && (
                  <div className="flex items-center gap-3 text-[10px] text-slate-600">
                    {regime.signals.vix != null && <span>VIX: <strong className="text-slate-400">{regime.signals.vix?.toFixed(1)}</strong></span>}
                    <span>Breadth: <strong className="text-slate-400">{regime.signals.breadth_sma200_pct?.toFixed(0)}%</strong></span>
                    <span>Momentum: <strong className="text-slate-400">{regime.signals.momentum_breadth_pct?.toFixed(0)}%</strong></span>
                  </div>
                )}
              </div>

              {basketLoading ? (
                <BasketLoader />
              ) : indices.length === 0 ? (
                <div className="text-center py-20">
                  <Layers className="w-10 h-10 text-slate-700 mx-auto mb-3" />
                  <p className="text-sm text-slate-500">No basket indices configured</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {indices.map(idx => (
                    <BasketCard
                      key={idx.index_id}
                      index={idx}
                      snapshot={snapshots[idx.index_id] || null}
                      onRefresh={handleRefreshIndex}
                      refreshing={refreshingIndex === idx.index_id}
                    />
                  ))}
                </div>
              )}

              {/* Disclaimer */}
              <div className="flex items-start gap-2 px-4 py-3 mt-6 bg-amber-500/5 border border-amber-500/15 rounded-xl">
                <Shield className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <span className="text-[10px] text-slate-500 leading-relaxed">
                  AI-generated baskets are for informational purposes only. Not financial advice.
                  Multi-factor scoring uses real market data but past performance does not guarantee future results.
                </span>
              </div>
            </div>
          ) : (
            /* ── TRADE IDEAS TAB ─────────────────────────── */
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
              {/* Ideas grid — 3 cols */}
              <div className="lg:col-span-3">
                {loading ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {[...Array(6)].map((_, i) => <SkeletonCard key={i} />)}
                  </div>
                ) : filtered.length === 0 ? (
                  <div className="text-center py-20">
                    <Crosshair className="w-10 h-10 text-slate-700 mx-auto mb-3" />
                    <p className="text-sm text-slate-500">No ideas match current filters</p>
                    <button
                      onClick={() => { setSentiment('all'); setTimeframe('all'); setSector('All Sectors') }}
                      className="mt-3 text-xs text-cyan-400 hover:text-cyan-300 transition-colors"
                    >
                      Reset filters
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <AnimatePresence mode="popLayout">
                      {filtered.map((idea, i) => (
                        <IdeaCard key={`${idea.symbol}-${idea.idea_type}`} idea={idea} index={i} />
                      ))}
                    </AnimatePresence>
                  </div>
                )}
              </div>

              {/* Market Pulse sidebar — 1 col */}
              <div className="lg:col-span-1 space-y-4">
                <div className="bg-[#0F1629]/80 border border-slate-800/50 rounded-2xl p-4">
                  <h2 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
                    <Activity className="w-4 h-4 text-cyan-400" />
                    Market Pulse
                  </h2>
                  <MarketPulse pulse={pulse} loading={loading} />
                </div>

                {/* Disclaimer */}
                <div className="flex items-start gap-2 px-4 py-3 bg-amber-500/5 border border-amber-500/15 rounded-xl">
                  <Shield className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <span className="text-[10px] text-slate-500 leading-relaxed">
                    AI-generated ideas are for informational purposes only. Not financial advice.
                    Always do your own due diligence before trading.
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  )
}

// ── Mobile Layout ────────────────────────────────────────────────────────────

function MobileIdeasLab() {
  const [mobileTab, setMobileTab] = useState<Tab>('baskets')
  const [ideas, setIdeas] = useState<TradeIdea[]>([])
  const [pulse, setPulse] = useState<IdeasResponse['market_pulse']>({})
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sentiment, setSentiment] = useState<Sentiment>('all')
  const isAuthed = typeof window !== 'undefined' && !!getToken()
  const mqc = useQueryClient()

  // Basket state
  const [indices, setIndices] = useState<IndexDefinition[]>([])
  const [snapshots, setSnapshots] = useState<Record<string, IndexSnapshot>>({})
  const [regime, setRegime] = useState<RegimeData | null>(null)
  const [basketLoading, setBasketLoading] = useState(true)
  const [refreshingIndex, setRefreshingIndex] = useState<string | null>(null)

  useEffect(() => {
    loadTrending()
    loadBaskets()
  }, [])

  const loadBaskets = async () => {
    setBasketLoading(true)
    try {
      // Check PrefetchEngine cache first
      const cached = mqc.getQueryData<{ indices: IndexDefinition[]; snapshots: Record<string, IndexSnapshot>; regime: RegimeData | null }>(['modelIndexBatch'])
      const batch = cached || await fetchBatchLoad()
      setIndices(batch.indices)
      if (batch.regime) setRegime(batch.regime)
      const validSnaps: Record<string, IndexSnapshot> = {}
      for (const [id, snap] of Object.entries(batch.snapshots || {})) {
        if (snap?.holdings?.length > 0) validSnaps[id] = snap
      }
      setSnapshots(validSnaps)
    } catch {} finally { setBasketLoading(false) }
  }

  const handleRefreshIndex = async (indexId: string) => {
    if (!isAuthed) { setError('Sign in to generate AI baskets'); return }
    setRefreshingIndex(indexId)
    try {
      const snap = await refreshIndex(indexId, true)
      if (snap && !('error' in snap)) setSnapshots(prev => ({ ...prev, [indexId]: snap }))
    } catch { setError('Failed to generate basket') }
    finally { setRefreshingIndex(null) }
  }

  const loadTrending = async () => {
    setLoading(true)
    try {
      const res = await getTrendingIdeas()
      setIdeas(res.ideas)
      setPulse(res.market_pulse)
    } catch {
      setError('Failed to load ideas')
    } finally {
      setLoading(false)
    }
  }

  const handleGenerate = async () => {
    if (!isAuthed) { setError('Sign in to generate AI ideas'); return }
    setGenerating(true)
    setError(null)
    try {
      const res = await generateIdeas()
      setIdeas(res.ideas)
      setPulse(res.market_pulse)
    } catch {
      setError('Generation failed')
    } finally {
      setGenerating(false)
    }
  }

  const filtered = ideas.filter(idea => {
    if (sentiment === 'bullish' && idea.idea_type !== 'long') return false
    if (sentiment === 'bearish' && idea.idea_type !== 'short') return false
    return true
  })

  return (
    <MobileLayout>
      <div className="px-4 pt-4 pb-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-violet-400" />
            <h1 className="text-lg font-black text-white">AI Ideas Lab</h1>
            <PulseDot />
          </div>
        </div>

        {/* Tab switcher */}
        <div className="flex items-center gap-1 bg-[#0F1629]/80 border border-slate-800/50 rounded-xl p-1 mb-4">
          <button
            onClick={() => setMobileTab('baskets')}
            className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
              mobileTab === 'baskets' ? 'bg-violet-500/15 text-violet-400' : 'text-slate-500'
            }`}
          >
            <Layers className="w-3.5 h-3.5" /> AI Baskets
          </button>
          <button
            onClick={() => setMobileTab('ideas')}
            className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
              mobileTab === 'ideas' ? 'bg-cyan-500/15 text-cyan-400' : 'text-slate-500'
            }`}
          >
            <Zap className="w-3.5 h-3.5" /> Trade Ideas
          </button>
        </div>

        {error && (
          <div className="flex items-center gap-2 px-3 py-2 mb-4 bg-red-500/10 border border-red-500/20 rounded-xl">
            <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
            <span className="text-[11px] text-red-300">{error}</span>
          </div>
        )}

        {mobileTab === 'baskets' ? (
          /* Baskets tab */
          <div>
            <RegimeBadge regime={regime} />
            <div className="mt-4 space-y-4">
              {basketLoading ? (
                <BasketLoader />
              ) : (
                indices.map(idx => (
                  <BasketCard
                    key={idx.index_id}
                    index={idx}
                    snapshot={snapshots[idx.index_id] || null}
                    onRefresh={handleRefreshIndex}
                    refreshing={refreshingIndex === idx.index_id}
                  />
                ))
              )}
            </div>
          </div>
        ) : (
          /* Ideas tab */
          <div>
            {/* Generate button */}
            <div className="flex justify-end mb-3">
              <button
                onClick={handleGenerate}
                disabled={generating}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-cyan-600 text-white text-xs font-bold disabled:opacity-60"
              >
                {generating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                {generating ? 'Scanning...' : 'Generate'}
              </button>
            </div>

            {/* Quick stats */}
            <div className="grid grid-cols-3 gap-2 mb-4">
              <div className="bg-[#0F1629]/80 border border-slate-800/50 rounded-xl px-3 py-2 text-center">
                <div className="text-[9px] text-slate-600 uppercase">Ideas</div>
                <div className="text-base font-black text-white font-mono">{ideas.length}</div>
              </div>
              <div className="bg-[#0F1629]/80 border border-slate-800/50 rounded-xl px-3 py-2 text-center">
                <div className="text-[9px] text-emerald-500 uppercase">Bull</div>
                <div className="text-base font-black text-emerald-400 font-mono">{ideas.filter(i => i.idea_type === 'long').length}</div>
              </div>
              <div className="bg-[#0F1629]/80 border border-slate-800/50 rounded-xl px-3 py-2 text-center">
                <div className="text-[9px] text-red-500 uppercase">Bear</div>
                <div className="text-base font-black text-red-400 font-mono">{ideas.filter(i => i.idea_type === 'short').length}</div>
              </div>
            </div>

            {/* Sentiment filter */}
            <div className="flex items-center gap-1 bg-[#0F1629]/80 border border-slate-800/50 rounded-xl p-1 mb-4">
          {(['all', 'bullish', 'bearish'] as const).map(s => (
            <button
              key={s}
              onClick={() => setSentiment(s)}
              className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-bold capitalize transition-all ${
                sentiment === s
                  ? s === 'bullish' ? 'bg-emerald-500/15 text-emerald-400'
                    : s === 'bearish' ? 'bg-red-500/15 text-red-400'
                    : 'bg-slate-700/50 text-white'
                  : 'text-slate-500'
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        {/* Ideas list */}
        {loading ? (
          <div className="space-y-3">
            {[...Array(4)].map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : (
          <div className="space-y-3">
            <AnimatePresence mode="popLayout">
              {filtered.map((idea, i) => (
                <IdeaCard key={`${idea.symbol}-${idea.idea_type}`} idea={idea} index={i} />
              ))}
            </AnimatePresence>
          </div>
        )}

        {/* Market pulse */}
        {!loading && pulse.top_bullish && (
          <div className="mt-6 bg-[#0F1629]/80 border border-slate-800/50 rounded-2xl p-4">
            <h2 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
              <Activity className="w-4 h-4 text-cyan-400" /> Market Pulse
            </h2>
            <MarketPulse pulse={pulse} loading={false} />
          </div>
        )}
          </div>
        )}

        {/* Disclaimer */}
        <div className="flex items-start gap-2 px-3 py-2.5 mt-4 bg-amber-500/5 border border-amber-500/15 rounded-xl">
          <Shield className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
          <span className="text-[10px] text-slate-500 leading-relaxed">
            AI-generated content for informational purposes only. Not financial advice.
          </span>
        </div>
      </div>
      <BottomNav />
    </MobileLayout>
  )
}

// ── Export ────────────────────────────────────────────────────────────────────

export default function IdeasClient() {
  return (
    <>
      <div className="hidden md:block"><DesktopIdeasLab /></div>
      <div className="md:hidden"><MobileIdeasLab /></div>
    </>
  )
}

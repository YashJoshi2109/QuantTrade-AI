'use client'

/**
 * QuantTrade AI — Ideas Lab (Pro)
 * AI-powered trade idea generation with live market scanning
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import AppLayout from '@/components/AppLayout'
import BasketSnapshotModal from '@/components/BasketSnapshotModal'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Sparkles, TrendingUp, TrendingDown, RefreshCw, Activity,
  Target, Shield, Zap, ChevronDown, ChevronUp, BarChart3,
  Clock, Crosshair, AlertTriangle, Layers, ArrowUpRight,
  ArrowDownRight, Flame, Brain,
} from 'lucide-react'
import MobileLayout from '@/components/layout/MobileLayout'
import BottomNav from '@/components/layout/BottomNav'
import { getUser } from '@/lib/auth'
import TickerLogo from '@/components/TickerLogo'
import {
  generateIdeas, getTrendingIdeas,
  fetchBatchLoad, refreshIndex,
  type TradeIdea, type IdeasResponse,
  type IndexDefinition, type IndexSnapshot, type RegimeData,
} from '@/lib/api'
import { useMarketWebSocket } from '@/lib/websocket'

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
  { label: 'Scanning market universe', icon: '🔍' },
  { label: 'Detecting market regime', icon: '📊' },
  { label: 'Computing factor scores', icon: '🧮' },
  { label: 'Analyzing 166 stocks across 10 sectors', icon: '📈' },
  { label: 'Building AI baskets', icon: '🧠' },
  { label: 'Running risk analysis', icon: '🛡️' },
  { label: 'Almost ready...', icon: '✨' },
]

function BasketLoader({ progress: externalProgress }: { progress?: number }) {
  const [step, setStep] = useState(0)
  // Use external progress if provided (synced with API), otherwise internal animation
  const [internalProgress, setInternalProgress] = useState(0)
  const progress = externalProgress ?? internalProgress

  useEffect(() => {
    // When no external progress, animate internally (capped at 90%)
    if (externalProgress != null) return
    let elapsed = 0
    const interval = setInterval(() => {
      elapsed += 100
      // Asymptotic approach to 90% — never finishes without external signal
      setInternalProgress(Math.min(90 * (1 - Math.exp(-elapsed / 12000)), 90))
    }, 100)
    return () => clearInterval(interval)
  }, [externalProgress])

  useEffect(() => {
    // Map progress to step
    const stepIndex = Math.min(
      Math.floor((progress / 100) * LOADER_STEPS.length),
      LOADER_STEPS.length - 1
    )
    setStep(stepIndex)
  }, [progress])

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
          <span className="text-sm font-bold text-fg-primary">{currentStep.label}</span>
        </motion.div>
      </AnimatePresence>

      {/* Progress bar */}
      <div className="w-72 h-2 bg-surface-raised rounded-full overflow-hidden mb-3">
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
      <span className="text-xs text-fg-muted font-mono">{Math.round(progress)}%</span>

      {/* Step indicators */}
      <div className="flex items-center gap-1.5 mt-4">
        {LOADER_STEPS.map((_, i) => (
          <motion.div
            key={i}
            className={`w-1.5 h-1.5 rounded-full ${i <= step ? 'bg-violet-400' : 'bg-line-default'}`}
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
    <div className="bg-surface-raised border border-line-subtle/50 rounded-2xl p-5 animate-pulse">
      <div className="flex items-center gap-3 mb-4">
        <div className="h-7 w-16 bg-surface-raised rounded-full" />
        <div className="h-4 w-24 bg-surface-raised rounded" />
        <div className="ml-auto h-8 w-14 bg-surface-raised rounded-lg" />
      </div>
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="h-12 bg-surface-hover rounded-xl" />
        <div className="h-12 bg-surface-hover rounded-xl" />
        <div className="h-12 bg-surface-hover rounded-xl" />
      </div>
      <div className="h-3 w-full bg-surface-raised rounded mb-2" />
      <div className="h-3 w-2/3 bg-surface-raised rounded" />
    </div>
  )
}

function SkeletonPulse() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 animate-pulse">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="h-14 bg-surface-hover rounded-xl" />
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
          bg-surface-raised dark:bg-gradient-to-br dark:from-[#0F1629]/90 dark:to-[#0A0E1A]/90
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
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-surface-raised/80 border border-line-subtle text-fg-muted">
                  {idea.sector}
                </span>
                {/* Data source */}
                {idea.data_source && (
                  <span className="px-1.5 py-0.5 rounded-full text-[9px] font-mono bg-violet-500/10 border border-violet-500/20 text-violet-400">
                    {idea.data_source}
                  </span>
                )}
              </div>
              {/* Symbol + name */}
              <div className="flex items-center gap-2.5">
                <TickerLogo symbol={idea.symbol} companyName={idea.company_name} size={32} />
                <div className="flex items-baseline gap-2 min-w-0">
                  <Link
                    href={`/research?symbol=${idea.symbol}`}
                    onClick={e => e.stopPropagation()}
                    className="text-lg font-black text-fg-primary hover:text-cyan-300 transition-colors font-mono"
                  >
                    {idea.symbol}
                  </Link>
                  <span className="text-xs text-fg-muted truncate">{idea.company_name}</span>
                </div>
              </div>
            </div>
            {/* Confidence ring */}
            <ConfidenceRing value={idea.confidence} />
          </div>

          {/* Price levels */}
          <div className="grid grid-cols-3 gap-2 mb-4">
            <div className="bg-surface-raised/30 rounded-xl px-3 py-2 text-center">
              <div className="text-[9px] text-fg-muted uppercase tracking-wider mb-0.5">Entry</div>
              <div className="text-sm font-black text-fg-primary font-mono">
                ${idea.entry_price?.toFixed(2) ?? '--'}
              </div>
            </div>
            <div className={`bg-${dirColor}-500/5 rounded-xl px-3 py-2 text-center border border-${dirColor}-500/10`}>
              <div className="text-[9px] text-fg-muted uppercase tracking-wider mb-0.5">Target</div>
              <div className={`text-sm font-black font-mono text-${dirColor}-400`}>
                ${idea.target_price?.toFixed(2) ?? '--'}
              </div>
            </div>
            <div className="bg-orange-500/5 rounded-xl px-3 py-2 text-center border border-orange-500/10">
              <div className="text-[9px] text-fg-muted uppercase tracking-wider mb-0.5">Stop</div>
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
              <span className="text-xs text-fg-muted font-mono">
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
          <p className={`text-xs text-fg-muted leading-relaxed ${expanded ? '' : 'line-clamp-2'}`}>
            <Zap className="w-3 h-3 inline text-yellow-500 mr-1 -mt-px" />
            {idea.catalyst}
          </p>

          {/* Expand indicator */}
          <div className="flex justify-center mt-3">
            {expanded ? (
              <ChevronUp className="w-4 h-4 text-fg-muted" />
            ) : (
              <ChevronDown className="w-4 h-4 text-fg-muted group-hover:text-fg-muted transition-colors" />
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
                <div className="mt-4 pt-4 border-t border-line-subtle/50">
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <span className="text-fg-muted">Risk per share</span>
                      <div className="text-fg-primary font-mono font-bold">
                        ${idea.entry_price && idea.stop_loss
                          ? Math.abs(idea.entry_price - idea.stop_loss).toFixed(2)
                          : '--'}
                      </div>
                    </div>
                    <div>
                      <span className="text-fg-muted">Reward per share</span>
                      <div className="text-fg-primary font-mono font-bold">
                        ${idea.entry_price && idea.target_price
                          ? Math.abs(idea.target_price - idea.entry_price).toFixed(2)
                          : '--'}
                      </div>
                    </div>
                    <div>
                      <span className="text-fg-muted">Direction</span>
                      <div className={`font-bold ${isLong ? 'text-emerald-400' : 'text-red-400'}`}>
                        {isLong ? 'Bullish Setup' : 'Bearish Setup'}
                      </div>
                    </div>
                    <div>
                      <span className="text-fg-muted">Timeframe</span>
                      <div className="text-fg-primary font-bold">
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
                <TickerLogo symbol={s.symbol} companyName={s.company_name} size={20} />
                <span className="text-xs font-black text-emerald-400 font-mono w-12">{s.symbol}</span>
                <span className="text-[11px] text-fg-muted flex-1 truncate">{s.catalyst}</span>
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
                <TickerLogo symbol={s.symbol} companyName={s.company_name} size={20} />
                <span className="text-xs font-black text-red-400 font-mono w-12">{s.symbol}</span>
                <span className="text-[11px] text-fg-muted flex-1 truncate">{s.catalyst}</span>
                <span className="text-xs font-bold text-red-400 font-mono">{s.confidence}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sector rotation */}
      {pulse.sector_rotation && Object.keys(pulse.sector_rotation).length > 0 && (
        <div>
          <h3 className="text-xs font-bold text-fg-muted uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5" /> Sector Rotation
          </h3>
          <div className="grid grid-cols-2 gap-1.5">
            {Object.entries(pulse.sector_rotation).map(([sector, counts]) => {
              const bullish = counts.bullish ?? 0
              const bearish = counts.bearish ?? 0
              const total = bullish + bearish
              const bullPct = total > 0 ? (bullish / total) * 100 : 50
              return (
                <div key={sector} className="bg-surface-raised/30 rounded-lg px-3 py-2">
                  <div className="text-[10px] text-fg-muted mb-1">{sector}</div>
                  <div className="w-full h-1.5 bg-line-default/50 rounded-full overflow-hidden flex">
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

// ── Live Status Indicator ────────────────────────────────────────────────────

function LiveIndicator({ status, sources }: { status: 'connected' | 'connecting' | 'disconnected'; sources?: string[] }) {
  const colors = {
    connected: { dot: 'bg-emerald-500', ping: 'bg-emerald-400', text: 'text-emerald-400', label: 'LIVE' },
    connecting: { dot: 'bg-amber-500', ping: 'bg-amber-400', text: 'text-amber-400', label: 'CONNECTING' },
    disconnected: { dot: 'bg-surface-overlay', ping: 'bg-fg-muted', text: 'text-fg-muted', label: 'POLLING' },
  }
  const c = colors[status]
  return (
    <div className="flex items-center gap-1.5">
      <span className="relative flex h-2.5 w-2.5">
        {status === 'connected' && (
          <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${c.ping} opacity-75`} />
        )}
        <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${c.dot}`} />
      </span>
      <span className={`text-[10px] font-mono font-bold ${c.text}`}>{c.label}</span>
      {sources && sources.length > 0 && (
        <span className="text-[9px] text-fg-muted font-mono">
          via {sources.join(', ')}
        </span>
      )}
    </div>
  )
}

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
  const colorClass = colors[regime.regime] || 'from-slate-500/20 to-slate-600/20 border-slate-500/30 text-fg-muted'

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
        <span className="text-[10px] text-fg-muted">{label}</span>
        <span className="text-[10px] font-mono font-bold text-fg-primary">{score?.toFixed(0)}</span>
      </div>
      <div className="h-1.5 bg-surface-raised rounded-full overflow-hidden">
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
  onViewDetails,
}: {
  index: IndexDefinition
  snapshot: IndexSnapshot | null
  onRefresh: (id: string) => void
  refreshing: boolean
  onViewDetails?: (index: IndexDefinition, snapshot: IndexSnapshot) => void
}) {
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
      className="relative overflow-hidden rounded-2xl border border-line-subtle/50 bg-surface-raised dark:bg-gradient-to-br dark:from-[#0F1629]/90 dark:to-[#0A0E1A]/90 hover:border-cyan-500/20 transition-all duration-300"
    >
      {/* Top accent */}
      <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-violet-500/60 via-cyan-500/40 to-transparent" />

      <div className="p-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${categoryColors[index.category] || 'bg-surface-raised border-line-default text-fg-muted'}`}>
                {index.category}
              </span>
              <span className={`text-[10px] font-bold ${riskColors[index.risk_profile] || 'text-fg-muted'}`}>
                {index.risk_profile} Risk
              </span>
            </div>
            <h3 className="text-base font-black text-fg-primary">{index.short_name}</h3>
            <p className="text-[11px] text-fg-muted mt-0.5 line-clamp-2">{index.description}</p>
          </div>

          {hasData && (
            <ConfidenceRing value={Math.round(snapshot!.avg_ai_score || 0)} size={48} />
          )}
        </div>

        {/* Quick stats when data available */}
        {hasData && (
          <div className="grid grid-cols-4 gap-2 mb-3">
            {[
              { label: 'Holdings', value: snapshot!.num_holdings, color: 'text-fg-primary' },
              { label: 'Avg Score', value: `${snapshot!.avg_ai_score?.toFixed(0)}`, color: 'text-cyan-400' },
              { label: 'Beta', value: snapshot!.portfolio_beta?.toFixed(2), color: 'text-blue-400' },
              { label: 'Risk', value: snapshot!.risk_level, color: riskColors[snapshot!.risk_level || ''] || 'text-fg-muted' },
            ].map(s => (
              <div key={s.label} className="bg-surface-raised/30 rounded-lg px-2 py-1.5 text-center">
                <div className="text-[8px] text-fg-muted uppercase">{s.label}</div>
                <div className={`text-xs font-black font-mono ${s.color}`}>{s.value}</div>
              </div>
            ))}
          </div>
        )}

        {/* Sector allocation bar */}
        {hasData && snapshot!.sector_allocation && (
          <div className="mb-3">
            <div className="text-[9px] text-fg-muted uppercase mb-1">Sector Allocation</div>
            <div className="h-2 rounded-full overflow-hidden flex bg-surface-raised/50">
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
                <span key={sector} className="text-[9px] text-fg-muted">{sector} {pct.toFixed(0)}%</span>
              ))}
            </div>
          </div>
        )}

        {/* View Details / Generate buttons */}
        <div className="flex items-center gap-2">
          {hasData ? (
            <button
              onClick={() => onViewDetails?.(index, snapshot!)}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-surface-raised/50 border border-line-default/30 text-xs font-bold text-fg-primary hover:bg-line-default/50 hover:border-cyan-500/20 transition-all"
            >
              <Layers className="w-3.5 h-3.5" />
              View {snapshot!.num_holdings} Holdings
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
              className="p-2 rounded-xl bg-surface-raised/50 border border-line-default/30 text-fg-muted hover:text-cyan-400 transition-all disabled:opacity-40"
              title="Refresh basket"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
          )}
        </div>

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
  const isAuthed = typeof window !== 'undefined' && !!getUser()

  // ── Basket state ──────────────────────────────────────────────────────────
  const [indices, setIndices] = useState<IndexDefinition[]>([])
  const [snapshots, setSnapshots] = useState<Record<string, IndexSnapshot>>({})
  const [regime, setRegime] = useState<RegimeData | null>(null)
  const [basketLoading, setBasketLoading] = useState(true)
  const [basketLoadProgress, setBasketLoadProgress] = useState(0)
  const [refreshingIndex, setRefreshingIndex] = useState<string | null>(null)
  const [modalBasket, setModalBasket] = useState<{ index: IndexDefinition; snapshot: IndexSnapshot } | null>(null)
  const [dataSources, setDataSources] = useState<string[]>([])
  const qc = useQueryClient()

  // ── Real-time WebSocket for live ideas updates ────────────────────────────
  const { isConnected, connectionStatus, lastMessage } = useMarketWebSocket({
    channel: 'ideas',
    token: null, // Auth handled via httpOnly cookies
    onMessage: (msg) => {
      if (msg.type === 'ideas_update' && msg.data?.ideas) {
        setIdeas(msg.data.ideas)
        if (msg.data.market_pulse) setPulse(msg.data.market_pulse)
        if (msg.data.data_sources_used) setDataSources(msg.data.data_sources_used)
      } else if (msg.type === 'pulse_update' && msg.data) {
        setPulse(prev => ({ ...prev, ...msg.data }))
      } else if (msg.type === 'news_update') {
        // News triggered rescore — refresh ideas
        loadTrending()
      }
    },
    enabled: true,
  })

  // Polling fallback when WebSocket is disconnected (every 60s)
  useEffect(() => {
    if (isConnected) return
    const interval = setInterval(() => {
      loadTrending()
    }, 60000)
    return () => clearInterval(interval)
  }, [isConnected])

  // Load basket data — uses React Query cache (prefetched by PrefetchEngine)
  useEffect(() => {
    loadBasketData()
  }, [])

  const loadBasketData = async () => {
    setBasketLoading(true)
    setBasketLoadProgress(10)
    try {
      // Check if PrefetchEngine already warmed the cache
      const cached = qc.getQueryData<{ indices: IndexDefinition[]; snapshots: Record<string, IndexSnapshot>; regime: RegimeData | null }>(['modelIndexBatch'])
      setBasketLoadProgress(cached ? 80 : 30)

      let batch: { indices: IndexDefinition[]; snapshots: Record<string, IndexSnapshot>; regime: RegimeData | null }
      try {
        batch = cached || await fetchBatchLoad()
      } catch {
        // Batch failed — fall back to just loading index definitions
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || ''}/api/v1/model-index/indices`)
        const data = await res.json()
        batch = { indices: data.indices || [], snapshots: {}, regime: null }
      }
      setBasketLoadProgress(90)

      setIndices(batch.indices)
      if (batch.regime) setRegime(batch.regime)
      const validSnaps: Record<string, IndexSnapshot> = {}
      for (const [id, snap] of Object.entries(batch.snapshots || {})) {
        if (snap?.holdings?.length > 0) validSnaps[id] = snap
      }
      setSnapshots(validSnaps)
      setBasketLoadProgress(100)
    } catch (err) {
      console.error('Failed to load basket data:', err)
      setError(err instanceof Error ? err.message : 'Failed to load baskets — please refresh.')
    } finally {
      setBasketLoading(false)
    }
  }

  const handleRefreshIndex = async (indexId: string) => {
    if (!isAuthed) {
      setError('Sign in to generate AI baskets')
      return
    }
    setError(null)
    setRefreshingIndex(indexId)
    try {
      const snap = await refreshIndex(indexId, true, true)
      if (snap && 'error' in snap && snap.error) {
        setError(typeof snap.error === 'string' ? snap.error : 'Basket generation failed')
        return
      }
      if (snap && Array.isArray(snap.holdings) && snap.holdings.length > 0) {
        setSnapshots(prev => ({ ...prev, [indexId]: snap as IndexSnapshot }))
      } else {
        setError('No holdings returned — check market data and database seed.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate basket. Please try again.')
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
      if (res.data_sources_used) setDataSources(res.data_sources_used)
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
      if (res.data_sources_used) setDataSources(res.data_sources_used)
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
      <div className="min-h-screen bg-surface-base -mx-4 md:-mx-6 -my-4 md:-my-6">
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
                    <h1 className="text-xl font-black text-fg-primary">AI Ideas Lab</h1>
                    <LiveIndicator status={connectionStatus} sources={dataSources} />
                  </div>
                  <p className="text-[11px] text-fg-muted mt-0.5">
                    Real-time AI stock baskets & trade setups
                  </p>
                </div>
              </div>

              {/* Tab switcher */}
              <div className="flex items-center gap-1 bg-surface-raised/80 dark:bg-[#0F1629]/80 border border-line-subtle/50 rounded-xl p-1 mr-3">
                <button
                  onClick={() => setActiveTab('baskets')}
                  className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                    activeTab === 'baskets'
                      ? 'bg-violet-500/15 text-violet-400 border border-violet-500/25'
                      : 'text-fg-muted hover:text-fg-primary border border-transparent'
                  }`}
                >
                  <Layers className="w-3.5 h-3.5" /> AI Baskets
                </button>
                <button
                  onClick={() => setActiveTab('ideas')}
                  className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                    activeTab === 'ideas'
                      ? 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/25'
                      : 'text-fg-muted hover:text-fg-primary border border-transparent'
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
                { label: 'Total Ideas', value: ideas.length, color: 'text-fg-primary', icon: Crosshair },
                { label: 'Bullish', value: bullishCount, color: 'text-emerald-400', icon: TrendingUp },
                { label: 'Bearish', value: bearishCount, color: 'text-red-400', icon: TrendingDown },
                { label: 'Avg Confidence', value: `${avgConfidence}%`, color: 'text-cyan-400', icon: Activity },
              ].map(s => (
                <div key={s.label} className="bg-surface-raised/80 dark:bg-[#0F1629]/80 border border-line-subtle/50 rounded-xl px-4 py-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <s.icon className="w-3 h-3 text-fg-muted" />
                    <span className="text-[10px] text-fg-muted uppercase tracking-wider">{s.label}</span>
                  </div>
                  <div className={`text-xl font-black ${s.color} font-mono`}>{s.value}</div>
                </div>
              ))}
            </div>

            {/* Filters Bar */}
            <div className="flex items-center gap-3 flex-wrap">
              {/* Sentiment */}
              <div className="flex items-center gap-1 bg-surface-raised/80 dark:bg-[#0F1629]/80 border border-line-subtle/50 rounded-xl p-1">
                {(['all', 'bullish', 'bearish'] as const).map(s => (
                  <button
                    key={s}
                    onClick={() => setSentiment(s)}
                    className={`px-4 py-1.5 rounded-lg text-xs font-bold capitalize transition-all ${
                      sentiment === s
                        ? s === 'bullish' ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25'
                          : s === 'bearish' ? 'bg-red-500/15 text-red-400 border border-red-500/25'
                          : 'bg-line-default/50 text-fg-primary border border-line-default/30'
                        : 'text-fg-muted hover:text-fg-primary border border-transparent'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>

              {/* Timeframe */}
              <div className="flex items-center gap-1 bg-surface-raised/80 dark:bg-[#0F1629]/80 border border-line-subtle/50 rounded-xl p-1">
                {(['all', 'intraday', 'swing', 'position'] as const).map(t => (
                  <button
                    key={t}
                    onClick={() => setTimeframe(t)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold capitalize transition-all ${
                      timeframe === t
                        ? 'bg-blue-500/15 text-blue-400 border border-blue-500/25'
                        : 'text-fg-muted hover:text-fg-primary border border-transparent'
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
                className="bg-surface-raised/80 dark:bg-[#0F1629]/80 border border-line-subtle/50 rounded-xl px-3 py-2 text-xs font-bold text-fg-primary outline-none focus:border-cyan-500/30 cursor-pointer appearance-none"
                style={{ backgroundImage: 'none' }}
              >
                {SECTORS.map(s => (
                  <option key={s} value={s} className="bg-surface-raised dark:bg-[#0F1629] text-fg-primary">{s}</option>
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
          {/* Use display:none instead of conditional render to prevent remount/progress reset on tab switch */}
          <div style={{ display: activeTab === 'baskets' ? undefined : 'none' }}>
            {/* ── AI BASKETS TAB ─────────────────────────── */}
              {/* Regime indicator */}
              <div className="flex items-center gap-3 mb-6">
                <RegimeBadge regime={regime} />
                {regime?.signals && (
                  <div className="flex items-center gap-3 text-[10px] text-fg-muted">
                    {regime.signals.vix != null && <span>VIX: <strong className="text-fg-muted">{regime.signals.vix?.toFixed(1)}</strong></span>}
                    <span>Breadth: <strong className="text-fg-muted">{regime.signals.breadth_sma200_pct?.toFixed(0)}%</strong></span>
                    <span>Momentum: <strong className="text-fg-muted">{regime.signals.momentum_breadth_pct?.toFixed(0)}%</strong></span>
                  </div>
                )}
              </div>

              {basketLoading ? (
                <BasketLoader progress={basketLoadProgress} />
              ) : indices.length === 0 ? (
                <div className="text-center py-20">
                  <Layers className="w-10 h-10 text-fg-muted mx-auto mb-3" />
                  <p className="text-sm text-fg-muted">No basket indices configured</p>
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
                      onViewDetails={(i, s) => setModalBasket({ index: i, snapshot: s })}
                    />
                  ))}
                </div>
              )}

              {/* Basket Snapshot Modal */}
              <AnimatePresence>
                {modalBasket && (
                  <BasketSnapshotModal
                    index={modalBasket.index}
                    snapshot={modalBasket.snapshot as any}
                    onClose={() => setModalBasket(null)}
                  />
                )}
              </AnimatePresence>

              {/* Disclaimer */}
              <div className="flex items-start gap-2 px-4 py-3 mt-6 bg-amber-500/5 border border-amber-500/15 rounded-xl">
                <Shield className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <span className="text-[10px] text-fg-muted leading-relaxed">
                  AI-generated baskets are for informational purposes only. Not financial advice.
                  Multi-factor scoring uses real market data but past performance does not guarantee future results.
                </span>
              </div>
          </div>
          <div style={{ display: activeTab === 'ideas' ? undefined : 'none' }}>
            {/* ── TRADE IDEAS TAB ─────────────────────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
              {/* Ideas grid — 3 cols */}
              <div className="lg:col-span-3">
                {loading ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {[...Array(6)].map((_, i) => <SkeletonCard key={i} />)}
                  </div>
                ) : filtered.length === 0 ? (
                  <div className="text-center py-20">
                    <Crosshair className="w-10 h-10 text-fg-muted mx-auto mb-3" />
                    <p className="text-sm text-fg-muted">No ideas match current filters</p>
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
                <div className="bg-surface-raised/80 dark:bg-[#0F1629]/80 border border-line-subtle/50 rounded-2xl p-4">
                  <h2 className="text-sm font-bold text-fg-primary mb-4 flex items-center gap-2">
                    <Activity className="w-4 h-4 text-cyan-400" />
                    Market Pulse
                  </h2>
                  <MarketPulse pulse={pulse} loading={loading} />
                </div>

                {/* Disclaimer */}
                <div className="flex items-start gap-2 px-4 py-3 bg-amber-500/5 border border-amber-500/15 rounded-xl">
                  <Shield className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <span className="text-[10px] text-fg-muted leading-relaxed">
                    AI-generated ideas are for informational purposes only. Not financial advice.
                    Always do your own due diligence before trading.
                  </span>
                </div>
              </div>
            </div>
          </div>
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
  const isAuthed = typeof window !== 'undefined' && !!getUser()
  const mqc = useQueryClient()

  // WebSocket for mobile
  const { connectionStatus: mobileWsStatus } = useMarketWebSocket({
    channel: 'ideas',
    onMessage: (msg) => {
      if (msg.type === 'ideas_update' && msg.data?.ideas) {
        setIdeas(msg.data.ideas)
        if (msg.data.market_pulse) setPulse(msg.data.market_pulse)
      }
    },
    enabled: true,
  })

  // Basket state
  const [indices, setIndices] = useState<IndexDefinition[]>([])
  const [snapshots, setSnapshots] = useState<Record<string, IndexSnapshot>>({})
  const [regime, setRegime] = useState<RegimeData | null>(null)
  const [basketLoading, setBasketLoading] = useState(true)
  const [basketLoadProgress, setBasketLoadProgress] = useState(0)
  const [refreshingIndex, setRefreshingIndex] = useState<string | null>(null)
  const [modalBasket, setModalBasket] = useState<{ index: IndexDefinition; snapshot: IndexSnapshot } | null>(null)

  useEffect(() => {
    loadTrending()
    loadBaskets()
  }, [])

  const loadBaskets = async () => {
    setBasketLoading(true)
    setBasketLoadProgress(10)
    try {
      // Check PrefetchEngine cache first
      const cached = mqc.getQueryData<{ indices: IndexDefinition[]; snapshots: Record<string, IndexSnapshot>; regime: RegimeData | null }>(['modelIndexBatch'])
      setBasketLoadProgress(cached ? 80 : 30)

      let batch: { indices: IndexDefinition[]; snapshots: Record<string, IndexSnapshot>; regime: RegimeData | null }
      try {
        batch = cached || await fetchBatchLoad()
      } catch {
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || ''}/api/v1/model-index/indices`)
        const data = await res.json()
        batch = { indices: data.indices || [], snapshots: {}, regime: null }
      }
      setBasketLoadProgress(90)
      setIndices(batch.indices)
      if (batch.regime) setRegime(batch.regime)
      const validSnaps: Record<string, IndexSnapshot> = {}
      for (const [id, snap] of Object.entries(batch.snapshots || {})) {
        if (snap?.holdings?.length > 0) validSnaps[id] = snap
      }
      setSnapshots(validSnaps)
      setBasketLoadProgress(100)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load baskets — please refresh.')
    } finally { setBasketLoading(false) }
  }

  const handleRefreshIndex = async (indexId: string) => {
    if (!isAuthed) { setError('Sign in to generate AI baskets'); return }
    setError(null)
    setRefreshingIndex(indexId)
    try {
      const snap = await refreshIndex(indexId, true, true)
      if (snap && 'error' in snap && snap.error) {
        setError(typeof snap.error === 'string' ? snap.error : 'Basket generation failed')
        return
      }
      if (snap && Array.isArray(snap.holdings) && snap.holdings.length > 0) {
        setSnapshots(prev => ({ ...prev, [indexId]: snap as IndexSnapshot }))
      } else {
        setError('No holdings returned — check market data and database seed.')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate basket')
    } finally { setRefreshingIndex(null) }
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
            <h1 className="text-lg font-black text-fg-primary">AI Ideas Lab</h1>
            <LiveIndicator status={mobileWsStatus} />
          </div>
        </div>

        {/* Tab switcher */}
        <div className="flex items-center gap-1 bg-surface-raised/80 dark:bg-[#0F1629]/80 border border-line-subtle/50 rounded-xl p-1 mb-4">
          <button
            onClick={() => setMobileTab('baskets')}
            className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
              mobileTab === 'baskets' ? 'bg-violet-500/15 text-violet-400' : 'text-fg-muted'
            }`}
          >
            <Layers className="w-3.5 h-3.5" /> AI Baskets
          </button>
          <button
            onClick={() => setMobileTab('ideas')}
            className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
              mobileTab === 'ideas' ? 'bg-cyan-500/15 text-cyan-400' : 'text-fg-muted'
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

        <div style={{ display: mobileTab === 'baskets' ? undefined : 'none' }}>
          {/* Baskets tab */}
            <RegimeBadge regime={regime} />
            <div className="mt-4 space-y-4">
              {basketLoading ? (
                <BasketLoader progress={basketLoadProgress} />
              ) : (
                <>
                  {indices.map(idx => (
                    <BasketCard
                      key={idx.index_id}
                      index={idx}
                      snapshot={snapshots[idx.index_id] || null}
                      onRefresh={handleRefreshIndex}
                      refreshing={refreshingIndex === idx.index_id}
                      onViewDetails={(i, s) => setModalBasket({ index: i, snapshot: s })}
                    />
                  ))}
                  <AnimatePresence>
                    {modalBasket && (
                      <BasketSnapshotModal
                        index={modalBasket.index}
                        snapshot={modalBasket.snapshot as any}
                        onClose={() => setModalBasket(null)}
                      />
                    )}
                  </AnimatePresence>
                </>
              )}
            </div>
        </div>
        <div style={{ display: mobileTab === 'ideas' ? undefined : 'none' }}>
          {/* Ideas tab */}
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
              <div className="bg-surface-raised/80 dark:bg-[#0F1629]/80 border border-line-subtle/50 rounded-xl px-3 py-2 text-center">
                <div className="text-[9px] text-fg-muted uppercase">Ideas</div>
                <div className="text-base font-black text-fg-primary font-mono">{ideas.length}</div>
              </div>
              <div className="bg-surface-raised/80 dark:bg-[#0F1629]/80 border border-line-subtle/50 rounded-xl px-3 py-2 text-center">
                <div className="text-[9px] text-emerald-500 uppercase">Bull</div>
                <div className="text-base font-black text-emerald-400 font-mono">{ideas.filter(i => i.idea_type === 'long').length}</div>
              </div>
              <div className="bg-surface-raised/80 dark:bg-[#0F1629]/80 border border-line-subtle/50 rounded-xl px-3 py-2 text-center">
                <div className="text-[9px] text-red-500 uppercase">Bear</div>
                <div className="text-base font-black text-red-400 font-mono">{ideas.filter(i => i.idea_type === 'short').length}</div>
              </div>
            </div>

            {/* Sentiment filter */}
            <div className="flex items-center gap-1 bg-surface-raised/80 dark:bg-[#0F1629]/80 border border-line-subtle/50 rounded-xl p-1 mb-4">
          {(['all', 'bullish', 'bearish'] as const).map(s => (
            <button
              key={s}
              onClick={() => setSentiment(s)}
              className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-bold capitalize transition-all ${
                sentiment === s
                  ? s === 'bullish' ? 'bg-emerald-500/15 text-emerald-400'
                    : s === 'bearish' ? 'bg-red-500/15 text-red-400'
                    : 'bg-line-default/50 text-fg-primary'
                  : 'text-fg-muted'
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
          <div className="mt-6 bg-surface-raised/80 dark:bg-[#0F1629]/80 border border-line-subtle/50 rounded-2xl p-4">
            <h2 className="text-sm font-bold text-fg-primary mb-3 flex items-center gap-2">
              <Activity className="w-4 h-4 text-cyan-400" /> Market Pulse
            </h2>
            <MarketPulse pulse={pulse} loading={false} />
          </div>
        )}
        </div>

        {/* Disclaimer */}
        <div className="flex items-start gap-2 px-3 py-2.5 mt-4 bg-amber-500/5 border border-amber-500/15 rounded-xl">
          <Shield className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
          <span className="text-[10px] text-fg-muted leading-relaxed">
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

'use client'

import { useMemo } from 'react'
import type { Indicators, FundamentalsData } from '@/lib/api'
import { generateKeyFactors, netBias, type KeyFactor, type FactorIcon } from '@/lib/keyFactors'
import {
  Activity,
  BarChart3,
  CalendarClock,
  Gauge,
  LineChart,
  Scale,
  Shield,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  Zap,
} from 'lucide-react'

/* ────────────────── Style Maps ────────────────── */

const ICONS: Record<FactorIcon, React.ComponentType<{ className?: string }>> = {
  trend: TrendingUp,
  trendDown: TrendingDown,
  momentum: Zap,
  volatility: Activity,
  macd: BarChart3,
  valuation: Scale,
  quality: Sparkles,
  shield: Shield,
  target: Target,
  range: LineChart,
  event: CalendarClock,
}

const BIAS_STYLES = {
  Bullish: { border: 'border-l-emerald-500', bg: 'bg-emerald-500/5', icon: 'text-emerald-400', bar: '#10B981', badge: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  Bearish: { border: 'border-l-red-500', bg: 'bg-red-500/5', icon: 'text-red-400', bar: '#EF4444', badge: 'bg-red-500/15 text-red-400 border-red-500/30' },
  Neutral: { border: 'border-l-amber-500', bg: 'bg-amber-500/5', icon: 'text-amber-400', bar: '#F59E0B', badge: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
} as const

const IMPACT_STYLES = {
  High: 'bg-red-500/15 text-red-300 border-red-500/30',
  Medium: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  Low: 'bg-surface-raised text-fg-secondary border-line-subtle',
} as const

/* ────────────────── Factor Card ────────────────── */

function FactorCard({ factor }: { factor: KeyFactor }) {
  const s = BIAS_STYLES[factor.bias]
  const Icon = ICONS[factor.icon]
  return (
    <div className={`rounded-lg border-l-2 ${s.border} ${s.bg} p-3 backdrop-blur-sm flex flex-col gap-2 min-w-0`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Icon className={`w-4 h-4 shrink-0 ${s.icon}`} />
          <span className="text-[13px] font-bold text-white leading-tight truncate">{factor.title}</span>
        </div>
        <span className="text-[9px] uppercase tracking-wider text-fg-muted shrink-0 mt-0.5">{factor.category}</span>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${IMPACT_STYLES[factor.impact]}`}>{factor.impact}</span>
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${s.badge}`}>{factor.bias}</span>
        <div className="flex-1 min-w-[60px] flex items-center gap-1.5" title="Signal strength — how far past its threshold the reading is (not a probability)">
          <div className="h-1 flex-1 bg-surface-raised rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all duration-500" style={{ width: `${factor.strength}%`, backgroundColor: s.bar }} />
          </div>
          <span className="text-[10px] text-fg-secondary font-mono">{factor.strength}</span>
        </div>
      </div>
      <p className="text-[11px] text-fg-muted leading-relaxed">{factor.description}</p>
    </div>
  )
}

/* ────────────────── Bias meter ────────────────── */

function BiasMeter({ factors }: { factors: KeyFactor[] }) {
  const net = netBias(factors)
  const bull = factors.filter((f) => f.bias === 'Bullish').length
  const bear = factors.filter((f) => f.bias === 'Bearish').length
  const neu = factors.length - bull - bear
  const label = net >= 25 ? 'Leaning Bullish' : net <= -25 ? 'Leaning Bearish' : 'Mixed'
  const color = net >= 25 ? 'text-emerald-400' : net <= -25 ? 'text-red-400' : 'text-amber-400'
  return (
    <div className="rounded-xl border border-line-subtle bg-surface-raised/40 p-3 mb-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 text-[11px] text-fg-muted">
          <Gauge className="w-3.5 h-3.5" /> Net factor bias
        </div>
        <span className={`text-xs font-bold ${color}`}>
          {label} <span className="font-mono">({net > 0 ? '+' : ''}{net})</span>
        </span>
      </div>
      {/* −100 … +100 track with marker */}
      <div className="relative h-1.5 rounded-full bg-gradient-to-r from-red-500/60 via-amber-500/40 to-emerald-500/60">
        <div className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-white shadow ring-2 ring-black/40" style={{ left: `calc(${(net + 100) / 2}% - 5px)` }} />
      </div>
      <div className="flex justify-between mt-2 text-[10px] font-mono">
        <span className="text-emerald-400">{bull} bullish</span>
        <span className="text-amber-400">{neu} neutral</span>
        <span className="text-red-400">{bear} bearish</span>
      </div>
    </div>
  )
}

/* ────────────────── Main Component ────────────────── */

interface KeyFactorsPanelProps {
  indicators: Indicators | null
  fundamentals: FundamentalsData | null
  price: number | undefined
  loading?: boolean
}

export default function KeyFactorsPanel({ indicators, fundamentals, price, loading }: KeyFactorsPanelProps) {
  const factors = useMemo(() => generateKeyFactors(indicators, fundamentals, price), [indicators, fundamentals, price])

  if (loading) {
    return (
      <div key="loading" className="hud-panel p-5 h-full animate-pulse">
        <div className="h-4 w-32 bg-[#1F2630] rounded mb-4" />
        <div className="h-16 bg-[#1F2630] rounded-xl mb-3" />
        <div className="grid gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="h-24 bg-[#1F2630] rounded-lg" />)}
        </div>
      </div>
    )
  }

  return (
    // Distinct key from the loading shell: React mounts a fresh node instead of
    // restyling the pulsing skeleton in place, which Chrome scored as a ~1.0 layout shift.
    <div key="loaded" className="hud-panel p-4 sm:p-5 h-full flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Target className="w-4 h-4 text-orange-400" />
          <h3 className="font-bold text-sm text-white tracking-wide">Key Factors</h3>
        </div>
        <span className="text-[10px] font-mono text-fg-muted">{factors.length} signals</span>
      </div>

      {factors.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center gap-2 py-10">
          <Activity className="w-6 h-6 text-fg-muted" />
          <p className="text-xs text-fg-muted max-w-[16rem]">
            Not enough technical or fundamental data yet. Use Sync Data to load indicators and fundamentals.
          </p>
        </div>
      ) : (
        <>
          <BiasMeter factors={factors} />
          {/* 2-up on wide panels, single column on phones; scrolls inside the panel if very long */}
          <div className="grid gap-3 sm:grid-cols-2 flex-1 content-start overflow-y-auto pr-1 max-h-[880px]">
            {factors.map((factor) => <FactorCard key={factor.id} factor={factor} />)}
          </div>
          <p className="mt-3 text-[10px] text-fg-muted">Rule-based readings of the data shown on this page. Not investment advice.</p>
        </>
      )}
    </div>
  )
}

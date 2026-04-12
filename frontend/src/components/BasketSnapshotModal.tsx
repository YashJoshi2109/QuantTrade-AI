'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Link from 'next/link'
import {
  X, Shield, Brain, Target, BarChart3, AlertTriangle,
  Layers, TrendingUp, TrendingDown, Zap, Activity,
  ChevronDown, ChevronUp, ArrowUpRight,
} from 'lucide-react'

// ── Types ────────────────────────────────────────────────────────────────────

interface Holding {
  ticker: string
  company_name: string | null
  sector: string | null
  weight_pct: number
  overall_ai_score: number
  grade: string | null
  fundamental_score?: number | null
  technical_score?: number | null
  valuation_score?: number | null
  quality_score?: number | null
  sentiment_score?: number | null
  macro_fit_score?: number | null
  risk_score?: number | null
  confidence_score?: number | null
  role?: { role_label: string; description?: string } | null
}

interface IndexDef {
  index_id: string
  short_name: string
  description: string
  category: string
  risk_profile: string
  strategy_type?: string
}

interface Snapshot {
  holdings: Holding[]
  num_holdings: number
  avg_ai_score: number
  portfolio_beta?: number | null
  portfolio_volatility_ann?: number | null
  risk_level?: string | null
  risk_score?: number | null
  regime?: string | null
  regime_confidence?: number | null
  factor_exposure?: Record<string, number> | null
  sector_allocation?: Record<string, number> | null
  monte_carlo?: {
    bull_case: { return_pct: number }
    base_case: { return_pct: number }
    bear_case: { return_pct: number }
  } | null
  explanation?: {
    basket_thesis?: string
    top_risks?: string[]
  } | null
  scenarios?: Array<{
    scenario_label: string
    projected_basket_return_pct: number
  }> | null
  generated_at?: string | null
}

// Use a type assertion at call sites instead of index signature

interface Props {
  index: IndexDef
  snapshot: Snapshot
  onClose: () => void
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const CATEGORY_COLORS: Record<string, string> = {
  Growth: 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400',
  Defensive: 'bg-blue-500/10 border-blue-500/25 text-blue-400',
  Value: 'bg-amber-500/10 border-amber-500/25 text-amber-400',
  Momentum: 'bg-violet-500/10 border-violet-500/25 text-violet-400',
  Core: 'bg-cyan-500/10 border-cyan-500/25 text-cyan-400',
  Thematic: 'bg-pink-500/10 border-pink-500/25 text-pink-400',
  Macro: 'bg-orange-500/10 border-orange-500/25 text-orange-400',
  Tactical: 'bg-red-500/10 border-red-500/25 text-red-400',
}

const RISK_COLORS: Record<string, string> = {
  Low: 'text-emerald-400',
  'Low-Medium': 'text-green-400',
  Medium: 'text-amber-400',
  High: 'text-orange-400',
  'Very High': 'text-red-400',
}

const SECTOR_BAR_COLORS = [
  'bg-violet-500', 'bg-cyan-500', 'bg-emerald-500', 'bg-amber-500',
  'bg-blue-500', 'bg-pink-500', 'bg-orange-500', 'bg-red-500',
  'bg-green-500', 'bg-indigo-500', 'bg-teal-500', 'bg-fuchsia-500',
]

function gradeColor(grade: string | null): string {
  if (grade?.startsWith('A')) return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
  if (grade?.startsWith('B')) return 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30'
  if (grade?.startsWith('C')) return 'bg-amber-500/15 text-amber-400 border-amber-500/30'
  return 'bg-red-500/15 text-red-400 border-red-500/30'
}

function scoreColor(score: number): string {
  if (score >= 75) return 'text-emerald-400'
  if (score >= 55) return 'text-cyan-400'
  if (score >= 40) return 'text-amber-400'
  return 'text-red-400'
}

// ── Factor Bar ───────────────────────────────────────────────────────────────

function FactorBar({ label, score }: { label: string; score: number }) {
  const color = score >= 70 ? 'bg-emerald-500' : score >= 55 ? 'bg-cyan-500' : score >= 40 ? 'bg-amber-500' : 'bg-red-500'
  return (
    <div>
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-[10px] text-slate-400 capitalize">{label.replace(/_/g, ' ')}</span>
        <span className="text-[10px] font-mono font-bold text-slate-300">{score?.toFixed(0)}</span>
      </div>
      <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${Math.min(score, 100)}%` }}
          transition={{ duration: 0.6, delay: 0.2, ease: 'easeOut' }}
          className={`h-full rounded-full ${color}`}
        />
      </div>
    </div>
  )
}

// ── Holding Detail Row ───────────────────────────────────────────────────────

function HoldingRow({ h, rank }: { h: Holding; rank: number }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="group">
      <div
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-slate-800/20 hover:bg-slate-800/40 transition-colors cursor-pointer"
      >
        <span className="text-[10px] text-slate-600 font-mono w-5 text-right">{rank}</span>
        <Link
          href={`/research?symbol=${h.ticker}`}
          onClick={(e) => e.stopPropagation()}
          className="text-xs font-black text-white hover:text-cyan-300 transition-colors font-mono min-w-[52px]"
        >
          {h.ticker}
        </Link>
        <span className="text-[10px] text-slate-500 flex-1 truncate">{h.company_name || ''}</span>
        <span className="text-[10px] text-slate-600 hidden md:inline w-24 truncate">{h.sector || ''}</span>
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${gradeColor(h.grade)}`}>
          {h.grade || '—'}
        </span>
        <span className={`text-[10px] font-bold font-mono w-8 text-right ${scoreColor(h.overall_ai_score)}`}>
          {h.overall_ai_score?.toFixed(0)}
        </span>
        <span className="text-[10px] text-slate-400 font-mono w-12 text-right">
          {h.weight_pct?.toFixed(1)}%
        </span>
        {expanded ? (
          <ChevronUp className="w-3 h-3 text-slate-600" />
        ) : (
          <ChevronDown className="w-3 h-3 text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity" />
        )}
      </div>

      {/* Expanded factor scores */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 py-3 ml-8 mr-2 mb-1 bg-slate-800/20 rounded-lg border border-slate-800/40">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[10px]">
                {[
                  { label: 'Fundamental', value: h.fundamental_score },
                  { label: 'Technical', value: h.technical_score },
                  { label: 'Valuation', value: h.valuation_score },
                  { label: 'Quality', value: h.quality_score },
                  { label: 'Sentiment', value: h.sentiment_score },
                  { label: 'Macro Fit', value: h.macro_fit_score },
                  { label: 'Risk', value: h.risk_score },
                  { label: 'Confidence', value: h.confidence_score },
                ].map((s) =>
                  s.value != null ? (
                    <div key={s.label}>
                      <span className="text-slate-500">{s.label}</span>
                      <div className={`font-mono font-bold ${scoreColor(s.value)}`}>
                        {s.value.toFixed(1)}
                      </div>
                    </div>
                  ) : null
                )}
              </div>
              {h.role?.role_label && (
                <div className="mt-2 pt-2 border-t border-slate-800/50">
                  <span className="text-[9px] text-violet-400 font-bold uppercase">{h.role.role_label}</span>
                  {h.role.description && (
                    <p className="text-[10px] text-slate-500 mt-0.5">{h.role.description}</p>
                  )}
                </div>
              )}
              <Link
                href={`/research?symbol=${h.ticker}`}
                onClick={(e) => e.stopPropagation()}
                className="mt-2 flex items-center justify-center gap-1.5 w-full py-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-[10px] font-bold hover:bg-cyan-500/20 transition-all"
              >
                <BarChart3 className="w-3 h-3" /> Full Research
                <ArrowUpRight className="w-3 h-3" />
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Main Modal ───────────────────────────────────────────────────────────────

export default function BasketSnapshotModal({ index, snapshot, onClose }: Props) {
  // Prevent body scroll
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  // Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const catColor = CATEGORY_COLORS[index.category] || 'bg-slate-800 border-slate-700 text-slate-400'
  const riskColor = RISK_COLORS[snapshot.risk_level || index.risk_profile] || 'text-slate-400'
  const mc = snapshot.monte_carlo

  return (
    <>
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="fixed inset-0 z-[999] cursor-pointer"
        style={{ backdropFilter: 'blur(20px) saturate(1.5)', background: 'rgba(2,6,23,0.8)' }}
        onClick={onClose}
      />

      {/* Modal */}
      <motion.div
        initial={{ opacity: 0, scale: 0.92, y: 40 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.92, y: 40 }}
        transition={{ type: 'spring', stiffness: 320, damping: 26 }}
        className="fixed inset-0 z-[1000] flex items-center justify-center p-4"
        style={{ pointerEvents: 'none' }}
      >
        <div
          className="relative w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col"
          style={{
            pointerEvents: 'auto',
            background: 'linear-gradient(155deg, rgba(10,14,26,0.98) 0%, rgba(6,10,24,0.98) 100%)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 20,
            boxShadow: '0 0 0 1px rgba(139,92,246,0.08), 0 32px 100px rgba(0,0,0,0.7), 0 8px 40px rgba(0,0,0,0.5)',
          }}
        >
          {/* Gradient accent line */}
          <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-violet-500/80 via-cyan-500/60 to-violet-500/20" />

          {/* ── Header ──────────────────────────────────────── */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800/60 shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-600/20 to-cyan-600/20 border border-violet-500/25 flex items-center justify-center">
                <Brain className="w-4 h-4 text-violet-400" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-black text-white">{index.short_name}</h2>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${catColor}`}>
                    {index.category}
                  </span>
                  <span className={`text-[10px] font-bold ${riskColor}`}>
                    {snapshot.risk_level || index.risk_profile} Risk
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-1">{index.description}</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-xl hover:bg-slate-800/60 text-slate-400 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* ── Scrollable content ─────────────────────────── */}
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5 custom-scrollbar">

            {/* Summary metrics */}
            <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
              {[
                { label: 'Holdings', value: snapshot.num_holdings, color: 'text-white' },
                { label: 'Avg AI Score', value: snapshot.avg_ai_score?.toFixed(0), color: 'text-cyan-400' },
                { label: 'Beta', value: snapshot.portfolio_beta?.toFixed(2), color: 'text-blue-400' },
                { label: 'Volatility', value: snapshot.portfolio_volatility_ann ? `${snapshot.portfolio_volatility_ann.toFixed(1)}%` : '—', color: 'text-violet-400' },
                { label: 'Risk Score', value: snapshot.risk_score?.toFixed(0) ?? '—', color: riskColor },
                { label: 'Risk Level', value: snapshot.risk_level || '—', color: riskColor },
              ].map((s) => (
                <div key={s.label} className="bg-slate-800/30 border border-slate-800/50 rounded-xl px-3 py-2.5 text-center">
                  <div className="text-[9px] text-slate-600 uppercase tracking-wider">{s.label}</div>
                  <div className={`text-sm font-black font-mono ${s.color}`}>{s.value}</div>
                </div>
              ))}
            </div>

            {/* AI Thesis */}
            {snapshot.explanation?.basket_thesis && (
              <div className="px-4 py-3 bg-violet-500/5 border border-violet-500/15 rounded-xl">
                <div className="flex items-center gap-2 mb-1.5">
                  <Brain className="w-3.5 h-3.5 text-violet-400" />
                  <span className="text-[10px] text-violet-400 font-bold uppercase tracking-wider">AI Thesis</span>
                </div>
                <p className="text-[12px] text-slate-300 leading-relaxed">{snapshot.explanation.basket_thesis}</p>
              </div>
            )}

            {/* Monte Carlo */}
            {mc && (
              <div>
                <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Activity className="w-3 h-3" /> Monte Carlo Scenarios
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-emerald-500/5 border border-emerald-500/15 rounded-xl px-4 py-3 text-center">
                    <TrendingUp className="w-4 h-4 text-emerald-400 mx-auto mb-1" />
                    <div className="text-[9px] text-emerald-400/70 uppercase">Bull Case (P90)</div>
                    <div className="text-lg font-black text-emerald-400 font-mono">
                      +{mc.bull_case.return_pct?.toFixed(1)}%
                    </div>
                  </div>
                  <div className="bg-blue-500/5 border border-blue-500/15 rounded-xl px-4 py-3 text-center">
                    <Target className="w-4 h-4 text-blue-400 mx-auto mb-1" />
                    <div className="text-[9px] text-blue-400/70 uppercase">Base Case (P50)</div>
                    <div className="text-lg font-black text-blue-400 font-mono">
                      {mc.base_case.return_pct > 0 ? '+' : ''}{mc.base_case.return_pct?.toFixed(1)}%
                    </div>
                  </div>
                  <div className="bg-red-500/5 border border-red-500/15 rounded-xl px-4 py-3 text-center">
                    <TrendingDown className="w-4 h-4 text-red-400 mx-auto mb-1" />
                    <div className="text-[9px] text-red-400/70 uppercase">Bear Case (P10)</div>
                    <div className="text-lg font-black text-red-400 font-mono">
                      {mc.bear_case.return_pct?.toFixed(1)}%
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Two-column: Factor Exposure + Sector Allocation */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Factor Exposure */}
              {snapshot.factor_exposure && Object.keys(snapshot.factor_exposure).length > 0 && (
                <div>
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <BarChart3 className="w-3 h-3" /> Factor Exposure
                  </div>
                  <div className="space-y-2 bg-slate-800/15 border border-slate-800/40 rounded-xl p-3">
                    {Object.entries(snapshot.factor_exposure).map(([factor, score]) => (
                      <FactorBar key={factor} label={factor} score={score} />
                    ))}
                  </div>
                </div>
              )}

              {/* Sector Allocation */}
              {snapshot.sector_allocation && Object.keys(snapshot.sector_allocation).length > 0 && (
                <div>
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <Layers className="w-3 h-3" /> Sector Allocation
                  </div>
                  <div className="bg-slate-800/15 border border-slate-800/40 rounded-xl p-3">
                    {/* Stacked bar */}
                    <div className="h-3 rounded-full overflow-hidden flex bg-slate-800/50 mb-3">
                      {Object.entries(snapshot.sector_allocation).map(([sector, pct], i) => (
                        <div
                          key={sector}
                          className={`h-full ${SECTOR_BAR_COLORS[i % SECTOR_BAR_COLORS.length]}`}
                          style={{ width: `${pct}%` }}
                          title={`${sector}: ${pct.toFixed(1)}%`}
                        />
                      ))}
                    </div>
                    {/* Legend */}
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                      {Object.entries(snapshot.sector_allocation).map(([sector, pct], i) => (
                        <div key={sector} className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full ${SECTOR_BAR_COLORS[i % SECTOR_BAR_COLORS.length]}`} />
                          <span className="text-[10px] text-slate-400 flex-1 truncate">{sector}</span>
                          <span className="text-[10px] text-slate-300 font-mono">{pct.toFixed(1)}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Holdings Table */}
            <div>
              <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Target className="w-3 h-3" /> Holdings ({snapshot.num_holdings})
              </div>
              {/* Table header */}
              <div className="flex items-center gap-3 px-3 py-2 text-[9px] text-slate-600 uppercase tracking-wider border-b border-slate-800/40">
                <span className="w-5 text-right">#</span>
                <span className="min-w-[52px]">Ticker</span>
                <span className="flex-1">Company</span>
                <span className="w-24 hidden md:inline">Sector</span>
                <span className="w-10 text-center">Grade</span>
                <span className="w-8 text-right">Score</span>
                <span className="w-12 text-right">Weight</span>
                <span className="w-3" />
              </div>
              {/* Holdings list */}
              <div className="space-y-0.5 max-h-[360px] overflow-y-auto custom-scrollbar">
                {snapshot.holdings.map((h, i) => (
                  <HoldingRow key={h.ticker} h={h} rank={i + 1} />
                ))}
              </div>
            </div>

            {/* Key Risks */}
            {snapshot.explanation?.top_risks && snapshot.explanation.top_risks.length > 0 && (
              <div className="px-4 py-3 bg-red-500/5 border border-red-500/15 rounded-xl">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
                  <span className="text-[10px] text-red-400 font-bold uppercase tracking-wider">Key Risks</span>
                </div>
                <ul className="space-y-1">
                  {snapshot.explanation.top_risks.map((r, i) => (
                    <li key={i} className="flex items-start gap-2 text-[11px] text-slate-400">
                      <span className="text-red-400/50 mt-0.5">•</span>
                      {r}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Stress Scenarios */}
            {snapshot.scenarios && snapshot.scenarios.length > 0 && (
              <div>
                <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Shield className="w-3 h-3" /> Stress Scenarios
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {snapshot.scenarios.map((s) => (
                    <div key={s.scenario_label} className="bg-slate-800/30 border border-slate-800/50 rounded-xl px-3 py-2">
                      <div className="text-[9px] text-slate-500 truncate mb-0.5">{s.scenario_label}</div>
                      <div className={`text-sm font-black font-mono ${
                        s.projected_basket_return_pct > 0 ? 'text-emerald-400' : 'text-red-400'
                      }`}>
                        {s.projected_basket_return_pct > 0 ? '+' : ''}{s.projected_basket_return_pct?.toFixed(1)}%
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Footer */}
            <div className="flex items-center justify-between pt-3 border-t border-slate-800/40">
              {snapshot.generated_at && (
                <span className="text-[9px] text-slate-600">
                  Generated {new Date(snapshot.generated_at).toLocaleString()}
                </span>
              )}
              <span className="text-[9px] text-slate-700">
                AI-generated analysis • Not financial advice
              </span>
            </div>
          </div>
        </div>
      </motion.div>
    </>
  )
}

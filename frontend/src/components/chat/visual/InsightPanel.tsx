'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import dynamic from 'next/dynamic'
import {
  ChevronDown,
  Activity,
  Brain,
  Newspaper,
  ShieldAlert,
  TrendingUp,
  TrendingDown,
  Minus,
  BarChart3,
} from 'lucide-react'
import type { StockAnalysisData } from '../types'
import MonteCarloPanel from './MonteCarloPanel'

const RSIChart = dynamic(() => import('./MiniIndicatorCharts').then(m => ({ default: m.RSIChart })), { ssr: false })
const MACDChart = dynamic(() => import('./MiniIndicatorCharts').then(m => ({ default: m.MACDChart })), { ssr: false })
const VolumeProfileChart = dynamic(() => import('./MiniIndicatorCharts').then(m => ({ default: m.VolumeProfileChart })), { ssr: false })

interface Props {
  data: StockAnalysisData
}

function CollapsibleSection({
  title,
  icon: Icon,
  defaultOpen = false,
  badge,
  children,
}: {
  title: string
  icon: React.ElementType
  defaultOpen?: boolean
  badge?: { text: string; color: string }
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="rounded-xl bg-white/[0.02] border border-white/[0.04] overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-white/[0.02] transition-colors"
      >
        <Icon className="w-3.5 h-3.5 text-cyan-400 flex-shrink-0" />
        <span className="text-[11px] font-semibold text-slate-300 flex-1">{title}</span>
        {badge && (
          <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded ${badge.color}`}>{badge.text}</span>
        )}
        <motion.div animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }}>
          <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
        </motion.div>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 pt-1">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function Chip({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <span className={`inline-flex items-center gap-1 text-[9px] font-mono font-semibold px-2 py-0.5 rounded-md bg-white/[0.03] border border-white/[0.04] ${color}`}>
      {label}: {value}
    </span>
  )
}

function TrendBadge({ trend }: { trend: 'bullish' | 'bearish' | 'neutral' }) {
  const config = {
    bullish: { icon: TrendingUp, color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20', text: 'Bullish' },
    bearish: { icon: TrendingDown, color: 'text-red-400 bg-red-500/10 border-red-500/20', text: 'Bearish' },
    neutral: { icon: Minus, color: 'text-amber-400 bg-amber-500/10 border-amber-500/20', text: 'Neutral' },
  }
  const c = config[trend]
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-lg border ${c.color}`}>
      <c.icon className="w-3 h-3" />
      {c.text}
    </span>
  )
}

/* ==================== TECHNICAL ANALYSIS ==================== */
function TechnicalInsight({ data }: { data: StockAnalysisData }) {
  const ts = data.technical_signal
  const ind = data.indicators
  const trend = ts?.trend || 'neutral'
  const confidence = ts?.confidence ?? 50

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <TrendBadge trend={trend} />
        <span className="text-[10px] text-slate-500 font-mono">Confidence: {confidence.toFixed(0)}%</span>
      </div>

      {ts?.signals && ts.signals.length > 0 && (
        <div className="space-y-1 mt-2">
          {ts.signals.map((s, i) => (
            <div key={i} className="flex items-center gap-2 text-[9px]">
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                s.signal === 'bullish' ? 'bg-emerald-400' : s.signal === 'bearish' ? 'bg-red-400' : 'bg-amber-400'
              }`} />
              <span className="text-slate-400">{s.name}</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-1.5 mt-2">
        {ind?.rsi != null && (
          <Chip label="RSI" value={ind.rsi.toFixed(1)} color={ind.rsi > 70 ? 'text-red-400' : ind.rsi < 30 ? 'text-emerald-400' : 'text-slate-400'} />
        )}
        {ind?.macd?.macd != null && (
          <Chip
            label="MACD"
            value={(ind.macd.histogram ?? 0) > 0 ? 'Bullish' : 'Bearish'}
            color={(ind.macd.histogram ?? 0) > 0 ? 'text-emerald-400' : 'text-red-400'}
          />
        )}
        {ind?.sma_50 != null && (
          <Chip label="SMA50" value={`$${ind.sma_50.toFixed(2)}`} color="text-slate-400" />
        )}
        {ind?.sma_200 != null && (
          <Chip label="SMA200" value={`$${ind.sma_200.toFixed(2)}`} color="text-slate-400" />
        )}
        {ind?.bollinger_bands?.upper != null && (
          <Chip label="BB Upper" value={`$${ind.bollinger_bands.upper.toFixed(2)}`} color="text-slate-400" />
        )}
      </div>

      {/* Interactive RSI + MACD mini charts */}
      <RSIChart symbol={data.symbol} />
      <MACDChart symbol={data.symbol} />
    </div>
  )
}

/* ==================== REGIME PREDICTION ==================== */

function RegimeDonut({ probs }: { probs: { BULLISH: number; BEARISH: number; NEUTRAL: number } }) {
  const cx = 60, cy = 60, r = 44, strokeW = 12
  const total = probs.BULLISH + probs.BEARISH + probs.NEUTRAL
  if (total === 0) return null

  const segments = [
    { key: 'BULLISH', pct: probs.BULLISH / total, color: '#00E676', label: 'Bull' },
    { key: 'NEUTRAL', pct: probs.NEUTRAL / total, color: '#FBBF24', label: 'Neut' },
    { key: 'BEARISH', pct: probs.BEARISH / total, color: '#FF5252', label: 'Bear' },
  ]

  const circumference = 2 * Math.PI * r
  let offset = -circumference / 4
  const dominant = segments.reduce((a, b) => a.pct > b.pct ? a : b)

  return (
    <div className="flex items-center gap-4">
      <div className="relative flex-shrink-0">
        <svg width="120" height="120" viewBox="0 0 120 120">
          {/* Glass background circle */}
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.03)" strokeWidth={strokeW} />
          {/* Probability arcs */}
          {segments.map((seg) => {
            const dashLen = seg.pct * circumference
            const gapLen = circumference - dashLen
            const el = (
              <motion.circle
                key={seg.key}
                cx={cx} cy={cy} r={r}
                fill="none"
                stroke={seg.color}
                strokeWidth={strokeW}
                strokeLinecap="round"
                strokeDasharray={`${dashLen} ${gapLen}`}
                strokeDashoffset={-offset}
                opacity={0.7}
                initial={{ strokeDasharray: `0 ${circumference}` }}
                animate={{ strokeDasharray: `${dashLen} ${gapLen}` }}
                transition={{ duration: 0.8, ease: 'easeOut' }}
              />
            )
            offset += dashLen
            return el
          })}
          {/* Center text */}
          <text x={cx} y={cy - 6} textAnchor="middle" fill="white" fontSize="16" fontWeight="700" fontFamily="monospace">
            {dominant.pct > 0 ? `${(dominant.pct * 100).toFixed(0)}%` : '—'}
          </text>
          <text x={cx} y={cy + 10} textAnchor="middle" fill="#94a3b8" fontSize="8" fontWeight="600">
            {dominant.label.toUpperCase()}
          </text>
        </svg>
        {/* Glow effect */}
        <div
          className="absolute inset-0 rounded-full blur-xl opacity-20 pointer-events-none"
          style={{ background: `radial-gradient(circle, ${dominant.color}40, transparent 70%)` }}
        />
      </div>
      {/* Legend */}
      <div className="space-y-2 flex-1">
        {segments.map((seg) => (
          <div key={seg.key} className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: seg.color, opacity: 0.7 }} />
            <span className="text-[10px] text-slate-400 flex-1">{seg.label}</span>
            <span className="text-[11px] font-bold text-white font-mono">{(seg.pct * 100).toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function RegimePrediction({ data }: { data: StockAnalysisData }) {
  const regime = data.regime
  const pred = data.prediction

  const regimeStr = regime?.regime || 'NEUTRAL'
  const confidence = regime?.confidence ?? 33
  const trend = regimeStr === 'BULLISH' ? 'bullish' : regimeStr === 'BEARISH' ? 'bearish' : 'neutral'
  const probs = regime?.probabilities

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <TrendBadge trend={trend} />
        <span className="text-[10px] text-slate-500 font-mono">Confidence: {confidence.toFixed(0)}%</span>
      </div>

      {probs && (
        <div className="rounded-xl bg-white/[0.015] backdrop-blur-sm border border-white/[0.04] p-3">
          <RegimeDonut probs={probs} />
        </div>
      )}

      {pred?.summary && (
        <p className="text-[10px] text-slate-500 leading-relaxed line-clamp-3">{pred.summary}</p>
      )}
    </div>
  )
}

/* ==================== SENTIMENT ==================== */

function SentimentMeter({ score, overall }: { score: number; overall: string }) {
  const pct = Math.max(0, Math.min(100, ((score + 1) / 2) * 100))
  const primaryColor = overall === 'positive' ? '#00E676' : overall === 'negative' ? '#FF5252' : '#FBBF24'
  const label = overall === 'positive' ? 'Bullish' : overall === 'negative' ? 'Bearish' : 'Neutral'

  return (
    <div className="rounded-xl bg-white/[0.015] backdrop-blur-sm border border-white/[0.04] p-3 relative overflow-hidden">
      {/* Glow */}
      <div
        className="absolute top-0 left-0 w-full h-full opacity-[0.06] pointer-events-none"
        style={{ background: `radial-gradient(ellipse at ${pct}% 50%, ${primaryColor}, transparent 60%)` }}
      />
      <div className="relative flex items-center gap-3">
        {/* Score ring */}
        <div className="relative flex-shrink-0">
          <svg width="64" height="64" viewBox="0 0 64 64">
            <circle cx="32" cy="32" r="26" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="5" />
            <motion.circle
              cx="32" cy="32" r="26"
              fill="none"
              stroke={primaryColor}
              strokeWidth="5"
              strokeLinecap="round"
              strokeDasharray={`${pct * 1.63} ${163 - pct * 1.63}`}
              strokeDashoffset={40.75}
              opacity={0.8}
              initial={{ strokeDasharray: `0 163` }}
              animate={{ strokeDasharray: `${pct * 1.63} ${163 - pct * 1.63}` }}
              transition={{ duration: 0.8, ease: 'easeOut' }}
            />
            <text x="32" y="30" textAnchor="middle" fill="white" fontSize="13" fontWeight="700" fontFamily="monospace">
              {(score * 100).toFixed(0)}
            </text>
            <text x="32" y="41" textAnchor="middle" fill="#64748b" fontSize="7" fontWeight="500">
              SCORE
            </text>
          </svg>
        </div>

        {/* Metrics */}
        <div className="flex-1 space-y-1.5 min-w-0">
          <div className={`text-[11px] font-bold px-2 py-0.5 rounded-md border inline-flex items-center gap-1 ${
            overall === 'positive' ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' :
            overall === 'negative' ? 'text-red-400 bg-red-500/10 border-red-500/20' :
            'text-amber-400 bg-amber-500/10 border-amber-500/20'
          }`}>
            {overall === 'positive' ? <TrendingUp className="w-3 h-3" /> : overall === 'negative' ? <TrendingDown className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
            {label}
          </div>

          {/* Gradient meter bar */}
          <div className="relative w-full h-2.5 rounded-full overflow-hidden bg-white/[0.04]">
            <div className="absolute inset-0 flex">
              <div className="flex-1 bg-gradient-to-r from-red-500/30 to-red-500/10" />
              <div className="flex-1 bg-gradient-to-r from-amber-500/10 to-amber-500/10" />
              <div className="flex-1 bg-gradient-to-r from-emerald-500/10 to-emerald-500/30" />
            </div>
            <motion.div
              className="absolute top-0 h-full w-1 rounded-full bg-white shadow-md shadow-white/30"
              initial={{ left: '50%' }}
              animate={{ left: `${pct}%` }}
              transition={{ duration: 0.8, ease: 'easeOut' }}
            />
          </div>
          <div className="flex justify-between text-[7px] text-slate-600">
            <span>Bearish</span>
            <span>Neutral</span>
            <span>Bullish</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function SentimentPanel({ data }: { data: StockAnalysisData }) {
  const sent = data.sentiment
  const overall = sent?.overall || 'neutral'
  const score = sent?.score ?? 0

  return (
    <div className="space-y-3">
      <SentimentMeter score={score} overall={overall} />

      {(sent?.analyst_recommendation || sent?.target_price != null) && (
        <div className="grid grid-cols-2 gap-2">
          {sent?.analyst_recommendation && (
            <div className="rounded-lg bg-white/[0.02] border border-white/[0.04] px-2.5 py-2">
              <p className="text-[8px] text-slate-500 uppercase tracking-wider mb-0.5">Analyst</p>
              <p className="text-[11px] font-semibold text-white">{sent.analyst_recommendation}</p>
            </div>
          )}
          {sent?.target_price != null && (
            <div className="rounded-lg bg-white/[0.02] border border-white/[0.04] px-2.5 py-2">
              <p className="text-[8px] text-slate-500 uppercase tracking-wider mb-0.5">Target</p>
              <div className="flex items-baseline gap-1">
                <span className="text-[11px] font-semibold text-cyan-400">${sent.target_price.toFixed(2)}</span>
                {sent?.target_upside != null && (
                  <span className={`text-[9px] font-semibold ${sent.target_upside >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {sent.target_upside >= 0 ? '+' : ''}{sent.target_upside.toFixed(1)}%
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* ==================== RISK ==================== */

function RiskRadar({ data }: { data: StockAnalysisData }) {
  const risk = data.risk
  if (!risk) return null

  const enh = risk.enhanced
  const metrics = enh
    ? [
        { label: 'Volatility', value: Math.min(100, enh.annualized_volatility * 2) },
        { label: 'Drawdown', value: Math.min(100, enh.max_drawdown_pct * 2) },
        { label: 'Beta', value: Math.min(100, Math.abs(enh.beta) * 40) },
        { label: 'VaR', value: Math.min(100, Math.abs(enh.var_95) * 20) },
      ]
    : [
        { label: 'Volatility', value: Math.min(100, risk.factors.volatility * 2) },
        { label: 'Drawdown', value: Math.min(100, risk.factors.max_drawdown * 2) },
        { label: 'Beta', value: Math.min(100, Math.abs(risk.factors.beta) * 40) },
      ]

  const cx = 70, cy = 65, r = 50
  const n = metrics.length
  const angleStep = (2 * Math.PI) / n

  const getPoint = (idx: number, pct: number) => {
    const a = -Math.PI / 2 + idx * angleStep
    const dist = (pct / 100) * r
    return { x: cx + dist * Math.cos(a), y: cy + dist * Math.sin(a) }
  }

  const polygon = metrics.map((m, i) => getPoint(i, m.value))
  const polyStr = polygon.map((p) => `${p.x},${p.y}`).join(' ')

  return (
    <div className="flex items-center justify-center py-1">
      <svg width="140" height="130" viewBox="0 0 140 130">
        {/* Grid circles */}
        {[25, 50, 75, 100].map((pct) => (
          <circle key={pct} cx={cx} cy={cy} r={(pct / 100) * r} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="0.5" />
        ))}
        {/* Axis lines */}
        {metrics.map((_, i) => {
          const p = getPoint(i, 100)
          return <line key={i} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke="rgba(255,255,255,0.06)" strokeWidth="0.5" />
        })}
        {/* Data polygon */}
        <motion.polygon
          points={polyStr}
          fill="rgba(255,82,82,0.15)"
          stroke="rgba(255,82,82,0.6)"
          strokeWidth="1.5"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5 }}
        />
        {/* Data points */}
        {polygon.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="2.5" fill="#FF5252" opacity="0.8" />
        ))}
        {/* Labels */}
        {metrics.map((m, i) => {
          const lp = getPoint(i, 120)
          return (
            <text key={i} x={lp.x} y={lp.y} textAnchor="middle" dominantBaseline="middle" fill="#94a3b8" fontSize="7" fontWeight="600">
              {m.label}
            </text>
          )
        })}
      </svg>
    </div>
  )
}

function RiskPanel({ data }: { data: StockAnalysisData }) {
  const risk = data.risk
  if (!risk) {
    return <p className="text-[10px] text-slate-500">Risk data not available for this symbol</p>
  }

  const riskColor = risk.risk_level === 'Low' ? 'text-emerald-400' : risk.risk_level === 'High' ? 'text-red-400' : 'text-amber-400'
  const riskPct = Math.min(100, Math.max(0, risk.risk_score))
  const enh = risk.enhanced

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-3">
        <span className={`text-[11px] font-bold ${riskColor}`}>Risk: {risk.risk_level}</span>
        <span className="text-[10px] text-slate-500 font-mono">Score: {risk.risk_score.toFixed(0)}/100</span>
      </div>

      <div className="w-full h-2 bg-white/[0.04] rounded-full overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${riskPct}%` }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className={`h-full rounded-full ${
            risk.risk_level === 'Low' ? 'bg-emerald-500' : risk.risk_level === 'High' ? 'bg-red-500' : 'bg-amber-500'
          }`}
        />
      </div>

      <RiskRadar data={data} />

      <div className="flex flex-wrap gap-1.5">
        {enh ? (
          <>
            <Chip label="Sharpe" value={enh.sharpe_ratio.toFixed(2)} color={enh.sharpe_ratio > 1 ? 'text-emerald-400' : enh.sharpe_ratio > 0 ? 'text-slate-400' : 'text-red-400'} />
            <Chip label="Vol" value={`${enh.annualized_volatility.toFixed(1)}%`} color="text-slate-400" />
            <Chip label="VaR 95" value={`${enh.var_95.toFixed(1)}%`} color="text-red-400" />
            <Chip label="Max DD" value={`${enh.max_drawdown_pct.toFixed(1)}%`} color="text-red-400" />
            <Chip label="Beta" value={enh.beta.toFixed(2)} color="text-slate-400" />
          </>
        ) : (
          <>
            <Chip label="Volatility" value={`${risk.factors.volatility.toFixed(1)}%`} color="text-slate-400" />
            <Chip label="Max DD" value={`${risk.factors.max_drawdown.toFixed(1)}%`} color="text-red-400" />
            <Chip label="Beta" value={risk.factors.beta.toFixed(2)} color="text-slate-400" />
          </>
        )}
      </div>

      {risk.breakdown && (
        <div className="space-y-1 mt-1">
          {[
            { label: 'Volatility', value: risk.breakdown.volatility_contribution, max: 40 },
            { label: 'Drawdown', value: risk.breakdown.drawdown_contribution, max: 30 },
            { label: 'Beta', value: risk.breakdown.beta_contribution, max: 20 },
            { label: 'Momentum', value: risk.breakdown.momentum_contribution, max: 10 },
          ].map((item) => (
            <div key={item.label} className="flex items-center gap-2">
              <span className="text-[8px] text-slate-500 w-16">{item.label}</span>
              <div className="flex-1 h-1 bg-white/[0.04] rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${(item.value / item.max) * 100}%` }}
                  transition={{ duration: 0.4, delay: 0.1 }}
                  className="h-full rounded-full bg-cyan-500/50"
                />
              </div>
              <span className="text-[8px] text-slate-500 font-mono w-8 text-right">{item.value.toFixed(0)}</span>
            </div>
          ))}
        </div>
      )}

      <VolumeProfileChart symbol={data.symbol} />
    </div>
  )
}

/* ==================== MAIN ==================== */

export default function InsightPanel({ data }: Props) {
  const aiSummary = data.prediction?.summary
  const ts = data.technical_signal
  const techBadge = ts ? {
    text: ts.trend.charAt(0).toUpperCase() + ts.trend.slice(1),
    color: ts.trend === 'bullish' ? 'text-emerald-400 bg-emerald-500/10' : ts.trend === 'bearish' ? 'text-red-400 bg-red-500/10' : 'text-amber-400 bg-amber-500/10'
  } : undefined

  const regimeBadge = data.regime ? {
    text: data.regime.regime,
    color: data.regime.regime === 'BULLISH' ? 'text-emerald-400 bg-emerald-500/10' : data.regime.regime === 'BEARISH' ? 'text-red-400 bg-red-500/10' : 'text-amber-400 bg-amber-500/10'
  } : undefined

  const sentBadge = data.sentiment ? {
    text: data.sentiment.overall === 'positive' ? 'Bullish' : data.sentiment.overall === 'negative' ? 'Bearish' : 'Neutral',
    color: data.sentiment.overall === 'positive' ? 'text-emerald-400 bg-emerald-500/10' : data.sentiment.overall === 'negative' ? 'text-red-400 bg-red-500/10' : 'text-amber-400 bg-amber-500/10'
  } : undefined

  const riskBadge = data.risk ? {
    text: data.risk.risk_level,
    color: data.risk.risk_level === 'Low' ? 'text-emerald-400 bg-emerald-500/10' : data.risk.risk_level === 'High' ? 'text-red-400 bg-red-500/10' : 'text-amber-400 bg-amber-500/10'
  } : undefined

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.2 }}
      className="space-y-2"
    >
      {aiSummary && (
        <div className="rounded-xl bg-gradient-to-r from-cyan-500/[0.06] to-blue-500/[0.04] border border-cyan-500/[0.1] px-3 py-2.5">
          <p className="text-[9px] uppercase tracking-wider text-cyan-400/70 font-semibold mb-1">AI Reasoning</p>
          <p className="text-[10px] text-slate-400 leading-relaxed line-clamp-4">{aiSummary}</p>
        </div>
      )}

      <CollapsibleSection title="Technical Analysis" icon={Activity} defaultOpen badge={techBadge}>
        <TechnicalInsight data={data} />
      </CollapsibleSection>

      {data.monte_carlo && data.quote?.price && (
        <CollapsibleSection 
          title="Monte Carlo Simulation" 
          icon={BarChart3} 
          badge={data.monte_carlo.forecast_30d?.expected_return_pct ? {
            text: `${data.monte_carlo.forecast_30d.expected_return_pct >= 0 ? '+' : ''}${data.monte_carlo.forecast_30d.expected_return_pct.toFixed(1)}%`,
            color: data.monte_carlo.forecast_30d.expected_return_pct >= 0 
              ? 'text-emerald-400 bg-emerald-500/10' 
              : 'text-red-400 bg-red-500/10'
          } : undefined}
        >
          <MonteCarloPanel data={data.monte_carlo} currentPrice={data.quote.price} />
        </CollapsibleSection>
      )}

      <CollapsibleSection title="Regime Prediction" icon={Brain} badge={regimeBadge}>
        <RegimePrediction data={data} />
      </CollapsibleSection>

      <CollapsibleSection title="Sentiment & Consensus" icon={Newspaper} badge={sentBadge}>
        <SentimentPanel data={data} />
      </CollapsibleSection>

      <CollapsibleSection title="Risk Assessment" icon={ShieldAlert} badge={riskBadge}>
        <RiskPanel data={data} />
      </CollapsibleSection>
    </motion.div>
  )
}

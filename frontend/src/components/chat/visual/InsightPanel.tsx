'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
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
} from 'lucide-react'
import type { StockAnalysisData } from '../types'

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

function RegimeTimelineBar({ symbol }: { symbol: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [loaded, setLoaded] = useState(false)

  const render = useCallback(async () => {
    if (!canvasRef.current) return
    const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

    try {
      const res = await fetch(`${API_URL}/api/v1/prices/${symbol}?limit=120`)
      if (!res.ok) return
      const bars: any[] = await res.json()
      if (!bars.length) return

      const closes = bars.map((b: any) => b.close)

      const sma50: number[] = []
      const sma200: number[] = []
      for (let i = 0; i < closes.length; i++) {
        sma50.push(i >= 49 ? closes.slice(i - 49, i + 1).reduce((a: number, b: number) => a + b, 0) / 50 : NaN)
        sma200.push(i >= 119 ? closes.slice(Math.max(0, i - 199), i + 1).reduce((a: number, b: number) => a + b, 0) / Math.min(i + 1, 200) : NaN)
      }

      const rsi: number[] = []
      let avgGain = 0, avgLoss = 0
      for (let i = 1; i <= 14 && i < closes.length; i++) {
        const d = closes[i] - closes[i - 1]
        if (d > 0) avgGain += d; else avgLoss += Math.abs(d)
      }
      avgGain /= 14; avgLoss /= 14
      for (let i = 0; i < 14; i++) rsi.push(50)
      rsi.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss))
      for (let i = 15; i < closes.length; i++) {
        const d = closes[i] - closes[i - 1]
        avgGain = (avgGain * 13 + (d > 0 ? d : 0)) / 14
        avgLoss = (avgLoss * 13 + (d < 0 ? Math.abs(d) : 0)) / 14
        rsi.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss))
      }

      const canvas = canvasRef.current
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      const dpr = window.devicePixelRatio || 1
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      canvas.width = w * dpr
      canvas.height = h * dpr
      ctx.scale(dpr, dpr)
      ctx.clearRect(0, 0, w, h)

      const n = closes.length
      const barW = w / n

      for (let i = 0; i < n; i++) {
        let regime: 'bullish' | 'bearish' | 'neutral' = 'neutral'
        let score = 0
        if (!isNaN(sma50[i]) && !isNaN(sma200[i])) {
          if (closes[i] > sma200[i]) score++; else score--
          if (sma50[i] > sma200[i]) score++; else score--
        }
        if (rsi[i] > 55) score++; else if (rsi[i] < 45) score--

        if (score >= 2) regime = 'bullish'
        else if (score <= -2) regime = 'bearish'

        ctx.fillStyle = regime === 'bullish' ? 'rgba(0,230,118,0.5)' : regime === 'bearish' ? 'rgba(255,82,82,0.5)' : 'rgba(251,191,36,0.3)'
        ctx.fillRect(i * barW, 0, barW + 0.5, h)
      }

      setLoaded(true)
    } catch {
      setLoaded(true)
    }
  }, [symbol])

  useEffect(() => { render() }, [render])

  return (
    <div className="mt-2 rounded-lg bg-white/[0.01] border border-white/[0.03] overflow-hidden">
      <div className="px-2 pt-1.5 flex items-center justify-between">
        <span className="text-[8px] text-slate-500 font-semibold uppercase tracking-wider">Regime Timeline (120D)</span>
        <div className="flex gap-2 text-[7px]">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-emerald-500/50" /> Bull</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-red-500/50" /> Bear</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-amber-500/30" /> Neutral</span>
        </div>
      </div>
      <canvas ref={canvasRef} className="w-full h-[32px]" style={{ display: 'block' }} />
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
    <div className="space-y-2.5">
      <div className="flex items-center gap-2">
        <TrendBadge trend={trend} />
        <span className="text-[10px] text-slate-500 font-mono">Confidence: {confidence.toFixed(0)}%</span>
      </div>

      {probs && (
        <div className="space-y-1.5">
          {(['BULLISH', 'BEARISH', 'NEUTRAL'] as const).map((r) => {
            const pct = probs[r] ?? 0
            const barColor = r === 'BULLISH' ? 'bg-emerald-500' : r === 'BEARISH' ? 'bg-red-500' : 'bg-amber-500'
            const textColor = r === 'BULLISH' ? 'text-emerald-400' : r === 'BEARISH' ? 'text-red-400' : 'text-amber-400'
            return (
              <div key={r} className="flex items-center gap-2">
                <span className={`text-[9px] font-semibold w-14 ${textColor}`}>{r}</span>
                <div className="flex-1 h-1.5 bg-white/[0.04] rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.5, delay: 0.1 }}
                    className={`h-full rounded-full ${barColor}`}
                  />
                </div>
                <span className="text-[9px] text-slate-500 font-mono w-10 text-right">{pct.toFixed(0)}%</span>
              </div>
            )
          })}
        </div>
      )}

      <RegimeTimelineBar symbol={data.symbol} />

      {pred?.summary && (
        <p className="text-[10px] text-slate-500 leading-relaxed line-clamp-3">{pred.summary}</p>
      )}
    </div>
  )
}

/* ==================== SENTIMENT ==================== */

function SentimentGauge({ score }: { score: number }) {
  const pct = ((score + 1) / 2) * 100
  const angle = -90 + (pct / 100) * 180

  return (
    <div className="flex items-center justify-center py-2">
      <svg width="140" height="80" viewBox="0 0 140 80">
        {/* Background arc */}
        <path
          d="M 15 75 A 55 55 0 0 1 125 75"
          fill="none"
          stroke="rgba(255,255,255,0.04)"
          strokeWidth="10"
          strokeLinecap="round"
        />
        {/* Gradient arc segments */}
        <path d="M 15 75 A 55 55 0 0 1 42 30" fill="none" stroke="rgba(255,82,82,0.4)" strokeWidth="10" strokeLinecap="round" />
        <path d="M 42 30 A 55 55 0 0 1 70 20" fill="none" stroke="rgba(255,82,82,0.2)" strokeWidth="10" />
        <path d="M 70 20 A 55 55 0 0 1 98 30" fill="none" stroke="rgba(0,230,118,0.2)" strokeWidth="10" />
        <path d="M 98 30 A 55 55 0 0 1 125 75" fill="none" stroke="rgba(0,230,118,0.4)" strokeWidth="10" strokeLinecap="round" />

        {/* Needle */}
        <motion.line
          x1="70" y1="75"
          x2="70" y2="30"
          stroke="#00D9FF"
          strokeWidth="2"
          strokeLinecap="round"
          initial={{ rotate: -90 }}
          animate={{ rotate: angle }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
          style={{ transformOrigin: '70px 75px' }}
        />
        <circle cx="70" cy="75" r="4" fill="#00D9FF" />

        {/* Labels */}
        <text x="8" y="78" fill="#64748b" fontSize="7">Bearish</text>
        <text x="98" y="78" fill="#64748b" fontSize="7">Bullish</text>
        <text x="55" y="15" fill="#64748b" fontSize="7">Neutral</text>
      </svg>
    </div>
  )
}

function SentimentPanel({ data }: { data: StockAnalysisData }) {
  const sent = data.sentiment
  const overall = sent?.overall || 'neutral'
  const score = sent?.score ?? 0

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <div className={`text-[11px] font-bold px-2.5 py-1 rounded-lg border ${
          overall === 'positive' ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' :
          overall === 'negative' ? 'text-red-400 bg-red-500/10 border-red-500/20' :
          'text-amber-400 bg-amber-500/10 border-amber-500/20'
        }`}>
          {overall === 'positive' ? 'Bullish' : overall === 'negative' ? 'Bearish' : 'Neutral'} Sentiment
        </div>
        <span className="text-[9px] text-slate-500 font-mono">Score: {score.toFixed(2)}</span>
      </div>

      <SentimentGauge score={score} />

      {sent?.analyst_recommendation && (
        <p className="text-[10px] text-slate-500">
          Analyst consensus: <span className="text-slate-300 font-semibold">{sent.analyst_recommendation}</span>
        </p>
      )}
      {sent?.target_price != null && (
        <p className="text-[10px] text-slate-500">
          Price target: <span className="text-cyan-400 font-semibold">${sent.target_price.toFixed(2)}</span>
          {sent?.target_upside != null && (
            <span className={`ml-1 font-semibold ${sent.target_upside >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              ({sent.target_upside >= 0 ? '+' : ''}{sent.target_upside.toFixed(1)}%)
            </span>
          )}
        </p>
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

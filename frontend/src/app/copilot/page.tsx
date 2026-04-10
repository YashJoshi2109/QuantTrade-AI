'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import ReactMarkdown from 'react-markdown'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/contexts/AuthContext'
import AppLayout from '@/components/AppLayout'
import BottomNav from '@/components/layout/BottomNav'
import {
  Send,
  Sparkles,
  StopCircle,
  Copy,
  Check,
  Bot,
  User,
  Zap,
  TrendingUp,
  TrendingDown,
  BarChart3,
  Shield,
  RefreshCw,
  Plus,
  Trash2,
  Activity,
  Target,
  AlertTriangle,
  Globe,
  Newspaper,
  Brain,
  ChevronRight,
  ArrowUpRight,
  ArrowDownRight,
  Gauge,
  PieChart,
  LineChart,
  X,
  History,
  MessageSquare,
  Clock,
  Cpu,
  ChevronLeft,
} from 'lucide-react'
import {
  streamCopilotAnalysis,
  COPILOT_QUICK_PROMPTS,
  type CopilotStructuredData,
  type StockAnalysisData,
  type CopilotIntent,
  type CopilotMeta,
  formatLargeNumber,
  formatPercent,
  formatPrice,
  confidenceColor,
  trendColor,
  trendBg,
} from '@/lib/copilot-engine'
import {
  fetchFinnhubQuote,
  listConversations,
  getConversationMessages,
  deleteConversation,
  getCopilotUsage,
  type ConversationSummary,
  type StoredMessage,
  type CopilotUsage,
} from '@/lib/api'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
  error?: boolean
  timestamp: Date
  intent?: CopilotIntent
  structuredData?: CopilotStructuredData
  meta?: CopilotMeta
}

// ─── Copy Button ──────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button
      onClick={copy}
      className="p-1.5 rounded text-slate-500 hover:text-slate-300 hover:bg-slate-800/60 transition-colors"
      title="Copy"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  )
}

// ─── Confidence Gauge ─────────────────────────────────────────────────────────

function ConfidenceGauge({ score, grade, label }: { score: number; grade: string; label: string }) {
  const circumference = 2 * Math.PI * 40
  const offset = circumference - (score / 100) * circumference
  const color =
    score >= 80 ? '#10b981' : score >= 60 ? '#06b6d4' : score >= 40 ? '#f59e0b' : '#ef4444'

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative w-24 h-24">
        <svg className="w-24 h-24 -rotate-90" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="40" fill="none" stroke="#1e293b" strokeWidth="8" />
          <circle
            cx="50"
            cy="50"
            r="40"
            fill="none"
            stroke={color}
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className="transition-all duration-1000 ease-out"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-bold text-white font-mono">{score.toFixed(0)}</span>
          <span className="text-[9px] font-bold" style={{ color }}>
            {grade}
          </span>
        </div>
      </div>
      <span className="text-[10px] text-slate-400 text-center">{label}</span>
    </div>
  )
}

// ─── Snapshot Card ────────────────────────────────────────────────────────────

function SnapshotCard({ data }: { data: StockAnalysisData }) {
  const quote = data.quote
  const company = data.company
  const ts = data.technical_signal
  const conf = data.confidence

  const price = quote?.price
  const changePct = quote?.change_percent
  const isUp = (changePct ?? 0) >= 0

  return (
    <div className="bg-[#0D1117] border border-slate-700/50 rounded-xl p-4 space-y-3">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold text-white font-mono">{data.symbol}</span>
            {ts && (
              <span
                className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase border ${trendBg(
                  ts.trend
                )} ${trendColor(ts.trend)}`}
              >
                {ts.trend}
              </span>
            )}
          </div>
          {company?.name && (
            <p className="text-xs text-slate-400 mt-0.5">{company.name}</p>
          )}
          {company?.sector && (
            <p className="text-[10px] text-slate-500">
              {company.sector} · {company.industry}
            </p>
          )}
        </div>
        {conf && <ConfidenceGauge score={conf.overall} grade={conf.grade} label={conf.label} />}
      </div>

      {price != null && (
        <div className="flex items-end gap-3">
          <span className="text-2xl font-bold text-white font-mono">{formatPrice(price)}</span>
          <span
            className={`flex items-center gap-1 text-sm font-semibold ${
              isUp ? 'text-emerald-400' : 'text-red-400'
            }`}
          >
            {isUp ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
            {formatPercent(changePct)}
          </span>
        </div>
      )}

      <div className="grid grid-cols-4 gap-2">
        {[
          { label: 'Open', value: formatPrice(quote?.open) },
          { label: 'High', value: formatPrice(quote?.high) },
          { label: 'Low', value: formatPrice(quote?.low) },
          { label: 'Vol', value: quote?.volume ? `${(quote.volume / 1e6).toFixed(1)}M` : 'N/A' },
        ].map((s) => (
          <div key={s.label} className="text-center">
            <div className="text-[10px] text-slate-500">{s.label}</div>
            <div className="text-xs text-slate-300 font-mono">{s.value}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Technical Signals Card ───────────────────────────────────────────────────

function TechnicalSignalsCard({ data }: { data: StockAnalysisData }) {
  const ts = data.technical_signal
  if (!ts) return null

  return (
    <div className="bg-[#0D1117] border border-slate-700/50 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <Activity className="w-4 h-4 text-cyan-400" />
        <span className="text-xs font-bold text-white">Technical Signals</span>
        <span className={`ml-auto text-xs font-bold ${trendColor(ts.trend)}`}>
          {ts.bullish_pct?.toFixed(0)}% Bullish
        </span>
      </div>

      <div className="h-2 bg-slate-800 rounded-full overflow-hidden mb-3">
        <div
          className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 rounded-full transition-all duration-700"
          style={{ width: `${ts.bullish_pct ?? 50}%` }}
        />
      </div>

      <div className="space-y-1.5">
        {ts.signals.slice(0, 5).map((sig, i) => (
          <div key={i} className="flex items-center justify-between text-[11px]">
            <span className="text-slate-400">{sig.name}</span>
            <span
              className={
                sig.signal === 'bullish'
                  ? 'text-emerald-400'
                  : sig.signal === 'bearish'
                  ? 'text-red-400'
                  : 'text-slate-500'
              }
            >
              {sig.signal.toUpperCase()}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Fundamentals Card ────────────────────────────────────────────────────────

function FundamentalsCard({ data }: { data: StockAnalysisData }) {
  const f = data.fundamentals
  if (!f) return null

  const metrics = [
    { label: 'P/E', value: f.pe_ratio?.toFixed(1) },
    { label: 'Fwd P/E', value: f.forward_pe?.toFixed(1) },
    { label: 'PEG', value: f.peg_ratio?.toFixed(2) },
    { label: 'EPS', value: f.eps ? `$${f.eps.toFixed(2)}` : null },
    { label: 'Mkt Cap', value: f.market_cap ? formatLargeNumber(f.market_cap) : null },
    { label: 'P/B', value: f.price_to_book?.toFixed(2) },
    { label: 'Profit Mgn', value: f.profit_margin ? `${(f.profit_margin * 100).toFixed(1)}%` : null },
    { label: 'Op Mgn', value: f.operating_margin ? `${(f.operating_margin * 100).toFixed(1)}%` : null },
    { label: 'ROE', value: f.roe ? `${(f.roe * 100).toFixed(1)}%` : null },
    { label: 'D/E', value: f.debt_to_equity?.toFixed(2) },
    { label: 'Beta', value: f.beta?.toFixed(2) },
    { label: 'Div Yield', value: f.dividend_yield ? `${(f.dividend_yield * 100).toFixed(2)}%` : null },
  ].filter((m) => m.value != null)

  return (
    <div className="bg-[#0D1117] border border-slate-700/50 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <PieChart className="w-4 h-4 text-violet-400" />
        <span className="text-xs font-bold text-white">Fundamentals</span>
        {f.recommendation && (
          <span className="ml-auto px-2 py-0.5 rounded-md text-[10px] font-bold bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
            {f.recommendation}
          </span>
        )}
      </div>
      <div className="grid grid-cols-3 gap-x-4 gap-y-2">
        {metrics.map((m) => (
          <div key={m.label}>
            <div className="text-[10px] text-slate-500">{m.label}</div>
            <div className="text-xs text-slate-200 font-mono">{m.value}</div>
          </div>
        ))}
      </div>
      {f.week_52_high != null && f.week_52_low != null && (
        <div className="mt-3 pt-3 border-t border-slate-800">
          <div className="flex items-center justify-between text-[10px] text-slate-500 mb-1">
            <span>52W Low: {formatPrice(f.week_52_low)}</span>
            <span>52W High: {formatPrice(f.week_52_high)}</span>
          </div>
          <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
            {data.quote?.price != null && (
              <div
                className="h-full bg-gradient-to-r from-red-500 via-amber-500 to-emerald-500 rounded-full"
                style={{
                  width: `${Math.min(
                    100,
                    Math.max(
                      0,
                      ((data.quote.price - f.week_52_low) / (f.week_52_high - f.week_52_low)) * 100
                    )
                  )}%`,
                }}
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Regime & Forecast Card ──────────────────────────────────────────────────

function RegimeForecastCard({ data }: { data: StockAnalysisData }) {
  const regime = data.regime
  const horizons = data.time_horizons

  if (!regime && !horizons) return null

  return (
    <div className="bg-[#0D1117] border border-slate-700/50 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <Brain className="w-4 h-4 text-amber-400" />
        <span className="text-xs font-bold text-white">Regime & Forecast</span>
      </div>

      {regime && (
        <div className="mb-3">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] text-slate-500">Market Regime:</span>
            <span
              className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${trendBg(
                regime.regime
              )} ${trendColor(regime.regime)}`}
            >
              {regime.regime}
            </span>
            <span className="text-[10px] text-slate-500">
              ({regime.confidence.toFixed(1)}% conf.)
            </span>
          </div>
          <div className="flex gap-1 h-4">
            {Object.entries(regime.probabilities).map(([label, pct]) => (
              <div
                key={label}
                className={`rounded-sm flex items-center justify-center text-[8px] font-bold ${
                  label === 'BULLISH'
                    ? 'bg-emerald-500/20 text-emerald-400'
                    : label === 'BEARISH'
                    ? 'bg-red-500/20 text-red-400'
                    : 'bg-slate-700/40 text-slate-400'
                }`}
                style={{ width: `${pct}%` }}
              >
                {pct > 15 ? `${label.slice(0, 4)} ${pct}%` : ''}
              </div>
            ))}
          </div>
        </div>
      )}

      {horizons && (
        <div className="space-y-2">
          {(
            [
              ['short_term', 'Short (1-7d)'],
              ['medium_term', 'Medium (1-3m)'],
              ['long_term', 'Long (6-12m)'],
            ] as const
          ).map(([key, label]) => {
            const h = horizons[key]
            if (!h) return null
            return (
              <div key={key} className="flex items-center justify-between">
                <span className="text-[11px] text-slate-400">{label}</span>
                <div className="flex items-center gap-2">
                  <span className={`text-[11px] font-semibold ${trendColor(h.direction)}`}>
                    {h.direction.toUpperCase()}
                  </span>
                  <span className="text-[10px] text-slate-500">{h.confidence.toFixed(0)}%</span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Risk Card ────────────────────────────────────────────────────────────────

function RiskCard({ data }: { data: StockAnalysisData }) {
  const risk = data.risk
  if (!risk) return null

  const enhanced = risk.enhanced
  const score = risk.score ?? 0
  const riskLevel =
    score >= 70 ? 'High Risk' : score >= 40 ? 'Moderate Risk' : 'Low Risk'
  const riskColor =
    score >= 70 ? 'text-red-400' : score >= 40 ? 'text-amber-400' : 'text-emerald-400'

  return (
    <div className="bg-[#0D1117] border border-slate-700/50 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <Shield className="w-4 h-4 text-red-400" />
        <span className="text-xs font-bold text-white">Risk Assessment</span>
        <span className={`ml-auto text-xs font-bold ${riskColor}`}>
          {score}/100 · {riskLevel}
        </span>
      </div>

      <div className="h-2 bg-slate-800 rounded-full overflow-hidden mb-3">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{
            width: `${score}%`,
            background: `linear-gradient(90deg, #10b981 0%, #f59e0b 50%, #ef4444 100%)`,
          }}
        />
      </div>

      {enhanced && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          {[
            { label: 'Sharpe Ratio', value: enhanced.sharpe_ratio?.toFixed(2) },
            { label: 'VaR (95%)', value: `${enhanced.var_95?.toFixed(2)}%` },
            { label: 'Ann. Volatility', value: `${enhanced.annualized_volatility?.toFixed(1)}%` },
            { label: 'Max Drawdown', value: `${enhanced.max_drawdown_pct?.toFixed(1)}%` },
            { label: 'Beta', value: enhanced.beta?.toFixed(2) },
          ].map((m) => (
            <div key={m.label}>
              <div className="text-[10px] text-slate-500">{m.label}</div>
              <div className="text-xs text-slate-200 font-mono">{m.value}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Sentiment Card ───────────────────────────────────────────────────────────

function SentimentCard({ data }: { data: StockAnalysisData }) {
  const sent = data.sentiment
  if (!sent) return null

  return (
    <div className="bg-[#0D1117] border border-slate-700/50 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <Newspaper className="w-4 h-4 text-blue-400" />
        <span className="text-xs font-bold text-white">Sentiment & Analyst</span>
        <span
          className={`ml-auto px-2 py-0.5 rounded-md text-[10px] font-bold border ${trendBg(
            sent.overall
          )} ${trendColor(sent.overall)}`}
        >
          {sent.overall.toUpperCase()}
        </span>
      </div>

      <div className="space-y-2">
        {sent.analyst_recommendation && (
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-slate-400">Analyst Rating</span>
            <span className="text-slate-200 font-semibold">{sent.analyst_recommendation}</span>
          </div>
        )}
        {sent.target_price != null && (
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-slate-400">Price Target</span>
            <span className="text-slate-200 font-mono">{formatPrice(sent.target_price)}</span>
          </div>
        )}
        {sent.target_upside != null && (
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-slate-400">Target Upside</span>
            <span
              className={`font-semibold ${
                sent.target_upside >= 0 ? 'text-emerald-400' : 'text-red-400'
              }`}
            >
              {formatPercent(sent.target_upside)}
            </span>
          </div>
        )}
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-slate-400">Sentiment Score</span>
          <span className="text-slate-200 font-mono">{sent.score.toFixed(2)}</span>
        </div>
      </div>
    </div>
  )
}

// ─── Monte Carlo Card ─────────────────────────────────────────────────────────

function MonteCarloCard({ data }: { data: StockAnalysisData }) {
  const mc = data.monte_carlo
  if (!mc) return null

  const periods = [
    { key: 'forecast_30d', label: '30-Day Forecast', data: mc.forecast_30d },
    { key: 'forecast_90d', label: '90-Day Forecast', data: mc.forecast_90d },
  ].filter((p) => p.data)

  if (periods.length === 0) return null

  return (
    <div className="bg-[#0D1117] border border-slate-700/50 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <LineChart className="w-4 h-4 text-purple-400" />
        <span className="text-xs font-bold text-white">Monte Carlo Simulation</span>
        <span className="text-[10px] text-slate-500 ml-auto">10K paths</span>
      </div>
      <div className="space-y-3">
        {periods.map((p) => {
          const d = p.data!
          return (
            <div key={p.key}>
              <div className="text-[10px] text-slate-400 mb-1">{p.label}</div>
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-red-500/5 border border-red-500/10 rounded-lg p-2 text-center">
                  <div className="text-[9px] text-red-400">P10 (Bear)</div>
                  <div className="text-xs text-red-300 font-mono">{formatPrice(d.p10)}</div>
                </div>
                <div className="bg-cyan-500/5 border border-cyan-500/10 rounded-lg p-2 text-center">
                  <div className="text-[9px] text-cyan-400">Median</div>
                  <div className="text-xs text-cyan-300 font-mono">{formatPrice(d.median)}</div>
                </div>
                <div className="bg-emerald-500/5 border border-emerald-500/10 rounded-lg p-2 text-center">
                  <div className="text-[9px] text-emerald-400">P90 (Bull)</div>
                  <div className="text-xs text-emerald-300 font-mono">{formatPrice(d.p90)}</div>
                </div>
              </div>
              {d.prob_above_current != null && (
                <div className="text-[10px] text-slate-500 mt-1 text-center">
                  {(d.prob_above_current * 100).toFixed(1)}% probability above current price
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Confidence Breakdown Card ────────────────────────────────────────────────

function ConfidenceBreakdownCard({ data }: { data: StockAnalysisData }) {
  const conf = data.confidence
  if (!conf) return null

  return (
    <div className="bg-[#0D1117] border border-slate-700/50 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <Gauge className="w-4 h-4 text-cyan-400" />
        <span className="text-xs font-bold text-white">Confidence Breakdown</span>
      </div>
      <div className="space-y-2">
        {Object.entries(conf.components).map(([key, value]) => {
          const label = key
            .replace(/_/g, ' ')
            .replace(/\b\w/g, (c) => c.toUpperCase())
          return (
            <div key={key}>
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[11px] text-slate-400">{label}</span>
                <span className={`text-[11px] font-mono ${confidenceColor(value)}`}>
                  {value.toFixed(0)}%
                </span>
              </div>
              <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${value}%`,
                    backgroundColor:
                      value >= 80
                        ? '#10b981'
                        : value >= 60
                        ? '#06b6d4'
                        : value >= 40
                        ? '#f59e0b'
                        : '#ef4444',
                  }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Analysis Dashboard (Right Panel) ─────────────────────────────────────────

function AnalysisDashboard({
  data,
  onClose,
}: {
  data: StockAnalysisData
  onClose: () => void
}) {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/50 shrink-0">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-[#007AFF]" />
          <span className="text-sm font-bold text-white">{data.symbol} Analysis</span>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-slate-800/60 text-slate-400 hover:text-white transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        <SnapshotCard data={data} />
        <TechnicalSignalsCard data={data} />
        <RegimeForecastCard data={data} />
        <FundamentalsCard data={data} />
        <RiskCard data={data} />
        <SentimentCard data={data} />
        <MonteCarloCard data={data} />
        <ConfidenceBreakdownCard data={data} />
      </div>
    </div>
  )
}

// ─── Message Bubble ───────────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === 'user'

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
    >
      <div
        className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
          isUser
            ? 'bg-[#007AFF] text-white'
            : 'bg-[#101928] border border-[rgba(0,122,255,0.2)] text-[#007AFF]'
        }`}
      >
        {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
      </div>

      <div className={`flex-1 max-w-[85%] ${isUser ? 'items-end' : 'items-start'} flex flex-col`}>
        <div
          className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
            isUser
              ? 'bg-[#007AFF] text-white rounded-tr-sm'
              : msg.error
              ? 'bg-red-500/10 border border-red-500/30 text-red-300 rounded-tl-sm'
              : 'bg-[#101928] border border-[rgba(0,122,255,0.12)] text-slate-100 rounded-tl-sm'
          }`}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap">{msg.content}</p>
          ) : (
            <div className="prose prose-invert prose-sm max-w-none">
              <ReactMarkdown
                components={{
                  p: ({ children }) => <p className="mb-2 last:mb-0 text-slate-200">{children}</p>,
                  strong: ({ children }) => (
                    <strong className="font-bold text-white">{children}</strong>
                  ),
                  em: ({ children }) => <em className="text-slate-400 italic text-xs">{children}</em>,
                  code: ({ children, className }) => {
                    const isBlock = className?.includes('language-')
                    return isBlock ? (
                      <code className="block bg-[#0D1117] border border-slate-700/50 rounded-lg p-3 text-xs font-mono text-emerald-300 my-2 overflow-x-auto whitespace-pre">
                        {children}
                      </code>
                    ) : (
                      <code className="bg-[#0D1117] text-emerald-300 px-1.5 py-0.5 rounded text-xs font-mono">
                        {children}
                      </code>
                    )
                  },
                  ul: ({ children }) => <ul className="list-disc pl-4 space-y-1 my-2">{children}</ul>,
                  ol: ({ children }) => (
                    <ol className="list-decimal pl-4 space-y-1 my-2">{children}</ol>
                  ),
                  li: ({ children }) => <li className="text-slate-300">{children}</li>,
                  h1: ({ children }) => (
                    <h1 className="text-white font-bold text-base mt-3 mb-1">{children}</h1>
                  ),
                  h2: ({ children }) => (
                    <h2 className="text-[#007AFF] font-bold text-sm mt-4 mb-1.5 flex items-center gap-1.5">
                      <span className="w-1 h-4 bg-[#007AFF] rounded-full" />
                      {children}
                    </h2>
                  ),
                  h3: ({ children }) => (
                    <h3 className="text-slate-100 font-semibold text-sm mt-2 mb-1">{children}</h3>
                  ),
                  table: ({ children }) => (
                    <div className="overflow-x-auto my-2">
                      <table className="w-full text-xs border-collapse border border-slate-700/50 rounded-lg overflow-hidden">
                        {children}
                      </table>
                    </div>
                  ),
                  th: ({ children }) => (
                    <th className="border border-slate-700/50 bg-[#0D1117] px-3 py-1.5 text-left text-slate-300 font-semibold">
                      {children}
                    </th>
                  ),
                  td: ({ children }) => (
                    <td className="border border-slate-700/30 px-3 py-1.5 text-slate-400">
                      {children}
                    </td>
                  ),
                  blockquote: ({ children }) => (
                    <blockquote className="border-l-2 border-[#007AFF]/40 pl-3 text-slate-400 italic my-2">
                      {children}
                    </blockquote>
                  ),
                  hr: () => <hr className="border-slate-700/50 my-3" />,
                }}
              >
                {msg.content}
              </ReactMarkdown>
              {msg.streaming && (
                <span className="inline-block w-1.5 h-4 bg-[#007AFF] rounded-sm animate-pulse ml-0.5 -mb-0.5" />
              )}
            </div>
          )}
        </div>

        {!isUser && !msg.streaming && msg.content && (
          <div className="flex items-center gap-1 mt-1 px-1">
            <CopyButton text={msg.content} />
            {msg.meta?.sources && msg.meta.sources.length > 0 && (
              <span className="text-[9px] text-slate-600 font-mono">
                Sources: {msg.meta.sources.slice(0, 3).join(', ')}
              </span>
            )}
            <span className="text-[10px] text-slate-600 font-mono ml-auto">
              {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        )}
      </div>
    </motion.div>
  )
}

// ─── Welcome Screen ──────────────────────────────────────────────────────────

function WelcomeScreen({ onPrompt }: { onPrompt: (p: string) => void }) {
  const iconMap = {
    chart: TrendingUp,
    compare: BarChart3,
    sectors: PieChart,
    movers: Zap,
    macro: Globe,
    risk: Shield,
  }

  return (
    <div className="flex flex-col items-center justify-start sm:justify-center min-h-full px-4 sm:px-6 py-6 sm:py-10 text-center">
      <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-gradient-to-br from-[#007AFF]/20 to-cyan-500/10 border border-[#007AFF]/30 flex items-center justify-center mb-4 shrink-0">
        <Brain className="w-7 h-7 sm:w-8 sm:h-8 text-[#007AFF]" />
      </div>
      <h2 className="text-xl sm:text-2xl font-bold text-white font-display mb-2">
        QuantTrade AI Copilot
      </h2>
      <p className="text-xs sm:text-sm text-slate-400 max-w-md mb-2">
        Institutional-grade financial analysis powered by quantitative models, RAG retrieval, and
        real-time market data.
      </p>
      <div className="flex items-center gap-3 mb-6 sm:mb-8 flex-wrap justify-center">
        {['RAG Pipeline', 'Quant Models', 'Confidence Scoring', 'Live Data'].map((tag) => (
          <span
            key={tag}
            className="px-2 py-0.5 text-[9px] font-bold text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 rounded-md"
          >
            {tag}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-xl pb-10">
        {COPILOT_QUICK_PROMPTS.map((qp) => {
          const Icon = iconMap[qp.icon] || Sparkles
          return (
            <button
              key={qp.label}
              onClick={() => onPrompt(qp.prompt)}
              className="flex items-start gap-3 p-3 sm:p-3.5 rounded-xl bg-[#101928] border border-slate-700/50 hover:border-[#007AFF]/40 hover:bg-[#101928]/80 transition-all text-left group"
            >
              <div className="w-9 h-9 rounded-lg bg-[#007AFF]/10 flex items-center justify-center shrink-0 group-hover:bg-[#007AFF]/20 transition-colors">
                <Icon className="w-4 h-4 text-[#007AFF]" />
              </div>
              <div>
                <div className="text-sm font-semibold text-white group-hover:text-[#007AFF] transition-colors leading-tight">
                  {qp.label}
                </div>
                <div className="text-[10px] sm:text-[11px] text-slate-500 line-clamp-1 mt-0.5">
                  {qp.prompt}
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── Live Quote Strip ─────────────────────────────────────────────────────────

function LiveQuoteStrip() {
  const { data } = useQuery({
    queryKey: ['copilot-header-quote', 'SPY'],
    queryFn: () => fetchFinnhubQuote('SPY', 'normal'),
    staleTime: 12_000,
    refetchInterval: 25_000,
  })

  const price = data?.price ?? 0
  const pct = data?.change_percent ?? 0
  const up = pct >= 0
  const ok = price > 0

  return (
    <div className="hidden sm:flex items-center gap-2 px-2.5 py-1 rounded-xl bg-gradient-to-r from-[#007AFF]/12 to-cyan-500/10 border border-[#007AFF]/20 text-[10px] font-mono text-slate-200">
      <BarChart3 className="w-3.5 h-3.5 text-[#007AFF] shrink-0" />
      <span className="font-bold text-white tracking-tight">SPY</span>
      {ok ? (
        <>
          <span className="text-slate-300 tabular-nums">${price.toFixed(2)}</span>
          <span className={up ? 'text-emerald-400' : 'text-red-400'}>
            {up ? '+' : ''}
            {pct.toFixed(2)}%
          </span>
        </>
      ) : (
        <span className="text-slate-500">--</span>
      )}
    </div>
  )
}

// ─── Model Indicator Badge ───────────────────────────────────────────────────

function ModelIndicator({ model, isStreaming }: { model: string; isStreaming: boolean }) {
  const modelLabels: Record<string, { name: string; color: string }> = {
    'gpt-4o': { name: 'GPT-4o', color: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' },
    'gpt-4.1': { name: 'GPT-4.1', color: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' },
    'gpt-4o-mini': { name: 'GPT-4o Mini', color: 'text-teal-400 border-teal-500/30 bg-teal-500/10' },
    'gpt-4o_cached': { name: 'GPT-4o (cached)', color: 'text-emerald-300 border-emerald-500/20 bg-emerald-500/5' },
    'groq': { name: 'Llama 3.3 70B', color: 'text-orange-400 border-orange-500/30 bg-orange-500/10' },
    'groq_cached': { name: 'Llama 3.3 (cached)', color: 'text-orange-300 border-orange-500/20 bg-orange-500/5' },
    'openrouter': { name: 'Gemini Flash', color: 'text-blue-400 border-blue-500/30 bg-blue-500/10' },
    'deepseek-v3': { name: 'DeepSeek V3', color: 'text-violet-400 border-violet-500/30 bg-violet-500/10' },
    'deepseek-v3_cached': { name: 'DeepSeek V3 (cached)', color: 'text-violet-300 border-violet-500/20 bg-violet-500/5' },
    'fallback': { name: 'Llama 3.1 8B', color: 'text-slate-400 border-slate-500/30 bg-slate-500/10' },
    'rate_limited': { name: 'Rate Limited', color: 'text-red-400 border-red-500/30 bg-red-500/10' },
    'none': { name: 'No Model', color: 'text-slate-500 border-slate-600/30 bg-slate-600/10' },
  }

  const info = modelLabels[model] || modelLabels['groq']

  return (
    <div className={`hidden sm:flex items-center gap-1.5 px-2 py-1 rounded-lg border text-[10px] font-mono ${info.color}`}>
      <Cpu className={`w-3 h-3 ${isStreaming ? 'animate-pulse' : ''}`} />
      <span className="font-semibold">{info.name}</span>
      {isStreaming && (
        <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
      )}
    </div>
  )
}

// ─── Usage Badge ──────────────────────────────────────────────────────────────

function UsageBadge() {
  const { data } = useQuery({
    queryKey: ['copilot-usage'],
    queryFn: getCopilotUsage,
    staleTime: 30_000,
    refetchInterval: 60_000,
  })

  if (!data) return null

  if (data.is_pro) {
    return (
      <div className="hidden sm:flex items-center gap-1.5 px-2 py-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-[10px] font-mono text-emerald-400" title={`Pro · ${data.today_requests} requests today`}>
        <span className="font-bold">PRO</span>
        <span className="text-emerald-300/70">{data.today_requests} req</span>
      </div>
    )
  }

  const pct = data.free_limit > 0 ? (data.today_requests / data.free_limit) * 100 : 0
  const barColor = pct >= 100 ? 'bg-red-500' : pct >= 60 ? 'bg-amber-500' : 'bg-emerald-500'

  return (
    <div className="hidden sm:flex items-center gap-1.5 px-2 py-1 rounded-lg border border-slate-700/40 bg-slate-800/30 text-[10px] font-mono text-slate-400" title={`Free tier: ${data.free_remaining}/${data.free_limit} requests remaining`}>
      <div className="w-10 h-1.5 bg-slate-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${barColor} transition-all`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <span>{data.free_remaining}/{data.free_limit}</span>
    </div>
  )
}

// ─── Pipeline Status Bar ──────────────────────────────────────────────────────

function PipelineStatus({
  stage,
  intent,
  symbol,
}: {
  stage: 'idle' | 'intent' | 'data' | 'streaming' | 'done'
  intent?: CopilotIntent
  symbol?: string | null
}) {
  if (stage === 'idle' || stage === 'done') return null

  const stages = [
    { key: 'intent', label: 'Intent Detection', icon: Target },
    { key: 'data', label: 'RAG + Quant Models', icon: Brain },
    { key: 'streaming', label: 'AI Generation', icon: Sparkles },
  ]

  const currentIdx = stages.findIndex((s) => s.key === stage)

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      className="mx-5 mb-2"
    >
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#007AFF]/5 border border-[#007AFF]/15">
        <div className="flex items-center gap-1">
          {stages.map((s, i) => {
            const Icon = s.icon
            const active = i === currentIdx
            const done = i < currentIdx
            return (
              <div key={s.key} className="flex items-center gap-1">
                <div
                  className={`w-5 h-5 rounded-md flex items-center justify-center ${
                    active
                      ? 'bg-[#007AFF] text-white'
                      : done
                      ? 'bg-emerald-500/20 text-emerald-400'
                      : 'bg-slate-800 text-slate-500'
                  }`}
                >
                  {done ? (
                    <Check className="w-3 h-3" />
                  ) : (
                    <Icon className={`w-3 h-3 ${active ? 'animate-pulse' : ''}`} />
                  )}
                </div>
                {i < stages.length - 1 && (
                  <ChevronRight className="w-3 h-3 text-slate-600 mx-0.5" />
                )}
              </div>
            )
          })}
        </div>
        <div className="ml-2 flex-1 min-w-0">
          <span className="text-[10px] text-[#007AFF] font-medium">
            {stages[currentIdx]?.label ?? 'Processing'}
          </span>
          {symbol && (
            <span className="text-[10px] text-slate-500 ml-1.5">
              {intent === 'stock_analysis' ? `Analyzing ${symbol}` : ''}
            </span>
          )}
        </div>
        <RefreshCw className="w-3 h-3 text-[#007AFF] animate-spin shrink-0" />
      </div>
    </motion.div>
  )
}

// ─── Conversation History Sidebar ────────────────────────────────────────────

function ConversationSidebar({
  conversations,
  activeId,
  onSelect,
  onDelete,
  onNewChat,
  isLoading,
  onClose,
}: {
  conversations: ConversationSummary[]
  activeId: string | null
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  onNewChat: () => void
  isLoading: boolean
  onClose: () => void
}) {
  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    const days = Math.floor(hrs / 24)
    if (days < 7) return `${days}d ago`
    return new Date(dateStr).toLocaleDateString()
  }

  return (
    <div className="flex flex-col h-full bg-[#080C14] border-r border-slate-700/50">
      {/* Sidebar Header */}
      <div className="flex items-center justify-between px-3 py-3 border-b border-slate-700/50 shrink-0">
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-[#007AFF]" />
          <span className="text-xs font-bold text-white">History</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onNewChat}
            className="p-1.5 rounded-lg text-[#007AFF] hover:bg-[#007AFF]/10 transition-colors"
            title="New Chat"
          >
            <Plus className="w-4 h-4" />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-800/60 transition-colors lg:hidden"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Conversations List */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="w-4 h-4 text-slate-500 animate-spin" />
          </div>
        ) : conversations.length === 0 ? (
          <div className="text-center py-8 px-4">
            <MessageSquare className="w-8 h-8 text-slate-700 mx-auto mb-2" />
            <p className="text-xs text-slate-500">No conversations yet</p>
            <p className="text-[10px] text-slate-600 mt-1">Start a new chat to begin</p>
          </div>
        ) : (
          <div className="py-1">
            {conversations.map((conv) => (
              <div
                key={conv.id}
                className={`group relative px-3 py-2.5 cursor-pointer transition-colors ${
                  activeId === conv.id
                    ? 'bg-[#007AFF]/10 border-l-2 border-[#007AFF]'
                    : 'hover:bg-slate-800/40 border-l-2 border-transparent'
                }`}
                onClick={() => onSelect(conv.id)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-white truncate">
                      {conv.title || 'New Conversation'}
                    </p>
                    {conv.last_message && (
                      <p className="text-[10px] text-slate-500 truncate mt-0.5">
                        {conv.last_message}
                      </p>
                    )}
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[9px] text-slate-600 flex items-center gap-1">
                        <Clock className="w-2.5 h-2.5" />
                        {timeAgo(conv.updated_at)}
                      </span>
                      <span className="text-[9px] text-slate-600">
                        {conv.message_count} msgs
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onDelete(conv.id)
                    }}
                    className="p-1 rounded text-slate-600 hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-all shrink-0"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Main Copilot ─────────────────────────────────────────────────────────────

function CopilotInner() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [pipelineStage, setPipelineStage] = useState<'idle' | 'intent' | 'data' | 'streaming' | 'done'>('idle')
  const [currentIntent, setCurrentIntent] = useState<CopilotIntent | undefined>()
  const [currentSymbol, setCurrentSymbol] = useState<string | null>(null)
  const [analysisData, setAnalysisData] = useState<StockAnalysisData | null>(null)
  const [showDashboard, setShowDashboard] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const [activeModel, setActiveModel] = useState<string>('groq')
  const abortRef = useRef<AbortController | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const queryClient = useQueryClient()

  // Fetch conversation history
  const { data: conversations = [], isLoading: conversationsLoading } = useQuery({
    queryKey: ['copilot-conversations'],
    queryFn: listConversations,
    staleTime: 30_000,
    refetchInterval: 60_000,
  })

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  // Load conversation messages when selecting a conversation
  const loadConversation = useCallback(async (conversationId: string) => {
    try {
      const storedMessages = await getConversationMessages(conversationId)
      const loadedMessages: Message[] = storedMessages.map((m) => ({
        id: `stored-${m.id}`,
        role: m.role as 'user' | 'assistant',
        content: m.content,
        timestamp: new Date(m.created_at),
        intent: m.intent_type as CopilotIntent | undefined,
        structuredData: m.payload_json as CopilotStructuredData | undefined,
      }))
      setMessages(loadedMessages)
      setActiveConversationId(conversationId)
      setShowHistory(false)

      // If last message has structured data with a symbol, show the dashboard
      const lastAssistant = loadedMessages.filter((m) => m.role === 'assistant').pop()
      if (lastAssistant?.structuredData) {
        const sd = lastAssistant.structuredData as StockAnalysisData
        if (sd.symbol) {
          setAnalysisData(sd)
          setShowDashboard(true)
        }
      }
    } catch {
      // Failed to load, just continue
    }
  }, [])

  const handleDeleteConversation = useCallback(async (id: string) => {
    await deleteConversation(id)
    queryClient.invalidateQueries({ queryKey: ['copilot-conversations'] })
    if (activeConversationId === id) {
      setMessages([])
      setActiveConversationId(null)
      setAnalysisData(null)
      setShowDashboard(false)
    }
  }, [activeConversationId, queryClient])

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || streaming) return

      const userMsg: Message = {
        id: crypto.randomUUID(),
        role: 'user',
        content: text.trim(),
        timestamp: new Date(),
      }
      const assistantMsgId = crypto.randomUUID()
      const assistantMsg: Message = {
        id: assistantMsgId,
        role: 'assistant',
        content: '',
        streaming: true,
        timestamp: new Date(),
      }

      setMessages((prev) => [...prev, userMsg, assistantMsg])
      setInput('')
      setStreaming(true)
      setPipelineStage('intent')
      setAnalysisData(null)
      setCurrentIntent(undefined)
      setCurrentSymbol(null)
      setActiveModel('groq')

      abortRef.current = new AbortController()

      await streamCopilotAnalysis(
        {
          message: text.trim(),
          conversation_id: activeConversationId || undefined,
        },
        {
          onIntent: (intent, symbol, symbols) => {
            setCurrentIntent(intent)
            setCurrentSymbol(symbol)
            setPipelineStage('data')
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId ? { ...m, intent } : m
              )
            )
          },

          onStructuredData: (data) => {
            setPipelineStage('streaming')
            const displayData =
              data.stocks && data.stocks.length > 0
                ? data.stocks[0]
                : (data as StockAnalysisData)
            if (displayData.symbol) {
              setAnalysisData(displayData)
              setShowDashboard(true)
            }
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId ? { ...m, structuredData: data } : m
              )
            )
          },

          onToken: (text) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId
                  ? { ...m, content: m.content + text }
                  : m
              )
            )
          },

          onMeta: (meta) => {
            // Update conversation ID from backend response
            if (meta.conversation_id) {
              setActiveConversationId(meta.conversation_id)
            }
            // Update model indicator from backend
            if (meta.model) {
              setActiveModel(meta.model)
            }
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId ? { ...m, meta } : m
              )
            )
          },

          onError: (error) => {
            // Detect model from error or fallback behavior
            if (error.includes('openrouter') || error.includes('gemini')) {
              setActiveModel('openrouter')
            }
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId
                  ? { ...m, content: m.content || error, error: true, streaming: false }
                  : m
              )
            )
          },

          onDone: () => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId ? { ...m, streaming: false } : m
              )
            )
            setStreaming(false)
            setPipelineStage('done')
            setTimeout(() => setPipelineStage('idle'), 2000)
            inputRef.current?.focus()
            // Refresh conversation list
            queryClient.invalidateQueries({ queryKey: ['copilot-conversations'] })
          },
        },
        abortRef.current.signal
      )
    },
    [streaming, activeConversationId, queryClient]
  )

  const stopStreaming = () => {
    abortRef.current?.abort()
    setStreaming(false)
    setPipelineStage('idle')
    setMessages((prev) =>
      prev.map((m, i) =>
        i === prev.length - 1 && m.streaming ? { ...m, streaming: false } : m
      )
    )
  }

  const newChat = () => {
    if (streaming) stopStreaming()
    setMessages([])
    setAnalysisData(null)
    setShowDashboard(false)
    setPipelineStage('idle')
    setActiveConversationId(null)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(input)
    }
  }

  const hasMessages = messages.length > 0

  return (
    <div className="flex flex-1 h-full w-full max-w-full md:h-[calc(100vh-6.25rem-48px)] md:max-h-[900px] overflow-hidden">
      {/* ─── History Sidebar ─── */}
      <AnimatePresence>
        {showHistory && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 280, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="hidden sm:flex overflow-hidden shrink-0"
          >
            <ConversationSidebar
              conversations={conversations}
              activeId={activeConversationId}
              onSelect={loadConversation}
              onDelete={handleDeleteConversation}
              onNewChat={newChat}
              isLoading={conversationsLoading}
              onClose={() => setShowHistory(false)}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── Chat Panel ─── */}
      <div
        className={`flex flex-col flex-1 min-w-0 transition-all duration-300 ${
          showDashboard ? 'lg:w-[55%]' : 'w-full'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 sm:px-5 py-2.5 sm:py-3 border-b border-[rgba(0,122,255,0.1)] bg-[#0D1117]/80 shrink-0">
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            {/* History toggle */}
            <button
              onClick={() => setShowHistory(!showHistory)}
              className={`p-2 rounded-lg transition-colors hidden sm:flex ${
                showHistory
                  ? 'bg-[#007AFF]/15 text-[#007AFF]'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
              }`}
              title="Chat History"
            >
              <History className="w-4 h-4" />
            </button>
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-gradient-to-br from-[#007AFF]/20 to-cyan-500/10 border border-[#007AFF]/25 flex items-center justify-center shrink-0">
              <Brain className="w-4 h-4 text-[#007AFF]" />
            </div>
            <div>
              <h1 className="text-xs sm:text-sm font-bold text-white font-display">
                AI Copilot
              </h1>
              <p className="text-[10px] text-slate-500 font-mono hidden sm:block">
                RAG + Quant Models + GROQ LLM
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {/* Model indicator + usage - always visible */}
            <ModelIndicator model={activeModel} isStreaming={streaming} />
            <UsageBadge />
            <LiveQuoteStrip />
            {analysisData && !showDashboard && (
              <button
                onClick={() => setShowDashboard(true)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#007AFF]/10 border border-[#007AFF]/25 text-[10px] text-[#007AFF] font-semibold hover:bg-[#007AFF]/20 transition-colors"
              >
                <BarChart3 className="w-3.5 h-3.5" />
                {analysisData.symbol} Data
              </button>
            )}
            <button
              onClick={newChat}
              className="p-2 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-800/60 transition-colors"
              title="New conversation"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Pipeline Status */}
        <AnimatePresence>
          <PipelineStatus
            stage={pipelineStage}
            intent={currentIntent}
            symbol={currentSymbol}
          />
        </AnimatePresence>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {!hasMessages ? (
            <WelcomeScreen onPrompt={(p) => sendMessage(p)} />
          ) : (
            <>
              {messages.map((msg) => (
                <MessageBubble key={msg.id} msg={msg} />
              ))}
              <div ref={bottomRef} />
            </>
          )}
        </div>

        {/* Input bar */}
        <div className="shrink-0 px-5 py-4 border-t border-[rgba(0,122,255,0.1)] bg-[#0D1117]/60">
          <div className="flex items-end gap-3">
            <div className="flex-1 relative">
              <textarea
                ref={inputRef}
                rows={1}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value)
                  e.target.style.height = 'auto'
                  e.target.style.height = Math.min(e.target.scrollHeight, 160) + 'px'
                }}
                onKeyDown={handleKeyDown}
                placeholder="Analyze any stock, compare tickers, explore sectors, assess risk..."
                disabled={streaming}
                className="w-full resize-none bg-[#101928] border border-slate-700/60 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-[#007AFF]/50 focus:ring-1 focus:ring-[#007AFF]/20 disabled:opacity-50 transition-colors font-sans min-h-[46px] max-h-40"
                style={{ height: '46px' }}
              />
            </div>

            {streaming ? (
              <button
                onClick={stopStreaming}
                className="h-[46px] px-4 rounded-xl bg-red-500/20 border border-red-500/40 text-red-400 hover:bg-red-500/30 transition-colors flex items-center gap-2 shrink-0"
              >
                <StopCircle className="w-4 h-4" />
                <span className="text-xs font-medium hidden sm:block">Stop</span>
              </button>
            ) : (
              <button
                onClick={() => sendMessage(input)}
                disabled={!input.trim()}
                className="h-[46px] px-4 rounded-xl bg-[#007AFF] text-white hover:bg-[#0066CC] disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-2 shrink-0 shadow-lg shadow-[rgba(0,122,255,0.2)]"
              >
                <Send className="w-4 h-4" />
                <span className="text-xs font-semibold hidden sm:block">Send</span>
              </button>
            )}
          </div>

          <p className="text-[10px] text-slate-600 mt-2 text-center">
            Enter to send · Shift+Enter for new line · Full pipeline: RAG → Quant → LLM · Not
            financial advice
          </p>
        </div>
      </div>

      {/* ─── Analysis Dashboard Panel ─── */}
      <AnimatePresence>
        {showDashboard && analysisData && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: '45%', opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
            className="hidden lg:flex flex-col border-l border-slate-700/50 bg-[#0A0E1A] overflow-hidden"
          >
            <AnalysisDashboard data={analysisData} onClose={() => setShowDashboard(false)} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Page Export ──────────────────────────────────────────────────────────────

export default function CopilotPage() {
  const { isAuthenticated, isLoading } = useAuth()
  if (isLoading) return null
  if (!isAuthenticated) {
    return (
      <AppLayout>
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-center max-w-md px-4">
            <div className="w-16 h-16 rounded-2xl bg-[#007AFF]/15 border border-[#007AFF]/30 flex items-center justify-center mx-auto mb-4">
              <Brain className="w-8 h-8 text-[#007AFF]" />
            </div>
            <h2 className="text-xl font-bold text-white mb-2">Sign in to access AI Copilot</h2>
            <p className="text-slate-400 text-sm mb-4">
              Institutional-grade analysis with RAG, quant models, and real-time data.
            </p>
            <a
              href="/auth"
              className="inline-flex items-center px-5 py-2.5 rounded-xl bg-[#007AFF] text-white font-semibold hover:bg-[#0066CC] transition-colors"
            >
              Sign In
            </a>
          </div>
        </div>
      </AppLayout>
    )
  }
  return (
    <>
      <div className="hidden md:block">
        <AppLayout>
          <CopilotInner />
        </AppLayout>
      </div>
      <div className="md:hidden flex flex-col h-[100dvh] bg-[#0A0E1A] overflow-hidden text-white">
        <div className="flex-1 overflow-hidden flex flex-col pt-safe">
          <CopilotInner />
        </div>
        <div className="shrink-0 h-[80px] pb-safe bg-[#0A0E1A]" />
        <BottomNav />
      </div>
    </>
  )
}

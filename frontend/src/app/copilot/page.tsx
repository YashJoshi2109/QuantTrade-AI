'use client'

import { useState, useRef, useCallback, useEffect, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import ReactMarkdown from 'react-markdown'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/contexts/AuthContext'
import AppLayout from '@/components/AppLayout'
import BottomNav from '@/components/layout/BottomNav'
import {
  Sparkles,
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
  Gauge,
  PieChart,
  LineChart,
  X,
  History,
  MessageSquare,
  Clock,
  Cpu,
  ChevronLeft,
  ChevronDown,
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
import PolymarketStockCard from '@/components/chat/visual/PolymarketStockCard'
import CopilotLoadingScene from '@/components/chat/CopilotLoadingScene'
import { GlassFilter } from '@/components/ui/liquid-glass'
import TimeWeatherMoodToggle from '@/components/ui/time-weather-mood-toggle'
import { CopilotPromptInput } from '@/components/ui/copilot-prompt-input'
import {
  InlineStructuredSnapshots,
  SnapshotCard,
} from '@/components/copilot/copilot-snapshot-cards'
import { cn } from '@/lib/utils'

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
      className="p-1.5 rounded text-fg-muted hover:text-fg-primary hover:bg-surface-hover transition-colors"
      title="Copy"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  )
}

// ─── Technical Signals Card ───────────────────────────────────────────────────

function TechnicalSignalsCard({ data }: { data: StockAnalysisData }) {
  const ts = data.technical_signal
  if (!ts) return null

  return (
    <div className="bg-surface-base border border-line-subtle rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <Activity className="w-4 h-4 text-cyan-400" />
        <span className="text-xs font-bold text-fg-primary">Technical Signals</span>
        <span className={`ml-auto text-xs font-bold ${trendColor(ts.trend)}`}>
          {ts.bullish_pct?.toFixed(0)}% Bullish
        </span>
      </div>

      <div className="h-2 bg-surface-raised rounded-full overflow-hidden mb-3">
        <div
          className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 rounded-full transition-all duration-700"
          style={{ width: `${ts.bullish_pct ?? 50}%` }}
        />
      </div>

      <div className="space-y-1.5">
        {ts.signals.slice(0, 5).map((sig, i) => (
          <div key={i} className="flex items-center justify-between text-[11px]">
            <span className="text-fg-muted">{sig.name}</span>
            <span
              className={
                sig.signal === 'bullish'
                  ? 'text-emerald-400'
                  : sig.signal === 'bearish'
                  ? 'text-red-400'
                  : 'text-fg-muted'
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
    <div className="bg-surface-base border border-line-subtle rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <PieChart className="w-4 h-4 text-violet-400" />
        <span className="text-xs font-bold text-fg-primary">Fundamentals</span>
        {f.recommendation && (
          <span className="ml-auto px-2 py-0.5 rounded-md text-[10px] font-bold bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
            {f.recommendation}
          </span>
        )}
      </div>
      <div className="grid grid-cols-3 gap-x-4 gap-y-2">
        {metrics.map((m) => (
          <div key={m.label}>
            <div className="text-[10px] text-fg-muted">{m.label}</div>
            <div className="text-xs text-fg-primary font-mono">{m.value}</div>
          </div>
        ))}
      </div>
      {f.week_52_high != null && f.week_52_low != null && (
        <div className="mt-3 pt-3 border-t border-line-subtle">
          <div className="flex items-center justify-between text-[10px] text-fg-muted mb-1">
            <span>52W Low: {formatPrice(f.week_52_low)}</span>
            <span>52W High: {formatPrice(f.week_52_high)}</span>
          </div>
          <div className="h-1.5 bg-surface-raised rounded-full overflow-hidden">
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
    <div className="bg-surface-base border border-line-subtle rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <Brain className="w-4 h-4 text-amber-400" />
        <span className="text-xs font-bold text-fg-primary">Regime & Forecast</span>
      </div>

      {regime && (
        <div className="mb-3">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] text-fg-muted">Market Regime:</span>
            <span
              className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${trendBg(
                regime.regime
              )} ${trendColor(regime.regime)}`}
            >
              {regime.regime}
            </span>
            <span className="text-[10px] text-fg-muted">
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
                    : 'bg-surface-raised/40 text-fg-muted'
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
                <span className="text-[11px] text-fg-muted">{label}</span>
                <div className="flex items-center gap-2">
                  <span className={`text-[11px] font-semibold ${trendColor(h.direction)}`}>
                    {h.direction.toUpperCase()}
                  </span>
                  <span className="text-[10px] text-fg-muted">{h.confidence.toFixed(0)}%</span>
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
    <div className="bg-surface-base border border-line-subtle rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <Shield className="w-4 h-4 text-red-400" />
        <span className="text-xs font-bold text-fg-primary">Risk Assessment</span>
        <span className={`ml-auto text-xs font-bold ${riskColor}`}>
          {score}/100 · {riskLevel}
        </span>
      </div>

      <div className="h-2 bg-surface-raised rounded-full overflow-hidden mb-3">
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
              <div className="text-[10px] text-fg-muted">{m.label}</div>
              <div className="text-xs text-fg-primary font-mono">{m.value}</div>
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
    <div className="bg-surface-base border border-line-subtle rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <Newspaper className="w-4 h-4 text-blue-400" />
        <span className="text-xs font-bold text-fg-primary">Sentiment & Analyst</span>
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
            <span className="text-fg-muted">Analyst Rating</span>
            <span className="text-fg-primary font-semibold">{sent.analyst_recommendation}</span>
          </div>
        )}
        {sent.target_price != null && (
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-fg-muted">Price Target</span>
            <span className="text-fg-primary font-mono">{formatPrice(sent.target_price)}</span>
          </div>
        )}
        {sent.target_upside != null && (
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-fg-muted">Target Upside</span>
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
          <span className="text-fg-muted">Sentiment Score</span>
          <span className="text-fg-primary font-mono">{sent.score.toFixed(2)}</span>
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
    <div className="bg-surface-base border border-line-subtle rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <LineChart className="w-4 h-4 text-purple-400" />
        <span className="text-xs font-bold text-fg-primary">Monte Carlo Simulation</span>
        <span className="text-[10px] text-fg-muted ml-auto">10K paths</span>
      </div>
      <div className="space-y-3">
        {periods.map((p) => {
          const d = p.data!
          // Backend returns nested: percentiles.p10/p50/p90, probabilities.price_up
          const pct = d.percentiles || {}
          const probs = d.probabilities || {}
          const p10 = pct.p10 ?? d.p10
          const median = pct.p50 ?? d.median
          const p90 = pct.p90 ?? d.p90
          const probUp = probs.price_up != null ? probs.price_up / 100 : d.prob_above_current
          const expectedReturn = d.expected_return_pct
          return (
            <div key={p.key}>
              <div className="flex items-center justify-between mb-1">
                <div className="text-[10px] text-fg-muted">{p.label}</div>
                {expectedReturn != null && (
                  <div className={`text-[10px] font-bold font-mono ${expectedReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    E[R]: {expectedReturn > 0 ? '+' : ''}{expectedReturn.toFixed(2)}%
                  </div>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-red-500/5 border border-red-500/10 rounded-lg p-2 text-center">
                  <div className="text-[9px] text-red-400">P10 (Bear)</div>
                  <div className="text-xs text-red-300 font-mono">{formatPrice(p10)}</div>
                </div>
                <div className="bg-cyan-500/5 border border-cyan-500/10 rounded-lg p-2 text-center">
                  <div className="text-[9px] text-cyan-400">Median</div>
                  <div className="text-xs text-cyan-300 font-mono">{formatPrice(median)}</div>
                </div>
                <div className="bg-emerald-500/5 border border-emerald-500/10 rounded-lg p-2 text-center">
                  <div className="text-[9px] text-emerald-400">P90 (Bull)</div>
                  <div className="text-xs text-emerald-300 font-mono">{formatPrice(p90)}</div>
                </div>
              </div>
              {probUp != null && (
                <div className="text-[10px] text-fg-muted mt-1 text-center">
                  {(probUp * 100).toFixed(1)}% probability above current price
                </div>
              )}
              {/* Confidence intervals */}
              {d.confidence_intervals && (
                <div className="grid grid-cols-2 gap-2 mt-2">
                  {d.confidence_intervals['80'] && (
                    <div className="bg-surface-raised/40 rounded-lg px-2 py-1 text-center">
                      <div className="text-[8px] text-fg-muted uppercase">80% CI</div>
                      <div className="text-[10px] text-fg-primary font-mono">
                        {formatPrice(d.confidence_intervals['80'].lower)} – {formatPrice(d.confidence_intervals['80'].upper)}
                      </div>
                    </div>
                  )}
                  {d.confidence_intervals['95'] && (
                    <div className="bg-surface-raised/40 rounded-lg px-2 py-1 text-center">
                      <div className="text-[8px] text-fg-muted uppercase">95% CI</div>
                      <div className="text-[10px] text-fg-primary font-mono">
                        {formatPrice(d.confidence_intervals['95'].lower)} – {formatPrice(d.confidence_intervals['95'].upper)}
                      </div>
                    </div>
                  )}
                </div>
              )}
              {/* Key probabilities */}
              {probs.gain_5pct != null && (
                <div className="flex items-center gap-3 mt-2 text-[10px]">
                  <span className="text-emerald-400">+5%: {probs.gain_5pct?.toFixed(0)}%</span>
                  <span className="text-emerald-400">+10%: {probs.gain_10pct?.toFixed(0)}%</span>
                  <span className="text-red-400">-5%: {probs.loss_5pct?.toFixed(0)}%</span>
                  <span className="text-red-400">-10%: {probs.loss_10pct?.toFixed(0)}%</span>
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
    <div className="bg-surface-base border border-line-subtle rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <Gauge className="w-4 h-4 text-cyan-400" />
        <span className="text-xs font-bold text-fg-primary">Confidence Breakdown</span>
      </div>
      <div className="space-y-2">
        {Object.entries(conf.components).map(([key, value]) => {
          const label = key
            .replace(/_/g, ' ')
            .replace(/\b\w/g, (c) => c.toUpperCase())
          return (
            <div key={key}>
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[11px] text-fg-muted">{label}</span>
                <span className={`text-[11px] font-mono ${confidenceColor(value)}`}>
                  {value.toFixed(0)}%
                </span>
              </div>
              <div className="h-1.5 bg-surface-raised rounded-full overflow-hidden">
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
      <div className="flex items-center justify-between px-4 py-3 border-b border-line-subtle shrink-0">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-[#007AFF]" />
          <span className="text-sm font-bold text-fg-primary">{data.symbol} Analysis</span>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-surface-raised/60 text-fg-muted hover:text-white transition-colors"
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
        <PolymarketStockCard symbol={data.symbol} companyName={data.company?.name} />
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
            : 'bg-surface-raised border border-[rgba(0,122,255,0.2)] text-[#007AFF]'
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
              : 'bg-surface-raised border border-[rgba(0,122,255,0.12)] text-fg-primary rounded-tl-sm'
          }`}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap">{msg.content}</p>
          ) : (
            <>
              {msg.structuredData ? (
                <InlineStructuredSnapshots data={msg.structuredData} />
              ) : null}
              <div className="prose prose-invert prose-sm max-w-none">
              <ReactMarkdown
                components={{
                  p: ({ children }) => <p className="mb-2 last:mb-0 text-fg-primary">{children}</p>,
                  strong: ({ children }) => (
                    <strong className="font-bold text-fg-primary">{children}</strong>
                  ),
                  em: ({ children }) => <em className="text-fg-muted italic text-xs">{children}</em>,
                  code: ({ children, className }) => {
                    const isBlock = className?.includes('language-')
                    return isBlock ? (
                      <code className="block bg-[#0D1117] border border-line-subtle rounded-lg p-3 text-xs font-mono text-emerald-300 my-2 overflow-x-auto whitespace-pre">
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
                  li: ({ children }) => <li className="text-fg-primary">{children}</li>,
                  h1: ({ children }) => (
                    <h1 className="text-fg-primary font-bold text-base mt-3 mb-1">{children}</h1>
                  ),
                  h2: ({ children }) => (
                    <h2 className="text-[#007AFF] font-bold text-sm mt-4 mb-1.5 flex items-center gap-1.5">
                      <span className="w-1 h-4 bg-[#007AFF] rounded-full" />
                      {children}
                    </h2>
                  ),
                  h3: ({ children }) => (
                    <h3 className="text-fg-primary font-semibold text-sm mt-2 mb-1">{children}</h3>
                  ),
                  table: ({ children }) => (
                    <div className="overflow-x-auto my-2">
                      <table className="w-full text-xs border-collapse border border-line-subtle rounded-lg overflow-hidden">
                        {children}
                      </table>
                    </div>
                  ),
                  th: ({ children }) => (
                    <th className="border border-line-subtle bg-[#0D1117] px-3 py-1.5 text-left text-fg-primary font-semibold">
                      {children}
                    </th>
                  ),
                  td: ({ children }) => (
                    <td className="border border-line-subtle px-3 py-1.5 text-fg-muted">
                      {children}
                    </td>
                  ),
                  blockquote: ({ children }) => (
                    <blockquote className="border-l-2 border-[#007AFF]/40 pl-3 text-fg-muted italic my-2">
                      {children}
                    </blockquote>
                  ),
                  hr: () => <hr className="border-line-subtle my-3" />,
                }}
              >
                {msg.content}
              </ReactMarkdown>
              {msg.streaming && (
                <span className="inline-block w-1.5 h-4 bg-[#007AFF] rounded-sm animate-pulse ml-0.5 -mb-0.5" />
              )}
            </div>
            </>
          )}
        </div>

        {!isUser && !msg.streaming && msg.content && (
          <div className="flex items-center gap-1 mt-1 px-1">
            <CopyButton text={msg.content} />
            {msg.meta?.sources && msg.meta.sources.length > 0 && (
              <span className="text-[9px] text-fg-muted font-mono">
                Sources: {msg.meta.sources.slice(0, 3).join(', ')}
              </span>
            )}
            <span className="text-[10px] text-fg-muted font-mono ml-auto">
              {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        )}
      </div>
    </motion.div>
  )
}

// ─── Welcome Screen ──────────────────────────────────────────────────────────

/** Wide + short viewports (e.g. Copilot panel beside sidebar): brand left, prompts 3×2 right */
const welcomeWideShort =
  '[@media(min-width:720px)_and_(max-height:680px)]:grid [@media(min-width:720px)_and_(max-height:680px)]:w-full [@media(min-width:720px)_and_(max-height:680px)]:max-w-5xl [@media(min-width:720px)_and_(max-height:680px)]:grid-cols-[minmax(200px,32%)_minmax(0,1fr)] [@media(min-width:720px)_and_(max-height:680px)]:items-center [@media(min-width:720px)_and_(max-height:680px)]:gap-x-8 [@media(min-width:720px)_and_(max-height:680px)]:gap-y-4 [@media(min-width:720px)_and_(max-height:680px)]:px-4'

const welcomeIntroWideShort =
  '[@media(min-width:720px)_and_(max-height:680px)]:items-start [@media(min-width:720px)_and_(max-height:680px)]:text-left [@media(min-width:720px)_and_(max-height:680px)]:self-center'

const welcomePromptsWideShort =
  '[@media(min-width:720px)_and_(max-height:680px)]:max-w-none [@media(min-width:720px)_and_(max-height:680px)]:min-h-0'

const welcomePromptGridWideShort =
  '[@media(min-width:720px)_and_(max-height:680px)]:grid-cols-3 [@media(min-width:720px)_and_(max-height:680px)]:auto-rows-fr [@media(min-width:720px)_and_(max-height:680px)]:gap-2'

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
    <div className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center overflow-hidden px-1 sm:px-2">
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <div className="absolute -top-16 left-1/2 h-[min(48vh,12rem)] w-[min(36rem,92%)] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(0,122,255,0.22),transparent_70%)] blur-[64px] [@media(max-height:520px)]:h-32" />
        <div className="absolute bottom-0 right-0 h-40 w-40 translate-x-1/3 translate-y-1/3 rounded-full bg-[radial-gradient(circle,rgba(34,211,238,0.12),transparent_65%)] blur-[72px] [@media(max-height:520px)]:h-28 [@media(max-height:520px)]:w-28" />
      </div>

      <div
        className={cn(
          'relative mx-auto grid min-h-0 w-full max-w-2xl flex-1 content-center justify-items-center gap-3 py-1 [@media(max-height:520px)]:gap-2 [@media(max-height:520px)]:py-0',
          'grid-cols-1',
          welcomeWideShort
        )}
      >
        <div
          className={cn(
            'flex w-full max-w-md flex-col items-center text-center [@media(max-height:520px)]:max-w-lg',
            welcomeIntroWideShort
          )}
        >
          <div
            className={cn(
              'mb-1.5 inline-flex max-w-full items-center gap-1.5 rounded-full border border-line-subtle px-3 py-1 text-[10px] font-semibold text-fg-primary sm:mb-2 sm:gap-2 sm:px-4 sm:py-1.5 sm:text-[11px] [@media(max-height:520px)]:mb-1 [@media(max-height:520px)]:py-0.5',
              'bg-white/[0.04] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-md'
            )}
          >
            <Sparkles className="h-3 w-3 shrink-0 text-cyan-300 sm:h-3.5 sm:w-3.5" />
            <span className="truncate">RAG · Quant models · Live data</span>
          </div>

          <div
            className={cn(
              'mb-1.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl sm:mb-2 sm:h-14 sm:w-14 [@media(max-height:520px)]:mb-1 [@media(max-height:520px)]:h-9 [@media(max-height:520px)]:w-9',
              'border border-[#007AFF]/35 bg-gradient-to-br from-[#007AFF]/25 via-cyan-500/10 to-transparent',
              'shadow-[0_0_32px_rgba(0,122,255,0.18),inset_0_1px_0_rgba(255,255,255,0.1)]'
            )}
          >
            <Brain className="h-6 w-6 text-white sm:h-7 sm:w-7 [@media(max-height:520px)]:h-5 [@media(max-height:520px)]:w-5" />
          </div>

          <h2 className="mb-1 font-display text-[clamp(1.05rem,1.2vw+0.7rem,2.35rem)] font-bold leading-tight tracking-tight text-white sm:mb-1.5 [@media(max-height:520px)]:text-[clamp(1rem,1.1vw+0.55rem,1.65rem)]">
            QuantTrade AI{' '}
            <span className="bg-gradient-to-b from-[#6eb6ff] via-[#007AFF] to-cyan-300 bg-clip-text text-transparent">
              Copilot
            </span>
          </h2>
          <p className="mb-2 max-w-md px-1 text-[clamp(0.65rem,0.55vw+0.5rem,0.875rem)] leading-snug text-fg-muted sm:mb-3 sm:max-w-lg sm:leading-relaxed [@media(max-height:520px)]:mb-1.5 [@media(max-height:520px)]:line-clamp-2">
            Institutional-grade analysis: quant models, RAG retrieval, and live market data.
          </p>

          <div className="mb-0 flex max-w-full flex-wrap items-center justify-center gap-1.5 sm:gap-2 [@media(max-height:520px)]:gap-1">
            {['RAG', 'Quant', 'Confidence', 'Live'].map((tag) => (
              <span
                key={tag}
                className={cn(
                  'rounded-md border border-cyan-500/20 bg-cyan-500/[0.07] px-2 py-0.5 text-[8px] font-bold uppercase tracking-wide text-cyan-200/90 sm:rounded-lg sm:px-2.5 sm:py-1 sm:text-[9px]',
                  'backdrop-blur-sm [@media(max-height:520px)]:px-1.5 [@media(max-height:520px)]:text-[7px]'
                )}
              >
                {tag}
              </span>
            ))}
          </div>
        </div>

        <div
          className={cn(
            'w-full max-w-xl min-h-0 [@media(max-height:520px)]:max-w-2xl',
            welcomePromptsWideShort
          )}
        >
          <div
            className={cn(
              'grid min-h-0 w-full grid-cols-2 gap-1.5 sm:gap-2.5 md:gap-3',
              welcomePromptGridWideShort
            )}
          >
            {COPILOT_QUICK_PROMPTS.map((qp) => {
              const Icon = iconMap[qp.icon] || Sparkles
              return (
                <button
                  key={qp.label}
                  type="button"
                  onClick={() => onPrompt(qp.prompt)}
                  className={cn(
                    'group flex min-h-0 items-start gap-1.5 rounded-xl border p-2 text-left transition-all duration-300 sm:gap-2.5 sm:rounded-2xl sm:p-3 md:p-3.5',
                    '[@media(min-width:720px)_and_(max-height:680px)]:flex-col [@media(min-width:720px)_and_(max-height:680px)]:items-stretch [@media(min-width:720px)_and_(max-height:680px)]:gap-1.5 [@media(min-width:720px)_and_(max-height:680px)]:p-2',
                    '[@media(max-height:520px)]:gap-1 [@media(max-height:520px)]:p-1.5 [@media(max-height:520px)]:rounded-lg',
                    'border-line-subtle bg-[rgba(10,14,26,0.55)] backdrop-blur-md',
                    'hover:border-[#007AFF]/35 hover:bg-[rgba(0,122,255,0.08)] hover:shadow-[0_8px_28px_rgba(0,0,0,0.3)]',
                    'active:scale-[0.99]'
                  )}
                >
                  <div
                    className={cn(
                      'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line-subtle sm:h-9 sm:w-9 sm:rounded-xl',
                      '[@media(min-width:720px)_and_(max-height:680px)]:h-8 [@media(min-width:720px)_and_(max-height:680px)]:w-8',
                      'bg-gradient-to-br from-[#007AFF]/20 to-transparent group-hover:from-[#007AFF]/35'
                    )}
                  >
                    <Icon className="h-3.5 w-3.5 text-[#5eb0ff] transition-colors group-hover:text-cyan-200 sm:h-4 sm:w-4" />
                  </div>
                  <div className="min-w-0 flex-1 text-left">
                    <div
                      className={cn(
                        'text-[11px] font-semibold leading-tight text-white transition-colors group-hover:text-cyan-100 sm:text-sm sm:leading-snug',
                        '[@media(min-width:720px)_and_(max-height:680px)]:text-[11px]',
                        '[@media(max-height:520px)]:text-[10px]'
                      )}
                    >
                      {qp.label}
                    </div>
                    <div
                      className={cn(
                        'mt-0.5 line-clamp-2 text-[9px] leading-tight text-fg-muted sm:mt-1 sm:text-[10px] sm:leading-snug',
                        '[@media(min-width:720px)_and_(max-height:680px)]:line-clamp-2 [@media(min-width:720px)_and_(max-height:680px)]:text-[9px]',
                        '[@media(max-height:520px)]:line-clamp-1 [@media(max-height:520px)]:text-[8px]'
                      )}
                    >
                      {qp.prompt}
                    </div>
                  </div>
                  <ChevronRight className="mt-0.5 hidden h-3.5 w-3.5 shrink-0 text-fg-muted opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100 sm:mt-0.5 sm:block sm:h-4 sm:w-4 [@media(min-width:720px)_and_(max-height:680px)]:hidden" />
                </button>
              )
            })}
          </div>
        </div>
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
    refetchInterval: 60_000,
  })

  const price = data?.price ?? 0
  const pct = data?.change_percent ?? 0
  const up = pct >= 0
  const ok = price > 0

  return (
    <div className="hidden sm:flex items-center gap-2 rounded-xl border border-line-subtle bg-[rgba(8,12,24,0.55)] px-2.5 py-1 text-[10px] font-mono text-fg-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-md">
      <BarChart3 className="w-3.5 h-3.5 shrink-0 text-cyan-400" />
      <span className="font-bold text-white tracking-tight">SPY</span>
      {ok ? (
        <>
          <span className="text-fg-primary tabular-nums">${price.toFixed(2)}</span>
          <span className={up ? 'text-emerald-400' : 'text-red-400'}>
            {up ? '+' : ''}
            {pct.toFixed(2)}%
          </span>
        </>
      ) : (
        <span className="text-fg-muted">--</span>
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
    'fallback': { name: 'Llama 3.1 8B', color: 'text-fg-muted border-line-subtle bg-surface-raised' },
    'rate_limited': { name: 'Rate Limited', color: 'text-red-400 border-red-500/30 bg-red-500/10' },
    'none': { name: 'No Model', color: 'text-fg-muted border-line-subtle bg-surface-raised' },
  }

  const info = modelLabels[model] || modelLabels['groq']

  return (
    <div
      className={cn(
        'hidden sm:flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[10px] font-mono backdrop-blur-md',
        'shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]',
        info.color
      )}
    >
      <Cpu className={cn('h-3 w-3', isStreaming && 'animate-pulse')} />
      <span className="font-semibold">{info.name}</span>
      {isStreaming && (
        <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
      )}
    </div>
  )
}

// ─── Usage Badge ──────────────────────────────────────────────────────────────

function UsageBadge() {
  const [open, setOpen] = useState(false)
  const [popoverBox, setPopoverBox] = useState<{ top: number; left: number; width: number } | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const anchorRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { data } = useQuery({
    queryKey: ['copilot-usage'],
    queryFn: getCopilotUsage,
    staleTime: 30_000,
    refetchInterval: 60_000,
  })

  const hoverDesktop = useCallback(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia('(hover: hover) and (pointer: fine)').matches
  }, [])

  const clearLeaveTimer = useCallback(() => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current)
    leaveTimer.current = null
  }, [])

  const repositionPopover = useCallback(() => {
    const el = anchorRef.current
    if (!el || !open) return
    const r = el.getBoundingClientRect()
    const width = Math.min(288, window.innerWidth - 16)
    const left = Math.max(8, r.right - width)
    const top = r.bottom + 4
    setPopoverBox({ top, left, width })
  }, [open])

  useLayoutEffect(() => {
    if (!open) {
      setPopoverBox(null)
      return
    }
    repositionPopover()
    window.addEventListener('resize', repositionPopover)
    window.addEventListener('scroll', repositionPopover, true)
    return () => {
      window.removeEventListener('resize', repositionPopover)
      window.removeEventListener('scroll', repositionPopover, true)
    }
  }, [open, repositionPopover])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      if (wrapRef.current?.contains(t) || panelRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const onZoneEnter = useCallback(() => {
    if (!hoverDesktop()) return
    clearLeaveTimer()
    setOpen(true)
  }, [hoverDesktop, clearLeaveTimer])

  const onZoneLeave = useCallback(() => {
    if (!hoverDesktop()) return
    clearLeaveTimer()
    leaveTimer.current = setTimeout(() => setOpen(false), 220)
  }, [hoverDesktop, clearLeaveTimer])

  const onPanelEnter = useCallback(() => {
    clearLeaveTimer()
  }, [clearLeaveTimer])

  const onPanelLeave = useCallback(() => {
    if (!hoverDesktop()) return
    clearLeaveTimer()
    leaveTimer.current = setTimeout(() => setOpen(false), 220)
  }, [hoverDesktop, clearLeaveTimer])

  if (!data) return null

  const pctUsed =
    data.free_limit > 0 ? Math.min(100, (data.today_requests / data.free_limit) * 100) : 0
  const pctRemaining =
    data.free_limit > 0 ? Math.min(100, (data.free_remaining / data.free_limit) * 100) : 100
  const barColor =
    pctUsed >= 100 ? 'bg-red-500' : pctUsed >= 60 ? 'bg-amber-500' : 'bg-emerald-500'

  const DetailPanel = ({ className }: { className?: string }) => (
    <div
      className={`rounded-lg border border-line-subtle/80 bg-surface-base p-3 text-left shadow-xl shadow-black/40 ${className ?? ''}`}
    >
      <div className="mb-2 flex items-center gap-2 border-b border-line-subtle/80 pb-2">
        <Gauge className="h-4 w-4 shrink-0 text-cyan-400" />
        <span className="text-xs font-bold text-fg-primary">API usage</span>
        {data.is_pro ? (
          <span className="ml-auto rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-bold text-emerald-400">
            PRO
          </span>
        ) : (
          <span className="ml-auto rounded bg-surface-raised/50 px-1.5 py-0.5 text-[9px] font-mono text-fg-muted">
            Free
          </span>
        )}
      </div>
      <div className="space-y-2.5 text-[11px] text-fg-primary">
        <div>
          <div className="mb-1 flex justify-between font-mono text-[10px] text-fg-muted">
            <span>Daily requests</span>
            <span className="text-fg-primary">
              {data.today_requests}
              {!data.is_pro && data.free_limit > 0 ? ` / ${data.free_limit}` : ''}
            </span>
          </div>
          {!data.is_pro && data.free_limit > 0 && (
            <div className="h-2 w-full overflow-hidden rounded-full bg-surface-raised">
              <div
                className={`h-full rounded-full transition-all ${barColor}`}
                style={{ width: `${pctUsed}%` }}
              />
            </div>
          )}
          {!data.is_pro && data.free_limit > 0 && (
            <p className="mt-1 font-mono text-[10px] text-fg-muted">
              {data.free_remaining} remaining ({pctRemaining.toFixed(0)}% of daily free quota)
            </p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2 font-mono text-[10px] text-fg-muted">
          <div>
            <div className="text-fg-muted">Input tokens</div>
            <div className="text-fg-primary">{formatLargeNumber(data.today_input_tokens)}</div>
          </div>
          <div>
            <div className="text-fg-muted">Output tokens</div>
            <div className="text-fg-primary">{formatLargeNumber(data.today_output_tokens)}</div>
          </div>
        </div>
        <div className="border-t border-line-subtle/80 pt-2 font-mono text-[10px] text-fg-muted">
          <div className="flex justify-between">
            <span>Est. cost today</span>
            <span className="text-fg-primary">${data.today_cost_usd.toFixed(4)}</span>
          </div>
          <div className="mt-1 flex justify-between">
            <span>Budget left</span>
            <span className={data.budget_ok ? 'text-emerald-400' : 'text-amber-400'}>
              ${data.budget_remaining_usd.toFixed(2)} / ${data.daily_budget_usd.toFixed(2)}
            </span>
          </div>
        </div>
      </div>
    </div>
  )

  const popover =
    open &&
    popoverBox &&
    typeof document !== 'undefined' &&
    createPortal(
      <div
        ref={panelRef}
        role="dialog"
        aria-label="Copilot API usage"
        className="fixed z-[600] -mt-2 min-h-0 pt-2 outline-none"
        style={{
          top: popoverBox.top,
          left: popoverBox.left,
          width: popoverBox.width,
        }}
        onMouseEnter={onPanelEnter}
        onMouseLeave={onPanelLeave}
      >
        <DetailPanel />
      </div>,
      document.body
    )

  return (
    <>
      <div
        ref={wrapRef}
        className="relative shrink-0"
        onMouseEnter={onZoneEnter}
        onMouseLeave={onZoneLeave}
      >
        <button
          ref={anchorRef}
          type="button"
          onClick={() => setOpen((o) => !o)}
          className={
            data.is_pro
              ? 'flex items-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[10px] font-mono text-emerald-400 transition-colors hover:bg-emerald-500/15'
              : 'flex items-center gap-1.5 rounded-lg border border-line-subtle/40 bg-surface-raised/30 px-2 py-1 text-[10px] font-mono text-fg-muted transition-colors hover:border-slate-600 hover:bg-surface-raised/50'
          }
          aria-expanded={open}
          aria-haspopup="dialog"
        >
          {data.is_pro ? (
            <>
              <span className="font-bold">PRO</span>
              <span className="text-emerald-300/80">{data.today_requests} req</span>
              <ChevronDown className={`h-3 w-3 opacity-70 transition-transform ${open ? 'rotate-180' : ''}`} />
            </>
          ) : (
            <>
              <div className="h-1.5 w-10 overflow-hidden rounded-full bg-surface-raised">
                <div
                  className={`h-full rounded-full ${barColor} transition-all`}
                  style={{ width: `${pctUsed}%` }}
                />
              </div>
              <span>
                {data.free_remaining}/{data.free_limit}
              </span>
              <ChevronDown className={`h-3 w-3 opacity-60 transition-transform ${open ? 'rotate-180' : ''}`} />
            </>
          )}
        </button>
      </div>
      {popover}
    </>
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
      <div className="flex items-center gap-2 rounded-xl border border-[#007AFF]/20 bg-[rgba(0,122,255,0.06)] px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-md">
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
                      : 'bg-surface-raised text-fg-muted'
                  }`}
                >
                  {done ? (
                    <Check className="w-3 h-3" />
                  ) : (
                    <Icon className={`w-3 h-3 ${active ? 'animate-pulse' : ''}`} />
                  )}
                </div>
                {i < stages.length - 1 && (
                  <ChevronRight className="w-3 h-3 text-fg-muted mx-0.5" />
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
            <span className="text-[10px] text-fg-muted ml-1.5">
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
  const buildConversationSummary = (conv: ConversationSummary) => {
    const primary = (conv.title || conv.last_message || 'New conversation').trim()
    if (primary.length <= 140) return primary
    return `${primary.slice(0, 137)}...`
  }

  const buildConversationPreview = (conv: ConversationSummary) => {
    const preview = (conv.last_message || '').trim()
    if (!preview) return 'No assistant response captured yet.'
    if (preview.length <= 96) return preview
    return `${preview.slice(0, 93)}...`
  }

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

  const HistoryListSkeleton = () => (
    <div className="py-2 px-2 space-y-2">
      {Array.from({ length: 7 }).map((_, idx) => (
        <div
          key={idx}
          className="rounded-xl border border-line-subtle/90 bg-gradient-to-r from-[#0a0f1d] to-[#0d1220] p-3 animate-pulse"
        >
          <div className="h-3 w-3/4 rounded bg-surface-raised/60" />
          <div className="mt-2 h-2.5 w-full rounded bg-surface-raised/80" />
          <div className="mt-1.5 h-2.5 w-2/3 rounded bg-surface-raised/70" />
          <div className="mt-2.5 flex items-center gap-2">
            <div className="h-2.5 w-16 rounded bg-surface-raised/70" />
            <div className="h-2.5 w-10 rounded bg-surface-raised/70" />
          </div>
        </div>
      ))}
    </div>
  )

  return (
    <div className="flex flex-col h-full bg-surface-base border-r border-line-subtle">
      {/* Sidebar Header */}
      <div className="flex items-center justify-between px-3 py-3 border-b border-line-subtle shrink-0 bg-gradient-to-r from-[#0b1220] via-[#0a101b] to-[#080c14]">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#007AFF]/35 bg-[#007AFF]/10 shadow-[0_0_16px_rgba(0,122,255,0.15)]">
            <History className="w-4 h-4 text-[#52a8ff]" />
          </span>
          <div className="leading-tight">
            <span className="text-xs font-bold text-fg-primary">History</span>
            <p className="text-[10px] text-fg-muted">Session memory and analytics trail</p>
          </div>
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
            className="p-1.5 rounded-lg text-fg-muted hover:bg-surface-raised/60 transition-colors lg:hidden"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Conversations List */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <HistoryListSkeleton />
        ) : conversations.length === 0 ? (
          <div className="text-center py-8 px-4">
            <MessageSquare className="w-8 h-8 text-fg-muted mx-auto mb-2" />
            <p className="text-xs text-fg-muted">No conversations yet</p>
            <p className="text-[10px] text-fg-muted mt-1">Start a new chat to begin</p>
          </div>
        ) : (
          <div className="py-2 px-2">
            {conversations.map((conv) => (
              <div
                key={conv.id}
                className={`group relative px-3 py-3 rounded-xl cursor-pointer transition-all border backdrop-blur-sm ${
                  activeId === conv.id
                    ? 'bg-gradient-to-r from-[#007AFF]/14 to-cyan-500/8 border-[#007AFF]/45 shadow-[0_8px_24px_rgba(0,122,255,0.12)]'
                    : 'bg-gradient-to-r from-[#0b101b] to-[#0a0e18] border-line-subtle/80 hover:border-line-subtle/70 hover:from-[#0d1422] hover:to-[#0c1220]'
                }`}
                onClick={() => onSelect(conv.id)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-semibold text-white leading-snug line-clamp-2">
                      {buildConversationSummary(conv)}
                    </p>
                    <p className="text-[10px] text-fg-muted line-clamp-2 mt-1">
                      {buildConversationPreview(conv)}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[9px] text-fg-muted flex items-center gap-1">
                        <Clock className="w-2.5 h-2.5" />
                        {timeAgo(conv.updated_at)}
                      </span>
                      <span className="text-[9px] text-fg-muted">
                        {conv.message_count} msgs
                      </span>
                      <span className="text-[9px] text-cyan-400/90 ml-auto rounded-md border border-cyan-500/20 bg-cyan-500/10 px-1.5 py-0.5">
                        Analysis
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onDelete(conv.id)
                    }}
                    className="p-1 rounded text-fg-muted hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-all shrink-0"
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
  const router = useRouter()
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

  const { data: copilotUsage } = useQuery({
    queryKey: ['copilot-usage'],
    queryFn: getCopilotUsage,
    staleTime: 30_000,
  })

  // Fetch conversation history
  const { data: conversations = [], isLoading: conversationsLoading } = useQuery({
    queryKey: ['copilot-conversations'],
    queryFn: listConversations,
    staleTime: 30_000,
    refetchInterval: 60_000,
  })

  const scrollToBottom = useCallback((force = false) => {
    if (!force) return
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

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
      setTimeout(() => scrollToBottom(true), 80)
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
          <>
            <motion.div
              key="copilot-history-backdrop"
              role="presentation"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-[55] bg-black/60 sm:hidden"
              onClick={() => setShowHistory(false)}
            />
            <motion.div
              key="copilot-history-panel"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 280, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className={cn(
                'flex min-h-0 overflow-hidden shrink-0',
                'max-sm:fixed max-sm:inset-y-0 max-sm:left-0 max-sm:z-[60] max-sm:h-[100dvh]',
                'sm:relative sm:z-auto sm:h-auto'
              )}
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
          </>
        )}
      </AnimatePresence>

      {/* ─── Chat Panel ─── */}
      <div
        className={`flex flex-col flex-1 min-h-0 min-w-0 transition-all duration-300 ${
          showDashboard ? 'lg:w-[55%]' : 'w-full'
        }`}
      >
        {/* Header — liquid glass */}
        <div className="relative shrink-0 border-b border-white/[0.07] bg-[rgba(6,10,22,0.72)] px-3 py-2 backdrop-blur-xl sm:px-5 sm:py-2.5">
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-400/25 to-transparent"
            aria-hidden
          />
          <div className="flex min-w-0 flex-nowrap items-center justify-between gap-2 overflow-x-auto sm:gap-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
              {/* History toggle */}
              <button
                type="button"
                onClick={() => setShowHistory(!showHistory)}
                className={cn(
                  'flex shrink-0 rounded-xl border p-2 transition-all',
                  showHistory
                    ? 'border-[#007AFF]/40 bg-[#007AFF]/15 text-cyan-200 shadow-[0_0_20px_rgba(0,122,255,0.15)]'
                    : 'border-transparent text-fg-muted hover:border-line-subtle hover:bg-white/[0.05] hover:text-white'
                )}
                title="Chat History"
              >
                <History className="h-4 w-4" />
              </button>
              <div
                className={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border sm:h-9 sm:w-9',
                  'border-[#007AFF]/30 bg-gradient-to-br from-[#007AFF]/25 to-cyan-500/5 shadow-[0_0_24px_rgba(0,122,255,0.12)]'
                )}
              >
                <Brain className="h-4 w-4 text-white sm:h-[1.15rem] sm:w-[1.15rem]" />
              </div>
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0">
                  <h1 className="font-display truncate text-xs font-bold text-white sm:text-sm">
                    AI Copilot
                  </h1>
                  <p className="hidden truncate font-mono text-[10px] leading-none text-fg-muted sm:block">
                    RAG + Quant Models + GROQ LLM
                  </p>
                </div>
              </div>
            </div>
            <div className="flex shrink-0 flex-nowrap items-center justify-end gap-1.5 sm:gap-2">
              {/* Model indicator + usage - always visible */}
              <ModelIndicator model={activeModel} isStreaming={streaming} />
              <UsageBadge />
              <LiveQuoteStrip />
              {analysisData && !showDashboard && (
                <button
                  type="button"
                  onClick={() => setShowDashboard(true)}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg border border-[#007AFF]/30 bg-[#007AFF]/10 px-2.5 py-1.5 text-[10px] font-semibold text-cyan-200 transition-colors hover:bg-[#007AFF]/20"
                >
                  <BarChart3 className="w-3.5 h-3.5" />
                  {analysisData.symbol} Data
                </button>
              )}
              <TimeWeatherMoodToggle className="flex shrink-0" />
              <button
                type="button"
                onClick={newChat}
                className="shrink-0 rounded-xl border border-transparent p-2 text-fg-muted transition-colors hover:border-line-subtle hover:bg-white/[0.05] hover:text-white"
                title="New conversation"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
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

        {/* Messages — scroll only when there is a thread; empty state stays one viewport, no scroll */}
        <div
          className={cn(
            'relative min-h-0 flex-1 px-4 py-3 sm:px-5 sm:py-4',
            hasMessages
              ? 'overflow-y-auto scroll-pb-28 sm:scroll-pb-32'
              : 'flex flex-col overflow-hidden'
          )}
        >
          <div
            className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[rgba(0,122,255,0.04)]"
            aria-hidden
          />
          <GlassFilter />
          {!hasMessages ? (
            <WelcomeScreen onPrompt={(p) => sendMessage(p)} />
          ) : (
            <div className="relative z-10 space-y-4">
              {messages.map((msg) => {
                // Show Unicorn WebGL loading scene for empty streaming messages
                if (msg.role === 'assistant' && msg.streaming && !msg.content) {
                  return (
                    <motion.div
                      key={msg.id}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex gap-2.5 items-start"
                    >
                      <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#00D9FF]/20 to-[#7C3AED]/20 flex items-center justify-center flex-shrink-0 border border-line-subtle">
                        <Zap className="w-4 h-4 text-cyan-400" />
                      </div>
                      <CopilotLoadingScene
                        stage={pipelineStage === 'idle' ? 'intent' : pipelineStage === 'done' ? 'streaming' : pipelineStage}
                        symbol={currentSymbol}
                      />
                    </motion.div>
                  )
                }
                return <MessageBubble key={msg.id} msg={msg} />
              })}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {/* Input — glass composer */}
        <div className="relative shrink-0 border-t border-white/[0.07] bg-[rgba(6,10,22,0.78)] px-3 py-3 backdrop-blur-xl sm:px-5 sm:py-4">
          <div
            className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-[#007AFF]/35 to-transparent"
            aria-hidden
          />
          <div className="shadow-[0_16px_48px_rgba(0,0,0,0.45)]">
            <CopilotPromptInput
              ref={inputRef}
              variant="magic"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Analyze any stock, compare tickers, explore sectors, assess risk..."
              disabled={streaming}
              streaming={streaming}
              onSend={() => sendMessage(input)}
              onStop={stopStreaming}
              usage={copilotUsage ?? null}
              onUpgrade={() => router.push('/pricing')}
            />
          </div>

          <p className="mt-2.5 text-center text-[10px] leading-relaxed text-fg-muted">
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
            className="hidden lg:flex flex-col border-l border-line-subtle bg-[#0A0E1A] overflow-hidden"
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
        <div className="flex min-h-screen items-center justify-center px-4">
          <div
            className={cn(
              'w-full max-w-md rounded-2xl border border-line-subtle bg-[rgba(8,12,24,0.75)] p-8 text-center shadow-[0_24px_64px_rgba(0,0,0,0.5)] backdrop-blur-xl',
              'relative overflow-hidden'
            )}
          >
            <div
              className="pointer-events-none absolute -top-20 left-1/2 h-40 w-64 -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(0,122,255,0.25),transparent_70%)] blur-3xl"
              aria-hidden
            />
            <div className="relative">
              <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-[#007AFF]/35 bg-gradient-to-br from-[#007AFF]/25 to-cyan-500/10 shadow-[0_0_32px_rgba(0,122,255,0.2)]">
                <Brain className="h-8 w-8 text-white" />
              </div>
              <h2 className="mb-2 font-display text-xl font-bold text-white">Sign in to access AI Copilot</h2>
              <p className="mb-6 text-sm leading-relaxed text-fg-muted">
                Institutional-grade analysis with RAG, quant models, and real-time data.
              </p>
              <a
                href="/auth"
                className="inline-flex items-center justify-center rounded-xl bg-gradient-to-br from-[#0a84ff] to-[#0060c9] px-6 py-2.5 text-sm font-semibold text-white shadow-[0_0_24px_rgba(0,122,255,0.35)] transition-all hover:brightness-110"
              >
                Sign In
              </a>
            </div>
          </div>
        </div>
      </AppLayout>
    )
  }
  return (
    <>
      <div className="hidden md:block">
        <AppLayout hideFooter>
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

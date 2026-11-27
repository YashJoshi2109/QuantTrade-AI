'use client'

/**
 * AI Copilot (desktop + mobile share CopilotInner; `variant` only changes density).
 *
 * Design intent: a calm research desk. The answer is the hero, every answer shows
 * where its numbers came from and how old they are, forecasts are labelled
 * experimental, limits are stated before they bite, and nothing uses urgency
 * or alarm styling. Tokens live in ./copilot.css (`.cp-scope`).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/contexts/AuthContext'
import AppLayout from '@/components/AppLayout'
import BottomNav from '@/components/layout/BottomNav'
import {
  Activity,
  BarChart3,
  Brain,
  Gauge,
  History,
  LineChart,
  Newspaper,
  PieChart,
  Plus,
  Shield,
  X,
} from 'lucide-react'
import {
  streamCopilotAnalysis,
  type CitationData,
  type CopilotStructuredData,
  type StockAnalysisData,
  type TickerContext,
  formatLargeNumber,
  formatPercent,
  formatPrice,
  confidenceColor,
  trendColor,
  trendBg,
} from '@/lib/copilot-engine'
import {
  listConversations,
  getConversationMessages,
  deleteConversation,
  getCopilotUsage,
  getMyAiUsage,
  getWatchlist,
  fetchCopilotContext,
} from '@/lib/api'
import PolymarketStockCard from '@/components/chat/visual/PolymarketStockCard'
import { SnapshotCard } from '@/components/copilot/copilot-snapshot-cards'
import TickerContextCard from '@/components/copilot/TickerContextCard'
import CitationSourcePanel from '@/components/copilot/CitationSourcePanel'
import CopilotComposer from '@/components/copilot/CopilotComposer'
import CopilotEmptyState from '@/components/copilot/CopilotEmptyState'
import CopilotHistoryPanel from '@/components/copilot/CopilotHistoryPanel'
import CopilotUsageMeter from '@/components/copilot/CopilotUsageMeter'
import {
  AssistantAnswer,
  LimitNoticeCard,
  UserQuestion,
  type CopilotMessageView,
} from '@/components/copilot/CopilotAnswer'
import { formatPercentPoints, parseCopilotParams, suggestedQuestions } from '@/lib/copilot-handoff'
import { computeUsageMeter, formatResetsIn, normalizeUsage } from '@/lib/copilot-usage'
import { buildStarterPrompts, readRecentTickers, rememberRecentTicker } from '@/lib/copilot-prompts'
import { answerTone, classifyCopilotError, type CopilotLimitNotice } from '@/lib/copilot-trust'
import { usePortfolioDetail, usePortfolioList } from '@/lib/usePortfolios'
import { cn } from '@/lib/utils'

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
    { label: 'Profit Mgn', value: formatPercentPoints(f.profit_margin) },
    { label: 'Op Mgn', value: formatPercentPoints(f.operating_margin) },
    { label: 'ROE', value: formatPercentPoints(f.roe) },
    { label: 'D/E', value: f.debt_to_equity?.toFixed(2) },
    { label: 'Beta', value: f.beta?.toFixed(2) },
    { label: 'Div Yield', value: f.dividend_yield ? formatPercentPoints(f.dividend_yield, 2) : null },
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
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--cp-line)] px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-[var(--cp-ink)]">{data.symbol} model data</h2>
          <p className="mt-0.5 text-[12px] leading-snug text-[var(--cp-ink-3)]">
            Raw outputs from experimental models. Signals and ranges describe history, not a prediction.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close model data"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--cp-ink-2)] hover:bg-[var(--cp-sunken)]"
        >
          <X className="h-4 w-4" aria-hidden />
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

// ─── Main Copilot ─────────────────────────────────────────────────────────────

type Stage = 'idle' | 'intent' | 'data' | 'streaming'

interface Msg extends CopilotMessageView {
  /** For assistant messages: the question it answers (regenerate, tone). */
  question?: string
  noticeAt?: number
}

const HISTORY_OPEN_KEY = 'qt.copilot.history-open'
const SESSION_KEY = 'qt_copilot_session'

function statusFor(stage: Stage, symbol: string | null): string {
  if (stage === 'data' || (stage === 'intent' && symbol)) {
    return symbol ? `Reading ${symbol}'s quote, filings and news` : 'Gathering market data'
  }
  if (stage === 'streaming') return 'Writing the answer'
  return 'Understanding your question'
}

function useNow(fast: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), fast ? 1000 : 30_000)
    return () => clearInterval(id)
  }, [fast])
  return now
}

function CopilotInner({ variant }: { variant: 'desktop' | 'mobile' }) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const reduceMotion = useReducedMotion()
  const isMobile = variant === 'mobile'

  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const autoAskedRef = useRef(false)

  const [pinnedSymbol, setPinnedSymbol] = useState<string | null>(null)
  const [tickerContext, setTickerContext] = useState<TickerContext | null>(null)
  const [contextLoading, setContextLoading] = useState(false)
  const [contextExpanded, setContextExpanded] = useState(false)
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [stage, setStage] = useState<Stage>('idle')
  const [currentSymbol, setCurrentSymbol] = useState<string | null>(null)
  const [analysisData, setAnalysisData] = useState<StockAnalysisData | null>(null)
  const [showDashboard, setShowDashboard] = useState(false)
  const [activeCitation, setActiveCitation] = useState<CitationData | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const [recent, setRecent] = useState<string[]>([])
  const [liveStatus, setLiveStatus] = useState('')

  const hasPerMinuteNotice = messages.some((m) => m.notice?.kind === 'per_minute')
  const now = useNow(hasPerMinuteNotice)

  /** Both layouts are mounted; only the visible one may react to global keys / auto-ask. */
  const isVisible = useCallback(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia('(min-width: 768px)').matches === (variant === 'desktop')
  }, [variant])

  // ── Restore the open conversation after navigating away and back ──
  const sessionSaveRef = useRef({ messages, activeConversationId, input })
  useEffect(() => {
    sessionSaveRef.current = { messages, activeConversationId, input }
  }, [messages, activeConversationId, input])

  useEffect(() => {
    setRecent(readRecentTickers())
    try {
      const saved = window.localStorage.getItem(HISTORY_OPEN_KEY)
      // Desktop: history open by default on wide screens; mobile: always closed.
      if (variant === 'desktop') setShowHistory(saved ? saved === '1' : window.innerWidth >= 1280)
    } catch {
      /* storage blocked */
    }
    let raw: string | null = null
    try {
      raw = sessionStorage.getItem(SESSION_KEY)
    } catch {
      raw = null
    }
    if (!raw || !isVisible()) return
    try {
      sessionStorage.removeItem(SESSION_KEY)
      const saved = JSON.parse(raw) as { messages?: Msg[]; conversationId?: string | null; input?: string }
      if (saved.messages?.length) {
        setMessages(saved.messages.map((m) => ({ ...m, timestamp: new Date(m.timestamp), streaming: false })))
      }
      if (saved.conversationId) setActiveConversationId(saved.conversationId)
      if (saved.input) setInput(saved.input)
    } catch {
      /* corrupted session */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    return () => {
      if (!isVisible()) return
      const { messages: m, activeConversationId: cid, input: inp } = sessionSaveRef.current
      if (!m.length && !cid && !inp) return
      try {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify({ messages: m.filter((x) => !x.streaming), conversationId: cid, input: inp }))
      } catch {
        /* storage full */
      }
    }
  }, [isVisible])

  const toggleHistory = (open?: boolean) => {
    setShowHistory((prev) => {
      const next = open ?? !prev
      if (variant === 'desktop') {
        try {
          window.localStorage.setItem(HISTORY_OPEN_KEY, next ? '1' : '0')
        } catch {
          /* storage blocked */
        }
      }
      return next
    })
  }

  // ── Usage: the binding limit of requests vs token budget ──
  const meQuery = useQuery({ queryKey: ['me-ai-usage'], queryFn: getMyAiUsage, staleTime: 30_000, refetchInterval: 60_000 })
  const legacyQuery = useQuery({ queryKey: ['copilot-usage'], queryFn: getCopilotUsage, staleTime: 30_000, refetchInterval: 60_000 })
  const usage = useMemo(() => normalizeUsage(meQuery.data ?? null, legacyQuery.data ?? null), [meQuery.data, legacyQuery.data])
  const meter = useMemo(() => computeUsageMeter(usage), [usage])
  const usageFetchedAt = Math.max(meQuery.dataUpdatedAt || 0, legacyQuery.dataUpdatedAt || 0)
  const resetsAt = usage?.resetsInSeconds != null && usageFetchedAt ? usageFetchedAt + usage.resetsInSeconds * 1000 : null
  const resetsInSecondsNow = resetsAt != null ? Math.max(0, (resetsAt - now) / 1000) : usage?.resetsInSeconds ?? null
  const blocked = meter.state === 'exhausted' || meter.state === 'paused'
  const blockedReason = blocked
    ? `${meter.state === 'paused' ? 'AI answers are paused for today' : "You've used today's AI allowance"}. It ${formatResetsIn(resetsInSecondsNow)}. You can still type and send later.`
    : undefined
  const refreshUsage = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['me-ai-usage'] })
    queryClient.invalidateQueries({ queryKey: ['copilot-usage'] })
  }, [queryClient])

  // ── Personal starter prompts ──
  const watchlistQuery = useQuery({ queryKey: ['copilot-watchlist'], queryFn: getWatchlist, staleTime: 5 * 60_000 })
  const portfolioList = usePortfolioList(true)
  const firstPortfolioId = portfolioList.data?.portfolios?.find((p) => (p.holding_count ?? 0) > 0)?.id ?? null
  const portfolioDetail = usePortfolioDetail(firstPortfolioId)
  const holdings = useMemo(
    () => [...(portfolioDetail.data?.holdings ?? [])].sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0)).map((h) => h.symbol),
    [portfolioDetail.data],
  )
  const promptGroups = useMemo(
    () => buildStarterPrompts({
      contextSymbol: pinnedSymbol,
      watchlist: (watchlistQuery.data ?? []).map((w) => w.symbol),
      holdings,
      recent,
      perGroup: 2,
    }),
    [pinnedSymbol, watchlistQuery.data, holdings, recent],
  )
  const personalLoading = watchlistQuery.isLoading || portfolioList.isLoading

  // ── History ──
  const { data: conversations = [], isLoading: conversationsLoading } = useQuery({
    queryKey: ['copilot-conversations'],
    queryFn: listConversations,
    staleTime: 30_000,
    refetchInterval: 60_000,
  })

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => {
      const el = scrollRef.current
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: reduceMotion ? 'auto' : 'smooth' })
    })
  }, [reduceMotion])

  const loadConversation = useCallback(async (conversationId: string) => {
    const stored = await getConversationMessages(conversationId).catch(() => [])
    const loaded: Msg[] = stored.map((m) => ({
      id: `stored-${m.id}`,
      role: m.role,
      content: m.content,
      timestamp: new Date(m.created_at),
    }))
    setMessages(loaded)
    setActiveConversationId(conversationId)
    setActiveCitation(null)
    setShowDashboard(false)
    if (isMobile || window.innerWidth < 1024) setShowHistory(false)
    const lastData = [...stored].reverse().find((m) => m.payload_json && (m.payload_json as StockAnalysisData).symbol)
    setAnalysisData(lastData ? (lastData.payload_json as StockAnalysisData) : null)
    scrollToEnd()
  }, [isMobile, scrollToEnd])

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

  const patch = (id: string, fn: (m: Msg) => Msg) => setMessages((prev) => prev.map((m) => (m.id === id ? fn(m) : m)))

  // ── Send ──
  const sendMessage = useCallback(
    async (raw: string, opts?: { symbol?: string | null; replaceFrom?: string }) => {
      const text = raw.trim()
      if (!text || streaming) return
      const userMsg: Msg = { id: crypto.randomUUID(), role: 'user', content: text, timestamp: new Date() }
      const aid = crypto.randomUUID()
      const assistant: Msg = { id: aid, role: 'assistant', content: '', streaming: true, timestamp: new Date(), question: text }

      setMessages((prev) => {
        const base = opts?.replaceFrom ? prev.slice(0, Math.max(0, prev.findIndex((m) => m.id === opts.replaceFrom))) : prev
        return [...base, userMsg, assistant]
      })
      setInput('')
      setStreaming(true)
      setStage('intent')
      setActiveCitation(null)
      setLiveStatus('Copilot is answering.')
      scrollToEnd()

      abortRef.current = new AbortController()
      const focus = opts?.symbol ?? pinnedSymbol
      let failed = false

      try {
        await streamCopilotAnalysis(
          { message: text, symbol: focus, conversation_id: activeConversationId || undefined },
          {
            onIntent: (_intent, symbol) => {
              setCurrentSymbol(symbol)
              setStage('data')
              if (symbol) {
                rememberRecentTicker(symbol)
              }
            },
            onContext: (ctx) => {
              setTickerContext((prev) => (!focus || ctx.ticker === focus || !prev ? ctx : prev))
            },
            onStructuredData: (data: CopilotStructuredData) => {
              const d = data.stocks?.[0] ?? (data as StockAnalysisData)
              if (d.symbol) setAnalysisData(d)
            },
            onToolCall: () => setStage('data'),
            onToolResult: () => setStage('streaming'),
            onCitation: (c) => patch(aid, (m) => ({ ...m, citations: [...(m.citations ?? []).filter((x) => x.id !== c.id), c] })),
            onNoFilings: (sym) => patch(aid, (m) => ({ ...m, noFilings: (m.noFilings ?? []).includes(sym) ? m.noFilings : [...(m.noFilings ?? []), sym] })),
            onToken: (t) => {
              setStage('streaming')
              patch(aid, (m) => ({ ...m, content: m.content + t }))
            },
            onFinalText: (t) => patch(aid, (m) => ({ ...m, content: t })),
            onMeta: (meta) => {
              if (meta.conversation_id) setActiveConversationId(meta.conversation_id)
            },
            onHttpError: (status, detail, retryAfter) => {
              failed = true
              const notice = classifyCopilotError(status, detail, retryAfter)
              patch(aid, (m) => ({ ...m, streaming: false, notice, noticeAt: Date.now() }))
              // Keep the question so nothing is lost.
              setInput((cur) => (cur.trim() ? cur : text))
              setLiveStatus(`${notice.title}. ${notice.body}`)
              refreshUsage()
            },
            onError: (error) => {
              failed = true
              const notice: CopilotLimitNotice = { kind: 'other', title: 'Copilot could not finish this answer', body: error, retryAfterS: null }
              patch(aid, (m) => ({ ...m, streaming: false, notice: m.content ? null : notice, error: true, noticeAt: Date.now() }))
              setLiveStatus(notice.title)
            },
            onDone: (done) => {
              patch(aid, (m) => ({
                ...m,
                streaming: false,
                done: done ?? null,
                citations: done?.citations?.length ? done.citations : m.citations,
                tone: answerTone(text, done ?? null),
              }))
              if (!failed) {
                const n = done?.citations?.length ?? 0
                setLiveStatus(`Answer ready${n ? `, ${n} ${n === 1 ? 'source' : 'sources'} cited` : ''}.`)
              }
              queryClient.invalidateQueries({ queryKey: ['copilot-conversations'] })
              refreshUsage()
              setRecent(readRecentTickers())
            },
          },
          abortRef.current.signal,
        )
      } catch (err) {
        if ((err as Error)?.name !== 'AbortError') {
          const notice: CopilotLimitNotice = { kind: 'other', title: 'Connection lost', body: 'The answer stopped before it finished. Check your connection and ask again.', retryAfterS: null }
          patch(aid, (m) => ({ ...m, streaming: false, notice: m.content ? null : notice, noticeAt: Date.now() }))
          setLiveStatus(notice.title)
        }
      } finally {
        setStreaming(false)
        setStage('idle')
        if (isVisible() && !isMobile) inputRef.current?.focus()
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [streaming, activeConversationId, pinnedSymbol, queryClient, refreshUsage, scrollToEnd, isVisible, isMobile],
  )

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort()
    setStreaming(false)
    setStage('idle')
    setMessages((prev) => prev.map((m) => (m.streaming ? { ...m, streaming: false, content: m.content ? `${m.content}\n\n_Stopped._` : '_Stopped before the answer started._' } : m)))
    setLiveStatus('Answer stopped.')
  }, [])

  // ── Global keys: "/" focuses the composer, Esc stops a running answer ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isVisible()) return
      if (e.key === 'Escape' && streaming) {
        e.preventDefault()
        stopStreaming()
        return
      }
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable)) return
      e.preventDefault()
      e.stopImmediatePropagation() // the app header also binds "/" to its search
      inputRef.current?.focus()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [isVisible, streaming, stopStreaming])

  // ── Research handoff: ?symbol= (and optional ?q=) ──
  useEffect(() => {
    const { symbol, q } = parseCopilotParams(window.location.search)
    if (!symbol) return
    setPinnedSymbol(symbol)
    setContextLoading(true)
    fetchCopilotContext(symbol)
      .then((ctx) => {
        if (ctx) setTickerContext(ctx)
      })
      .finally(() => setContextLoading(false))
    if (q && isVisible() && !autoAskedRef.current) {
      autoAskedRef.current = true
      sendMessage(q, { symbol })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const clearPinnedSymbol = () => {
    setPinnedSymbol(null)
    setTickerContext(null)
    setContextExpanded(false)
    const url = new URL(window.location.href)
    url.searchParams.delete('symbol')
    url.searchParams.delete('q')
    window.history.replaceState(null, '', url.pathname + url.search)
  }

  const newChat = () => {
    if (streaming) stopStreaming()
    setMessages([])
    setAnalysisData(null)
    setShowDashboard(false)
    setActiveCitation(null)
    setActiveConversationId(null)
    if (isMobile) setShowHistory(false)
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  const cardSymbol = pinnedSymbol ?? tickerContext?.ticker ?? null
  const hasMessages = messages.length > 0
  const lastAssistantId = [...messages].reverse().find((m) => m.role === 'assistant')?.id
  const askedSet = new Set(messages.filter((m) => m.role === 'user').map((m) => m.content.toLowerCase()))
  const followUps = suggestedQuestions(tickerContext, currentSymbol ?? cardSymbol)
    .filter((q) => !askedSet.has(q.toLowerCase()))
    .slice(0, 3)

  const regenerate = (assistantId: string) => {
    const idx = messages.findIndex((m) => m.id === assistantId)
    const q = messages[idx]?.question ?? messages[idx - 1]?.content
    const userMsg = messages[idx - 1]
    if (!q || !userMsg) return
    sendMessage(q, { replaceFrom: userMsg.id })
  }

  const retryNotice = (assistantId: string) => {
    const idx = messages.findIndex((m) => m.id === assistantId)
    const userMsg = messages[idx - 1]
    if (!userMsg) return
    sendMessage(userMsg.content, { replaceFrom: userMsg.id })
  }

  const ask = (q: string) => {
    if (blocked) {
      setInput(q)
      inputRef.current?.focus()
      return
    }
    sendMessage(q)
  }

  const sidePanel = activeCitation ? 'source' : showDashboard && analysisData ? 'data' : null
  const panelMotion = reduceMotion
    ? { initial: false as const, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : { initial: { opacity: 0, x: 16 }, animate: { opacity: 1, x: 0 }, exit: { opacity: 0, x: 16 }, transition: { duration: 0.18 } }

  return (
    <div
      ref={rootRef}
      data-variant={variant}
      className={cn(
        'cp-scope relative flex h-full w-full min-w-0 overflow-hidden bg-[var(--cp-canvas)]',
        !isMobile && 'md:h-[calc(100vh-6.25rem-48px)] md:rounded-2xl md:border md:border-[var(--cp-line)]',
      )}
    >
      <div className="sr-only" role="status" aria-live="polite">{liveStatus}</div>

      {/* ─── History: column on desktop, sheet on mobile ─── */}
      {!isMobile && showHistory && (
        <aside className="hidden w-[272px] shrink-0 border-r border-[var(--cp-line)] md:block">
          <CopilotHistoryPanel
            conversations={conversations}
            activeId={activeConversationId}
            loading={conversationsLoading}
            now={now}
            onSelect={loadConversation}
            onDelete={handleDeleteConversation}
            onNewChat={newChat}
            onClose={() => toggleHistory(false)}
          />
        </aside>
      )}
      <AnimatePresence>
        {isMobile && showHistory && (
          <motion.div
            key="history-sheet"
            className="fixed inset-0 z-[90] flex"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.15 }}
          >
            <div className="cp-scope h-full w-[86%] max-w-[340px] border-r border-[var(--cp-line)] pt-safe shadow-[var(--cp-shadow)]" role="dialog" aria-modal="true" aria-label="Conversation history">
              <CopilotHistoryPanel
                conversations={conversations}
                activeId={activeConversationId}
                loading={conversationsLoading}
                now={now}
                onSelect={loadConversation}
                onDelete={handleDeleteConversation}
                onNewChat={newChat}
                onClose={() => setShowHistory(false)}
              />
            </div>
            <button type="button" aria-label="Close history" className="flex-1 bg-black/50" onClick={() => setShowHistory(false)} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── Conversation column ─── */}
      <section className="flex min-w-0 flex-1 flex-col" aria-label="Copilot conversation">
        <header className="flex h-14 shrink-0 items-center gap-1 border-b border-[var(--cp-line)] bg-[var(--cp-panel)] px-2 sm:px-3">
          <button
            type="button"
            onClick={() => toggleHistory()}
            aria-expanded={showHistory}
            aria-label={showHistory ? 'Hide conversation history' : 'Show conversation history'}
            className={cn(
              'flex h-10 w-10 items-center justify-center rounded-lg text-[var(--cp-ink-2)] hover:bg-[var(--cp-sunken)] hover:text-[var(--cp-ink)]',
              showHistory && !isMobile && 'bg-[var(--cp-sunken)] text-[var(--cp-ink)]',
            )}
          >
            <History className="h-5 w-5" aria-hidden />
          </button>
          <h1 className="ml-1 text-[16px] font-semibold text-[var(--cp-ink)]">Copilot</h1>
          <div className="ml-auto flex items-center gap-1">
            <CopilotUsageMeter
              meter={meter}
              resetsAt={resetsAt}
              now={now}
              isPro={usage?.isPro}
              onUpgrade={() => router.push('/pricing')}
              compact={isMobile}
            />
            {analysisData && !isMobile && (
              <button
                type="button"
                onClick={() => { setActiveCitation(null); setShowDashboard((v) => !v) }}
                aria-pressed={showDashboard}
                className="hidden min-h-[36px] items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-[var(--cp-ink-2)] hover:bg-[var(--cp-sunken)] lg:inline-flex"
              >
                <BarChart3 className="h-4 w-4" aria-hidden /> {analysisData.symbol} model data
              </button>
            )}
            <button
              type="button"
              onClick={newChat}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-semibold text-[var(--cp-ink)] hover:bg-[var(--cp-sunken)]"
            >
              <Plus className="h-4 w-4" aria-hidden />
              <span className={cn(isMobile && 'sr-only')}>New chat</span>
            </button>
          </div>
        </header>

        <div ref={scrollRef} className="cp-scroll min-h-0 flex-1 overflow-y-auto [overflow-anchor:auto]">
          <div className={cn('mx-auto w-full max-w-[46rem] px-4', isMobile ? 'pb-6 pt-4' : 'pb-10 pt-6 sm:px-6')}>
            {!hasMessages ? (
              <div className="space-y-8">
                {cardSymbol && (
                  <TickerContextCard
                    symbol={cardSymbol}
                    ctx={tickerContext}
                    loading={contextLoading}
                    onClear={clearPinnedSymbol}
                    compact={isMobile}
                  />
                )}
                <CopilotEmptyState
                  groups={promptGroups}
                  onAsk={ask}
                  loadingPersonal={personalLoading && promptGroups.length < 2}
                  compact={isMobile || !!cardSymbol}
                />
              </div>
            ) : (
              <>
                {cardSymbol && (
                  <div className="sticky top-0 z-10 -mx-1 bg-[var(--cp-canvas)] px-1 pb-3 pt-0">
                    <TickerContextCard
                      symbol={cardSymbol}
                      ctx={tickerContext}
                      loading={contextLoading}
                      onClear={pinnedSymbol ? clearPinnedSymbol : undefined}
                      compact
                      variant="bar"
                      expanded={contextExpanded}
                      onToggle={() => setContextExpanded((v) => !v)}
                    />
                  </div>
                )}
                <div role="log" aria-live="polite" aria-relevant="additions" aria-label="Conversation" className="space-y-7">
                  {messages.map((m) =>
                    m.role === 'user' ? (
                      <UserQuestion key={m.id} text={m.content} />
                    ) : m.notice ? (
                      <LimitNoticeCard
                        key={m.id}
                        notice={m.notice}
                        now={now}
                        noticeAt={m.noticeAt ?? now}
                        resetsInSeconds={resetsInSecondsNow}
                        isPro={usage?.isPro}
                        onUpgrade={() => router.push('/pricing')}
                        onRetry={() => retryNotice(m.id)}
                      />
                    ) : (
                      <AssistantAnswer
                        key={m.id}
                        msg={m}
                        now={now}
                        statusText={statusFor(stage, currentSymbol)}
                        isLast={m.id === lastAssistantId}
                        followUps={followUps}
                        onCitationClick={(c) => { setShowDashboard(false); setActiveCitation(c) }}
                        onRegenerate={streaming ? undefined : () => regenerate(m.id)}
                        onAsk={ask}
                      />
                    ),
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        <div className={cn('shrink-0 border-t border-[var(--cp-line)] bg-[var(--cp-canvas)] px-3 pt-3', isMobile ? 'pb-2' : 'pb-4 sm:px-6')}>
          <div className="mx-auto w-full max-w-[46rem]">
            <CopilotComposer
              ref={inputRef}
              value={input}
              onChange={setInput}
              onSend={() => sendMessage(input)}
              onStop={stopStreaming}
              streaming={streaming}
              blocked={blocked}
              blockedReason={blockedReason}
              focusSymbol={pinnedSymbol}
              compact={isMobile}
            />
          </div>
        </div>
      </section>

      {/* ─── Side panel (lg+): source details or the model data ─── */}
      <AnimatePresence mode="wait" initial={false}>
        {sidePanel && !isMobile && (
          <motion.aside
            key={sidePanel}
            {...panelMotion}
            className="hidden w-[min(400px,36%)] shrink-0 border-l border-[var(--cp-line)] bg-[var(--cp-panel)] lg:flex lg:flex-col"
          >
            {sidePanel === 'source' && activeCitation ? (
              <CitationSourcePanel citation={activeCitation} onClose={() => setActiveCitation(null)} />
            ) : analysisData ? (
              <AnalysisDashboard data={analysisData} onClose={() => setShowDashboard(false)} />
            ) : null}
          </motion.aside>
        )}
      </AnimatePresence>

      {/* ─── Source sheet below lg ─── */}
      <AnimatePresence>
        {activeCitation && (
          <motion.div
            key="source-sheet"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.15 }}
            className="fixed inset-0 z-[95] flex flex-col justify-end bg-black/50 lg:hidden"
            onClick={() => setActiveCitation(null)}
          >
            <div
              className="cp-scope max-h-[78dvh] w-full overflow-hidden rounded-t-2xl border-t border-[var(--cp-line)] pb-safe"
              role="dialog"
              aria-modal="true"
              aria-label="Source details"
              onClick={(e) => e.stopPropagation()}
            >
              <CitationSourcePanel citation={activeCitation} onClose={() => setActiveCitation(null)} />
            </div>
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
        <div className="cp-scope flex min-h-[70vh] items-center justify-center px-4">
          <div className="w-full max-w-md rounded-2xl border border-[var(--cp-line)] bg-[var(--cp-panel)] p-8 shadow-[var(--cp-shadow)]">
            <h2 className="cp-serif text-[1.75rem] font-semibold leading-tight text-[var(--cp-ink)]">Ask about any US stock.</h2>
            <p className="mt-3 text-[15px] leading-relaxed text-[var(--cp-ink-2)]">
              Copilot answers questions about US stocks and cites its sources: filings, financial statements, quotes and news, each with a date.
              Forecasts are experimental, and nothing here is financial advice.
            </p>
            <a
              href="/auth"
              className="mt-6 inline-flex min-h-[44px] items-center justify-center rounded-xl bg-[var(--cp-accent)] px-6 text-[15px] font-semibold text-[var(--cp-on-accent)] hover:bg-[var(--cp-accent-hover)]"
            >
              Sign in to ask a question
            </a>
          </div>
        </div>
      </AppLayout>
    )
  }
  return (
    <>
      <div className="hidden md:block">
        <AppLayout hideFooter>
          <CopilotInner variant="desktop" />
        </AppLayout>
      </div>
      <div className="cp-scope flex h-[100dvh] flex-col overflow-hidden bg-[var(--cp-canvas)] md:hidden">
        <div className="flex flex-1 flex-col overflow-hidden bg-[var(--cp-canvas)] pt-safe">
          <CopilotInner variant="mobile" />
        </div>
        <div className="h-[80px] shrink-0 bg-[var(--cp-canvas)] pb-safe" />
        <BottomNav />
      </div>
    </>
  )
}

/**
 * QuantTrade AI Copilot Engine
 *
 * Full-pipeline client that connects to the backend SSE streaming endpoint.
 * Handles: intent detection → structured data → LLM token streaming → meta
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CopilotQuote {
  price: number | null
  change: number | null
  change_percent: number | null
  volume: number | null
  high: number | null
  low: number | null
  open: number | null
  previous_close: number | null
  data_source?: string
}

export interface CopilotIndicators {
  rsi?: number
  sma_50?: number
  sma_200?: number
  current_price?: number
  macd?: { macd?: number; signal?: number; histogram?: number }
  bollinger_bands?: { upper?: number; lower?: number; middle?: number }
  [key: string]: unknown
}

export interface CopilotFundamentals {
  market_cap?: number
  pe_ratio?: number
  forward_pe?: number
  peg_ratio?: number
  price_to_book?: number
  eps?: number
  beta?: number
  rsi?: number
  dividend_yield?: number
  week_52_high?: number
  week_52_low?: number
  profit_margin?: number
  operating_margin?: number
  roe?: number
  roa?: number
  debt_to_equity?: number
  current_ratio?: number
  target_price?: number
  recommendation?: string
  earnings_date?: string
  revenue?: number
  volume?: number
  avg_volume?: number
}

export interface TechnicalSignal {
  trend: 'bullish' | 'bearish' | 'neutral'
  confidence: number
  bullish_pct?: number
  signals: Array<{ name: string; signal: string; weight: number }>
}

export interface RegimePrediction {
  regime: string
  confidence: number
  probabilities: Record<string, number>
}

export interface ConfidenceScore {
  overall: number
  components: Record<string, number>
  grade: string
  label: string
}

export interface TimeHorizon {
  horizon: string
  direction: string
  confidence: number
}

export interface SentimentData {
  overall: string
  score: number
  analyst_recommendation?: string
  target_price?: number
  target_upside?: number
}

export interface RiskData {
  score?: number
  level?: string
  factors?: Record<string, number>
  enhanced?: {
    sharpe_ratio: number
    annualized_volatility: number
    var_95: number
    beta: number
    max_drawdown_pct: number
  }
}

interface MCForecast {
  median?: number
  mean?: number
  p10?: number
  p25?: number
  p75?: number
  p90?: number
  prob_above_current?: number
  expected_price?: number
  expected_return_pct?: number
  percentiles?: {
    p5?: number
    p10?: number
    p25?: number
    p50?: number
    p75?: number
    p90?: number
    p95?: number
  }
  probabilities?: {
    price_up?: number
    price_down?: number
    gain_5pct?: number
    gain_10pct?: number
    gain_20pct?: number
    loss_5pct?: number
    loss_10pct?: number
    loss_20pct?: number
  }
  confidence_intervals?: {
    [key: string]: { lower: number; upper: number }
  }
}

export interface MonteCarloData {
  forecast_30d?: MCForecast
  forecast_90d?: MCForecast
}

export interface CompanyData {
  name?: string
  sector?: string
  industry?: string
  market_cap?: number
}

export interface StockAnalysisData {
  symbol: string
  quote?: CopilotQuote
  company?: CompanyData
  indicators?: CopilotIndicators
  fundamentals?: CopilotFundamentals
  technical_signal?: TechnicalSignal
  regime?: RegimePrediction
  sentiment?: SentimentData
  risk?: RiskData
  monte_carlo?: MonteCarloData
  confidence?: ConfidenceScore
  time_horizons?: {
    short_term: TimeHorizon
    medium_term: TimeHorizon
    long_term: TimeHorizon
  }
  prediction?: { summary: string }
}

export type CopilotIntent = 'stock_analysis' | 'comparison' | 'screener' | 'sector' | 'text'

export interface CopilotStructuredData extends StockAnalysisData {
  // Comparison intent
  stocks?: StockAnalysisData[]
  // Screener intent
  gainers?: unknown[]
  losers?: unknown[]
  // Sector intent
  sectors?: unknown[]
}

export interface CopilotMeta {
  request_id: string
  conversation_id: string
  message_id?: number
  sources: string[]
  intent: CopilotIntent
  symbol?: string
  model?: string
  noFilings?: string[]
}

// ─── Citation ───────────────────────────────────────────────────────────────

/** A cited fact. `id` is what the answer cites as `[id]` (quote:AAPL, fs:AAPL:2026-Q3,
 *  news:123, filing:abc…, fc:AAPL, macro:FED_RATE …); `n` is display order. */
export interface CitationData {
  id: string
  n: number
  kind: 'quote' | 'fundamentals' | 'statement' | 'forecast' | 'technicals' | 'news' | 'filing' | 'macro' | 'movers' | string
  source: string
  label: string
  as_of?: string | null
  ticker?: string | null
  // filing
  filing_type?: string
  fiscal_year?: number
  section?: string
  /** statement period label, e.g. "Q3 FY2026" */
  period?: string
  filed_date?: string
  accession?: string
  url?: string | null
  snippet?: string
  score?: number
  // news
  title?: string
  publisher?: string
  published_at?: string
  sentiment?: string | null
  category?: string | null
  suspicious?: boolean
  /** legacy alias of n */
  source_n?: number
}

// ─── Ticker context (SSE `context` event / GET /copilot/context/{symbol}) ────

export interface TickerContextQuote {
  id: string
  price: number | null
  change: number | null
  change_percent: number | null
  as_of?: string | null
  source: string
  market_session?: string | null
}

export interface TickerContextNews {
  id: string
  title: string
  publisher?: string | null
  url?: string | null
  published_at?: string | null
  sentiment?: string | null
  category?: string | null
  suspicious?: boolean
}

export interface TickerContext {
  ticker: string
  name?: string | null
  asset_type: string
  identity: { status: 'ok' | 'mismatch' | 'changed' | 'unknown'; note?: string | null; successor_symbol?: string | null }
  built_at?: string
  quote: TickerContextQuote | null
  key_stats: Record<string, number | string | null>
  key_stats_id?: string | null
  forecast: { id: string; as_of?: string | null; horizon_days: number; p10: number | null; p50: number | null; p90: number | null; prob_up_pct?: number | null } | null
  latest_statement: { id: string; period_label: string; form?: string | null; revenue?: number | null; net_income?: number | null; gross_margin_pct?: number | null; revenue_yoy_pct?: number | null; filed?: string | null } | null
  news: TickerContextNews[]
  filings: CitationData[]
  errors: Record<string, string>
  timings_ms?: Record<string, number>
  cached?: boolean
}

export interface CopilotToolEvent {
  id?: string
  name: string
  args: Record<string, unknown>
  status: 'running' | 'done' | 'error'
  facts?: number
  error?: string | null
}

export interface CopilotDone {
  request_id: string
  conversation_id: string
  model?: string | null
  provider?: string | null
  final_text?: string | null
  refusal?: string | null
  citations: CitationData[]
  latency_ms?: Record<string, number>
  postcheck?: { unverified_numbers?: string[]; invalid_citations?: string[]; policy_flags?: string[] } | null
}

// ─── SSE Event Handlers ─────────────────────────────────────────────────────

export interface CopilotStreamCallbacks {
  onIntent?: (intent: CopilotIntent, symbol: string | null, symbols: string[]) => void
  onContext?: (ctx: TickerContext) => void
  onStructuredData?: (data: CopilotStructuredData) => void
  onToken?: (text: string) => void
  onMeta?: (meta: CopilotMeta) => void
  onError?: (error: string) => void
  onDone?: (done?: CopilotDone) => void
  onFinalText?: (text: string) => void
  onCitation?: (citation: CitationData) => void
  onTool?: (tool: CopilotToolEvent) => void
  onToolCall?: (message: string) => void
  onToolResult?: (message: string) => void
  onNoFilings?: (symbol: string) => void
}

export interface CopilotStreamRequest {
  message: string
  symbol?: string | null
  conversation_id?: string
}

// ─── Stream Client ──────────────────────────────────────────────────────────

/** Human-readable message for a failed copilot request (quota / budget aware). */
export async function copilotErrorMessage(response: Response): Promise<string> {
  const text = await response.text().catch(() => '')
  let detail = ''
  try {
    const parsed = JSON.parse(text) as { detail?: unknown; error?: unknown }
    if (typeof parsed.detail === 'string') detail = parsed.detail
    else if (typeof parsed.error === 'string') detail = parsed.error
  } catch {
    detail = text
  }
  if (response.status === 401) return detail || 'Sign in to use the AI copilot.'
  if (response.status === 403 || response.status === 413 || response.status === 429 || response.status === 503) {
    return detail || 'AI is temporarily unavailable. Please try again later.'
  }
  return `API error: ${response.status}${detail ? ` — ${detail}` : ''}`
}

export async function streamCopilotAnalysis(
  request: CopilotStreamRequest,
  callbacks: CopilotStreamCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  // Auth is handled via httpOnly cookie (qt_access_token), sent automatically with credentials: 'include'
  const response = await fetch('/api/copilot/stream', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: request.message,
      symbol: request.symbol || null,
      conversation_id: request.conversation_id || null,
    }),
    signal,
  })

  if (!response.ok) {
    callbacks.onError?.(await copilotErrorMessage(response))
    callbacks.onDone?.()
    return
  }

  if (!response.body) {
    callbacks.onError?.('No response body')
    callbacks.onDone?.()
    return
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let detectedIntent: CopilotIntent = 'text'
  let doneCalled = false
  // Outside the read loop: an `event:` line and its `data:` line can arrive in
  // different network chunks.
  let currentEvent = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      if (line.startsWith('event: ')) {
        currentEvent = line.slice(7).trim()
      } else if (line.startsWith('data: ')) {
        const rawData = line.slice(6)
        try {
          const data = JSON.parse(rawData)

          switch (currentEvent) {
            case 'intent':
              detectedIntent = data.intent as CopilotIntent
              callbacks.onIntent?.(
                data.intent as CopilotIntent,
                data.symbol,
                data.symbols || [],
              )
              break

            case 'context':
              callbacks.onContext?.(data as TickerContext)
              break

            case 'tool': {
              const t = data as CopilotToolEvent
              callbacks.onTool?.(t)
              if (t.status === 'running') callbacks.onToolCall?.(t.name)
              else callbacks.onToolResult?.(t.name)
              break
            }

            case 'structured_data':
              callbacks.onStructuredData?.(data as CopilotStructuredData)
              break

            case 'tool_call':
              callbacks.onToolCall?.(data.message || '')
              break

            case 'tool_result':
              callbacks.onToolResult?.(data.message || '')
              break

            case 'no_filings':
              callbacks.onNoFilings?.(data.symbol as string)
              break

            case 'citation':
              callbacks.onCitation?.({ ...(data as CitationData), source_n: (data as CitationData).n })
              break

            case 'token':
              callbacks.onToken?.(data.text || '')
              break

            case 'meta':
              callbacks.onMeta?.(data as CopilotMeta)
              break

            case 'error':
              callbacks.onError?.(data.message || 'Unknown error')
              break

            case 'done': {
              const done = data as CopilotDone
              if (done.final_text) callbacks.onFinalText?.(done.final_text)
              callbacks.onMeta?.({
                request_id: done.request_id || '',
                conversation_id: done.conversation_id || '',
                sources: (done.citations || []).map((c) => c.label),
                intent: detectedIntent,
                model: done.model || undefined,
              })
              callbacks.onDone?.(done)
              doneCalled = true
              break
            }
          }
        } catch {
          // Non-JSON data line, skip
        }
        currentEvent = ''
      }
    }
  }

  // Ensure done is called if stream ends without explicit done event
  if (!doneCalled) callbacks.onDone?.()
}

// ─── Quick Prompts ──────────────────────────────────────────────────────────

export const COPILOT_QUICK_PROMPTS = [
  {
    label: 'Deep Dive: NVDA',
    prompt: 'Analyze NVDA stock — full technical, fundamental, and quantitative analysis with predictions.',
    icon: 'chart' as const,
  },
  {
    label: 'Compare: AAPL vs MSFT',
    prompt: 'Compare AAPL vs MSFT — side by side analysis including valuations, growth, technicals, and recommendation.',
    icon: 'compare' as const,
  },
  {
    label: 'Sector Rotation',
    prompt: 'What are the current sector rotation trends? Which sectors are gaining momentum and why?',
    icon: 'sectors' as const,
  },
  {
    label: 'Market Movers',
    prompt: 'Show me today\'s top gainers and losers with analysis of why they are moving.',
    icon: 'movers' as const,
  },
  {
    label: 'Fed & Macro Impact',
    prompt: 'How do current Fed rate expectations and macro conditions impact equity valuations? What sectors benefit?',
    icon: 'macro' as const,
  },
  {
    label: 'Risk Assessment: TSLA',
    prompt: 'Give me a comprehensive risk assessment of TSLA including VaR, volatility analysis, and downside scenarios.',
    icon: 'risk' as const,
  },
]

// ─── Formatting Helpers ─────────────────────────────────────────────────────

export function formatLargeNumber(num: number | null | undefined): string {
  if (num == null) return 'N/A'
  if (num >= 1e12) return `$${(num / 1e12).toFixed(2)}T`
  if (num >= 1e9) return `$${(num / 1e9).toFixed(2)}B`
  if (num >= 1e6) return `$${(num / 1e6).toFixed(2)}M`
  if (num >= 1e3) return `$${(num / 1e3).toFixed(1)}K`
  return `$${num.toFixed(2)}`
}

export function formatPercent(num: number | null | undefined): string {
  if (num == null) return 'N/A'
  return `${num >= 0 ? '+' : ''}${num.toFixed(2)}%`
}

export function formatPrice(num: number | null | undefined): string {
  if (num == null) return 'N/A'
  return `$${num.toFixed(2)}`
}

export function confidenceColor(score: number): string {
  if (score >= 80) return 'text-emerald-400'
  if (score >= 60) return 'text-cyan-400'
  if (score >= 40) return 'text-amber-400'
  return 'text-red-400'
}

export function trendColor(trend: string): string {
  const t = trend.toLowerCase()
  if (t === 'bullish' || t === 'positive' || t === 'up') return 'text-emerald-400'
  if (t === 'bearish' || t === 'negative' || t === 'down') return 'text-red-400'
  return 'text-slate-400'
}

export function trendBg(trend: string): string {
  const t = trend.toLowerCase()
  if (t === 'bullish' || t === 'positive' || t === 'up') return 'bg-emerald-500/10 border-emerald-500/20'
  if (t === 'bearish' || t === 'negative' || t === 'down') return 'bg-red-500/10 border-red-500/20'
  return 'bg-slate-500/10 border-slate-500/20'
}

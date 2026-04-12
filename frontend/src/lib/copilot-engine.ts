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
}

// ─── SSE Event Handlers ─────────────────────────────────────────────────────

export interface CopilotStreamCallbacks {
  onIntent?: (intent: CopilotIntent, symbol: string | null, symbols: string[]) => void
  onStructuredData?: (data: CopilotStructuredData) => void
  onToken?: (text: string) => void
  onMeta?: (meta: CopilotMeta) => void
  onError?: (error: string) => void
  onDone?: () => void
}

export interface CopilotStreamRequest {
  message: string
  symbol?: string
  conversation_id?: string
  include_news?: boolean
  include_filings?: boolean
  top_k?: number
}

// ─── Stream Client ──────────────────────────────────────────────────────────

export async function streamCopilotAnalysis(
  request: CopilotStreamRequest,
  callbacks: CopilotStreamCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  // Get auth token from localStorage
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null

  const response = await fetch('/api/copilot/stream', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      message: request.message,
      symbol: request.symbol || null,
      conversation_id: request.conversation_id || null,
      include_news: request.include_news ?? true,
      include_filings: request.include_filings ?? true,
      top_k: request.top_k ?? 5,
    }),
    signal,
  })

  if (!response.ok) {
    const errText = await response.text().catch(() => response.statusText)
    callbacks.onError?.(`API error: ${response.status} — ${errText}`)
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

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    let currentEvent = ''

    for (const line of lines) {
      if (line.startsWith('event: ')) {
        currentEvent = line.slice(7).trim()
      } else if (line.startsWith('data: ')) {
        const rawData = line.slice(6)
        try {
          const data = JSON.parse(rawData)

          switch (currentEvent) {
            case 'intent':
              callbacks.onIntent?.(
                data.intent as CopilotIntent,
                data.symbol,
                data.symbols || [],
              )
              break

            case 'structured_data':
              callbacks.onStructuredData?.(data as CopilotStructuredData)
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

            case 'done':
              callbacks.onDone?.()
              break
          }
        } catch {
          // Non-JSON data line, skip
        }
        currentEvent = ''
      }
    }
  }

  // Ensure done is called if stream ends without explicit done event
  callbacks.onDone?.()
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

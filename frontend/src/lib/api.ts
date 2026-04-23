/**
 * API client for backend communication
 */

// getToken no longer needed — auth is handled via httpOnly cookies
// import { getToken } from '@/lib/auth'
import {
  CONTINENT_NEWS_TICKERS,
  getExchangeById,
  type Continent,
} from '@/lib/world-exchanges'

const API_URL = process.env.NEXT_PUBLIC_API_URL || ''

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

async function parseJsonSafe<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T
  } catch {
    return null
  }
}

/** Abort fetch after `timeoutMs` so slow backend RSS jobs cannot hang the UI forever */
async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  init?: RequestInit
): Promise<Response> {
  const controller = new AbortController()
  const t = setTimeout(
    () => controller.abort(new DOMException('Request timed out', 'TimeoutError')),
    timeoutMs
  )
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch (err) {
    // Re-throw non-abort errors; swallow expected timeout aborts by returning a synthetic 408
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      return new Response(null, { status: 408, statusText: 'Request Timeout' })
    }
    throw err
  } finally {
    clearTimeout(t)
  }
}

function normalizeQuoteData(data: Record<string, unknown>, symbol: string): QuoteData {
  return {
    symbol: (data.symbol as string) || symbol.toUpperCase(),
    price: (data.last_price as number) || (data.price as number) || (data.current_price as number) || 0,
    change: (data.change as number) || 0,
    change_percent: (data.change_percent as number) || 0,
    volume: (data.volume as number) || 0,
    high: (data.high_price as number) || (data.high as number) || 0,
    low: (data.low_price as number) || (data.low as number) || 0,
    open: (data.open_price as number) || (data.open as number) || 0,
    previous_close: (data.previous_close as number) || 0,
    timestamp: (data.quote_timestamp as string) || (data.updated_at as string) || (data.timestamp as string) || new Date().toISOString(),
    bid_price: data.bid_price as number | undefined,
    ask_price: data.ask_price as number | undefined,
    market_status: data.market_status as string | undefined,
    data_source: data.data_source as string | undefined,
    latency_ms: data.latency_ms as number | undefined,
  }
}

export interface Symbol {
  id: number
  symbol: string
  name: string | null
  sector: string | null
  industry: string | null
  market_cap: number | null
}

// Rich search result from universal search endpoint
export interface SearchResult {
  symbol: string
  name: string | null
  exchange: string | null
  asset_type: string | null
  currency: string | null
  country: string | null
  sector: string | null
  market_cap: number | null
  match_type: 'exact' | 'prefix' | 'contains'
}

export interface PriceBar {
  timestamp: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface Indicators {
  symbol: string
  indicators: {
    current_price?: number
    sma_20?: number
    sma_50?: number
    sma_200?: number
    rsi?: number
    macd?: {
      macd: number | null
      signal: number | null
      histogram: number | null
    }
    bollinger_bands?: {
      upper: number | null
      middle: number | null
      lower: number | null
    }
  }
}

export async function fetchSymbols(search?: string): Promise<Symbol[]> {
  const url = new URL(`${API_URL}/api/v1/symbols`)
  if (search) {
    url.searchParams.append('search', search)
  }
  const response = await fetch(url.toString())
  if (!response.ok) {
    throw new Error('Failed to fetch symbols')
  }
  return response.json()
}

/**
 * Universal symbol search with ranked results
 * Returns symbols matching by ticker, company name, with ranking:
 * 1. Exact symbol match
 * 2. Symbol prefix match  
 * 3. Name prefix match
 * 4. Contains match
 */
export async function searchSymbols(
  query: string,
  limit: number = 10
): Promise<SearchResult[]> {
  if (!query.trim()) return []
  
  const url = new URL(`${API_URL}/api/v1/symbols/search`)
  url.searchParams.append('q', query.trim())
  url.searchParams.append('limit', limit.toString())
  
  const response = await fetch(url.toString())
  if (!response.ok) {
    throw new Error('Failed to search symbols')
  }
  return response.json()
}

export async function fetchPrices(
  symbol: string,
  start?: string,
  end?: string,
  limit: number = 500
): Promise<PriceBar[]> {
  const url = new URL(`${API_URL}/api/v1/prices/${symbol}`)
  
  // If no date range provided, default to last 3 months for chart display
  if (!start && !end) {
    const endDate = new Date()
    const startDate = new Date()
    startDate.setMonth(startDate.getMonth() - 3)
    start = startDate.toISOString()
    end = endDate.toISOString()
  }
  
  if (start) url.searchParams.append('start', start)
  if (end) url.searchParams.append('end', end)
  url.searchParams.append('limit', limit.toString())
  url.searchParams.append('auto_sync', 'true') // Ensure auto-sync is enabled
  
  try {
    const response = await fetch(url.toString())
    if (!response.ok) {
      throw new Error(`Failed to fetch prices: ${response.status}`)
    }
    const data = await response.json()
    return Array.isArray(data) ? data : []
  } catch (error) {
    console.error('Error fetching prices:', error)
    // Return empty array instead of throwing - let component handle it
    return []
  }
}

export async function fetchIndicators(symbol: string): Promise<Indicators> {
  const response = await fetch(`${API_URL}/api/v1/indicators/${symbol}`)
  if (!response.ok) {
    throw new Error('Failed to fetch indicators')
  }
  return response.json()
}

export async function syncSymbol(symbol: string): Promise<any> {
  const response = await fetch(`${API_URL}/api/v1/symbols/${symbol}/sync`, {
    method: 'POST',
  })
  if (!response.ok) {
    throw new Error('Failed to sync symbol')
  }
  return response.json()
}

// Phase 2: News & Filings
export interface NewsArticle {
  id: number
  title: string
  content: string | null
  source: string | null
  url: string | null
  published_at: string
  sentiment: string | null
  thumbnail?: string | null
  related_tickers?: string[]
}

// Real-time news from enhanced endpoint
export async function fetchRealtimeNews(
  symbol: string,
  limit: number = 20,
  sources?: string
): Promise<NewsArticle[]> {
  try {
    const url = new URL(`${API_URL}/api/v1/enhanced/news/${symbol}/realtime`)
    url.searchParams.append('limit', limit.toString())
    if (sources) {
      url.searchParams.append('sources', sources)
    }
    
    const response = await fetch(url.toString())
    const data = await parseJsonSafe<NewsArticle[]>(response)
    if (data) return data
    if (!response.ok) {
      throw new Error('Failed to fetch real-time news')
    }
    return []
  } catch (error) {
    console.error('Error fetching real-time news:', error)
    return []
  }
}

// yfinance news only (fastest)
export async function fetchYFinanceNews(
  symbol: string,
  limit: number = 20
): Promise<NewsArticle[]> {
  try {
    const url = new URL(`${API_URL}/api/v1/enhanced/news/${symbol}/yfinance`)
    url.searchParams.append('limit', limit.toString())
    
    const response = await fetchWithTimeout(url.toString(), 12_000)
    const data = await parseJsonSafe<NewsArticle[]>(response)
    if (data) return data
    if (!response.ok) {
      throw new Error('Failed to fetch yfinance news')
    }
    return []
  } catch (error) {
    console.error('Error fetching yfinance news:', error)
    return []
  }
}

// Breaking market news (can be slow: RSS + parallel fetches on server)
export async function fetchBreakingMarketNews(
  limit: number = 10
): Promise<NewsArticle[]> {
  try {
    const url = new URL(`${API_URL}/api/v1/enhanced/news/market/breaking`)
    url.searchParams.append('limit', limit.toString())
    
    const response = await fetchWithTimeout(url.toString(), 14_000)
    const data = await parseJsonSafe<NewsArticle[]>(response)
    if (Array.isArray(data)) return data
    if (!response.ok) {
      throw new Error('Failed to fetch breaking news')
    }
    return []
  } catch (error) {
    console.error('Error fetching breaking news:', error)
    return []
  }
}

export type LiveHeadlinesContext = {
  continent?: Continent
  exchangeId?: string | null
}

/**
 * Headlines for the dashboard: breaking feed and regional / exchange ETF & index news,
 * merged with breaking first so the tape stays full even if one source is slow.
 */
export async function fetchLiveMarketHeadlines(
  limit: number = 10,
  context?: LiveHeadlinesContext
): Promise<NewsArticle[]> {
  let tickers: string[] = ['SPY', 'QQQ', 'IWM']
  if (context?.exchangeId) {
    const ex = getExchangeById(context.exchangeId)
    if (ex) {
      const fromEx = [ex.mainIndex, ...ex.indices.map((i) => i.symbol)].filter(Boolean)
      tickers = Array.from(new Set(fromEx)).slice(0, 6)
    }
  } else if (context?.continent && context.continent !== 'global') {
    tickers = [...(CONTINENT_NEWS_TICKERS[context.continent] ?? CONTINENT_NEWS_TICKERS.global)]
  }

  const perTicker = Math.max(10, Math.ceil(limit * 0.6))
  const [primary, ...regionalBatches] = await Promise.all([
    fetchBreakingMarketNews(limit),
    ...tickers.slice(0, 5).map((t) => fetchYFinanceNews(t, perTicker)),
  ])

  const seen = new Set<string>()
  const out: NewsArticle[] = []

  const pushUnique = (articles: NewsArticle[]) => {
    for (const a of articles) {
      const key = `${a.url ?? ''}|${(a.title ?? '').slice(0, 200)}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(a)
      if (out.length >= limit) return
    }
  }

  pushUnique(primary)
  for (const batch of regionalBatches) {
    if (out.length >= limit) break
    pushUnique(batch)
  }
  return out
}

export interface PredictionAlert {
  symbol: string
  timeframe: string
  direction: string
  expected_return: number
  confidence: number
  severity: 'high' | 'medium' | 'low'
  message: string
  name?: string | null
}

export async function fetchPredictionAlerts(
  minConfidence: number = 0.65,
  minAbsReturn: number = 2.0
): Promise<PredictionAlert[]> {
  try {
    const url = new URL(`${API_URL}/api/v1/enhanced/alerts/predictions`)
    url.searchParams.append('min_confidence', String(minConfidence))
    url.searchParams.append('min_abs_return', String(minAbsReturn))
    const headers: HeadersInit = { Accept: 'application/json' }
    const response = await apiFetchWithTimeout(url.toString(), 25_000, { headers })
    const data = await parseJsonSafe<PredictionAlert[]>(response)
    if (data && Array.isArray(data)) return data
    return []
  } catch (error) {
    console.error('Error fetching prediction alerts:', error)
    return []
  }
}

// Legacy news endpoint (database)
export async function fetchNews(
  symbol: string,
  limit?: number,
  sentiment?: string
): Promise<NewsArticle[]> {
  const url = new URL(`${API_URL}/api/v1/news/${symbol}`)
  if (limit) url.searchParams.append('limit', limit.toString())
  if (sentiment) url.searchParams.append('sentiment', sentiment)
  
  const response = await fetch(url.toString())
  if (!response.ok) {
    throw new Error('Failed to fetch news')
  }
  return response.json()
}

export async function syncNews(symbol: string): Promise<any> {
  const response = await fetch(`${API_URL}/api/v1/news/${symbol}/sync`, {
    method: 'POST',
  })
  if (!response.ok) {
    throw new Error('Failed to sync news')
  }
  return response.json()
}

// Phase 2: Chat
export interface ChatMessage {
  message: string
  symbol?: string
  include_news?: boolean
  include_filings?: boolean
  top_k?: number
  session_id?: string
  conversation_id?: string
}

export interface ResponseMeta {
  symbol?: string
  as_of?: string
  ttl_expires_at?: string
  data_freshness?: {
    quote?: string
    technicals?: string
    news?: string
    fundamentals?: string
  }
}

export interface ChatResponse {
  version?: string
  request_id?: string
  conversation_id?: string
  message_id?: number
  intent?: string
  response: string
  sources: string[]
  context_docs: number
  symbol?: string
  session_id?: string
  analysis_summary?: string
  response_type?: string
  structured_data?: Record<string, any>
  meta?: ResponseMeta
}

export interface ConversationSummary {
  id: string
  title: string | null
  created_at: string
  updated_at: string
  message_count: number
  last_message: string | null
}

export interface StoredMessage {
  id: number
  role: 'user' | 'assistant'
  content: string
  symbol?: string
  intent_type?: string
  payload_json?: Record<string, any>
  as_of?: string
  ttl_expires_at?: string
  created_at: string
}

async function getAuthHeadersClient(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (typeof window !== 'undefined') {
    const { getAuthHeaders } = await import('./auth')
    Object.assign(headers, getAuthHeaders())
  }
  return headers
}

/**
 * Wrapper around fetch that always sends credentials (httpOnly cookies).
 * Use this for any endpoint that may need authentication.
 */
async function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, { ...init, credentials: 'include' })
}

/** Like fetchWithTimeout but always includes credentials */
async function apiFetchWithTimeout(
  url: string,
  timeoutMs: number,
  init?: RequestInit
): Promise<Response> {
  return fetchWithTimeout(url, timeoutMs, { ...init, credentials: 'include' })
}

export async function sendChatMessage(message: ChatMessage): Promise<ChatResponse> {
  const headers = await getAuthHeadersClient()
  const response = await apiFetch(`${API_URL}/api/v1/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify(message),
  })
  if (!response.ok) {
    if (response.status === 401) throw new Error('AUTH_REQUIRED')
    throw new Error('Failed to send chat message')
  }
  return response.json()
}

export async function listConversations(): Promise<ConversationSummary[]> {
  const headers = await getAuthHeadersClient()
  const response = await apiFetch(`${API_URL}/api/v1/conversations?limit=30`, { headers })
  if (!response.ok) return []
  return response.json()
}

export async function createConversation(title?: string): Promise<ConversationSummary> {
  const headers = await getAuthHeadersClient()
  const response = await apiFetch(`${API_URL}/api/v1/conversations`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ title }),
  })
  if (!response.ok) throw new Error('Failed to create conversation')
  return response.json()
}

export async function getConversationMessages(conversationId: string): Promise<StoredMessage[]> {
  const headers = await getAuthHeadersClient()
  const response = await apiFetch(`${API_URL}/api/v1/conversations/${conversationId}/messages`, { headers })
  if (!response.ok) return []
  return response.json()
}

export async function deleteConversation(conversationId: string): Promise<void> {
  const headers = await getAuthHeadersClient()
  await apiFetch(`${API_URL}/api/v1/conversations/${conversationId}`, {
    method: 'DELETE',
    headers,
  })
}

export async function refreshChatMessage(
  conversationId: string,
  messageId: number,
  refreshParts?: string[]
): Promise<{ payload_json: Record<string, any>; as_of: string; ttl_expires_at: string; refreshed_parts: string[] }> {
  const headers = await getAuthHeadersClient()
  const response = await apiFetch(`${API_URL}/api/v1/chat/refresh`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      conversation_id: conversationId,
      message_id: messageId,
      refresh_parts: refreshParts,
    }),
  })
  if (!response.ok) throw new Error('Refresh failed')
  return response.json()
}

// Phase 3: Risk & Watchlist
export interface RiskMetrics {
  symbol: string
  risk_score: number
  risk_level: string
  factors: {
    volatility: number
    max_drawdown: number
    beta: number
    rsi: number | null
  }
}

export async function fetchRiskMetrics(symbol: string): Promise<RiskMetrics> {
  const response = await fetch(`${API_URL}/api/v1/risk/${symbol}`)
  if (!response.ok) {
    throw new Error('Failed to fetch risk metrics')
  }
  return response.json()
}

// ========================================
// Watchlist API
// ========================================

export interface WatchlistItem {
  id: number
  symbol: string
  name: string | null
  source: string | null
  added_at: string
  updated_at: string | null
}

export interface AddWatchlistParams {
  symbol: string
  source?: string
}

export interface WatchlistError {
  detail: string
  code?: string
}

/**
 * Get user's watchlist items
 * @returns Array of watchlist items or empty array if not authenticated
 */
export async function getWatchlist(): Promise<WatchlistItem[]> {
  try {
    if (typeof window === 'undefined') {
      return []
    }

    const response = await apiFetch(`${API_URL}/api/v1/watchlist`)
    
    if (!response.ok) {
      if (response.status === 401) {
        return []
      }
      const error = await response.json().catch(() => ({ detail: 'Failed to fetch watchlist' }))
      throw new Error(error.detail)
    }
    return response.json()
  } catch (error) {
    console.error('Error fetching watchlist:', error)
    return []
  }
}

/**
 * Add a symbol to user's watchlist
 * @throws Error with message for UI display
 */
export async function addToWatchlist(params: AddWatchlistParams): Promise<WatchlistItem> {
  if (typeof window === 'undefined') {
    throw new Error('Client-side only')
  }

  const response = await apiFetch(`${API_URL}/api/v1/watchlist`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      symbol: params.symbol.trim().toUpperCase(),
      source: params.source
    }),
  })
  
  if (!response.ok) {
    const error: WatchlistError = await response.json().catch(() => ({ detail: 'Failed to add to watchlist' }))
    
    // Provide user-friendly error messages
    if (response.status === 409) {
      throw new Error(`${params.symbol.toUpperCase()} is already in your watchlist`)
    }
    if (response.status === 404) {
      throw new Error(`Symbol ${params.symbol.toUpperCase()} not found. Try syncing it first.`)
    }
    if (response.status === 400) {
      throw new Error(error.detail || 'Invalid symbol format')
    }
    if (response.status === 401) {
      throw new Error('Please sign in to add items to your watchlist')
    }
    throw new Error(error.detail || 'Failed to add to watchlist')
  }
  
  return response.json()
}

/**
 * Remove a symbol from user's watchlist
 * @throws Error with message for UI display
 */
export async function removeFromWatchlist(symbol: string): Promise<void> {
  if (typeof window === 'undefined') {
    throw new Error('Client-side only')
  }

  const response = await apiFetch(`${API_URL}/api/v1/watchlist/${encodeURIComponent(symbol.toUpperCase())}`, {
    method: 'DELETE',
  })
  
  if (!response.ok) {
    const error: WatchlistError = await response.json().catch(() => ({ detail: 'Failed to remove from watchlist' }))
    
    if (response.status === 404) {
      throw new Error(`${symbol.toUpperCase()} is not in your watchlist`)
    }
    if (response.status === 401) {
      throw new Error('Please sign in to manage your watchlist')
    }
    throw new Error(error.detail || 'Failed to remove from watchlist')
  }
  
  // 204 No Content - no body to parse
}

// Phase 4: Pro-Level Backtesting
export interface BacktestRequest {
  symbol: string
  start_date: string
  end_date: string
  strategy: string
  initial_capital: number
  strategy_params?: Record<string, number>
  position_sizing?: string
  commission_rate?: number
  slippage_rate?: number
  stop_loss_pct?: number | null
  take_profit_pct?: number | null
  trailing_stop_pct?: number | null
  max_pyramiding?: number
  walk_forward?: boolean
  walk_forward_train_pct?: number
  monte_carlo?: boolean
  monte_carlo_sims?: number
  benchmark?: string
}

export interface BacktestTrade {
  entry_date: string
  exit_date: string | null
  entry_price: number
  exit_price: number | null
  quantity: number
  pnl: number | null
  return_pct: number | null
  commission: number
  exit_reason: string
  bars_held: number
  mae: number
  mfe: number
}

export interface MonteCarloResult {
  median_return: number
  mean_return: number
  p5_return: number
  p25_return: number
  p75_return: number
  p95_return: number
  probability_of_profit: number
  probability_of_ruin: number
  max_seen_drawdown: number
  avg_max_drawdown: number
  distribution: { range_start: number; range_end: number; count: number; frequency: number }[]
  n_simulations: number
}

export interface BacktestResult {
  symbol: string
  strategy: string
  strategy_params: Record<string, number>
  initial_capital: number
  final_equity: number
  total_return: number
  cagr: number
  annualized_return: number
  annualized_volatility: number
  sharpe_ratio: number
  sortino_ratio: number
  calmar_ratio: number
  max_drawdown: number
  max_drawdown_duration: number
  var_95: number
  var_99: number
  ulcer_index: number
  total_trades: number
  win_rate: number
  profit_factor: number
  avg_win: number
  avg_loss: number
  expectancy: number
  avg_trade_duration: number
  total_commission: number
  commission_rate: number
  slippage_rate: number
  max_win_streak: number
  max_loss_streak: number
  alpha: number
  beta: number
  benchmark_equity: number[]
  benchmark_ticker: string
  data_source: string
  equity_curve: number[]
  drawdown_curve: number[]
  monthly_returns: { month: number; return_pct: number }[]
  rolling_sharpe: number[]
  trade_distribution: { range_start: number; range_end: number; count: number }[]
  mae_mfe: { return_pct: number; mae: number; mfe: number }[]
  trades: BacktestTrade[]
  monte_carlo: MonteCarloResult | null
  walk_forward: { enabled: boolean; train_bars?: number; test_bars?: number; train_pct?: number }
}

export interface CompareRequest {
  symbol: string
  start_date: string
  end_date: string
  strategies: string[]
  initial_capital?: number
  commission_rate?: number
  slippage_rate?: number
  stop_loss_pct?: number | null
  take_profit_pct?: number | null
  monte_carlo?: boolean
}

export interface CompareResult {
  symbol: string
  strategies: (BacktestResult & { error?: string })[]
  correlation_matrix: Record<string, Record<string, number>>
}

export interface ScanRequest {
  symbols: string[]
  strategy: string
  start_date: string
  end_date: string
  initial_capital?: number
  strategy_params?: Record<string, number>
  min_sharpe?: number | null
  min_win_rate?: number | null
  min_return?: number | null
}

export interface ScanResultItem {
  symbol: string
  total_return: number
  sharpe_ratio: number
  sortino_ratio: number
  win_rate: number
  max_drawdown: number
  total_trades: number
  profit_factor: number
  calmar_ratio: number
  equity_curve: number[]
  passed_filters: boolean
}

export interface ScanResult {
  strategy: string
  total_scanned: number
  results_count: number
  results: ScanResultItem[]
}

export async function runBacktest(
  request: BacktestRequest,
  signal?: AbortSignal,
): Promise<BacktestResult> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(new DOMException('Backtest timed out', 'TimeoutError')), 120_000)

  // Combine user-provided signal with our timeout signal
  const combinedSignal = signal
    ? (AbortSignal as any).any?.([signal, controller.signal]) ?? controller.signal
    : controller.signal

  try {
    const response = await apiFetch(`${API_URL}/api/v1/backtest`, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
      signal: combinedSignal,
    })
    if (!response.ok) {
      const errData = await response.json().catch(() => null)
      throw new Error(errData?.detail || `Backtest failed (${response.status})`)
    }
    return response.json()
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('Backtest was cancelled')
    }
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw new Error('Backtest timed out after 2 minutes. Try a shorter date range or disable Monte Carlo.')
    }
    throw err
  } finally {
    clearTimeout(timeout)
  }
}

export async function compareStrategies(
  request: CompareRequest,
  signal?: AbortSignal,
): Promise<CompareResult> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const response = await apiFetch(`${API_URL}/api/v1/backtest/compare`, {
    method: 'POST', headers, body: JSON.stringify(request), signal,
  })
  if (!response.ok) {
    const errData = await response.json().catch(() => null)
    throw new Error(errData?.detail || `Compare failed (${response.status})`)
  }
  return response.json()
}

export async function scanSymbols(
  request: ScanRequest,
  signal?: AbortSignal,
): Promise<ScanResult> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const response = await apiFetch(`${API_URL}/api/v1/backtest/scan`, {
    method: 'POST', headers, body: JSON.stringify(request), signal,
  })
  if (!response.ok) {
    const errData = await response.json().catch(() => null)
    throw new Error(errData?.detail || `Scan failed (${response.status})`)
  }
  return response.json()
}

export async function getStrategies(): Promise<{ strategies: { id: string; name: string; description: string; category: string; default_params: Record<string, number> }[] }> {
  const response = await fetch(`${API_URL}/api/v1/strategies`)
  if (!response.ok) throw new Error('Failed to fetch strategies')
  return response.json()
}

// Backtest date range
export interface BacktestDateRange {
  symbol: string
  available: boolean
  min_date?: string
  max_date?: string
  total_bars?: number
  error?: string
}

export async function getBacktestDateRange(symbol: string): Promise<BacktestDateRange> {
  const response = await fetch(`${API_URL}/api/v1/backtest/date-range/${encodeURIComponent(symbol)}`)
  if (!response.ok) return { symbol, available: false, error: 'Failed to fetch date range' }
  return response.json()
}

// Live News API
export interface LiveNewsItem {
  title: string
  summary: string
  source: string
  url: string
  published_at: string
  sentiment: string
  sentiment_score: number
  tickers?: string[]
  banner_image?: string
}

export interface LiveNewsResponse {
  news: LiveNewsItem[]
  count: number
  topics?: string
  symbol?: string
}

export async function fetchLiveMarketNews(
  topics: string = 'technology,earnings',
  limit: number = 20
): Promise<LiveNewsResponse> {
  const url = new URL(`${API_URL}/api/v1/news/live/market`)
  url.searchParams.append('topics', topics)
  url.searchParams.append('limit', limit.toString())
  
  const response = await fetch(url.toString())
  if (!response.ok) {
    throw new Error('Failed to fetch live news')
  }
  return response.json()
}

export async function fetchLiveSymbolNews(
  symbol: string,
  limit: number = 10
): Promise<LiveNewsResponse> {
  const url = new URL(`${API_URL}/api/v1/news/live/${symbol}`)
  url.searchParams.append('limit', limit.toString())
  
  const response = await fetch(url.toString())
  if (!response.ok) {
    throw new Error('Failed to fetch live symbol news')
  }
  return response.json()
}

// Quote API for live prices - Enhanced with Finviz real-time data
export interface QuoteData {
  symbol: string
  price: number
  change: number
  change_percent: number
  volume: number
  high: number
  low: number
  open: number
  previous_close: number
  timestamp: string
  bid_price?: number
  ask_price?: number
  market_status?: string
  data_source?: string
  latency_ms?: number
}

// Use enhanced endpoint with Finviz for sub-second real-time data
export async function fetchQuote(symbol: string, priority: 'high' | 'normal' = 'normal'): Promise<QuoteData> {
  try {
    const response = await fetch(`${API_URL}/api/v1/enhanced/quote/${symbol}?priority=${priority}`)
    const data = await parseJsonSafe<Record<string, unknown>>(response)
    if (data) {
      return normalizeQuoteData(data, symbol)
    }

    // Fallback to legacy endpoint before throwing
    const fallbackResponse = await fetch(`${API_URL}/api/v1/prices/${symbol}/quote`)
    if (fallbackResponse.ok) {
      return fallbackResponse.json()
    }

    throw new Error(`Failed to fetch quote: ${response.status}`)
  } catch (error) {
    console.error('Error fetching enhanced quote:', error)
    
    // Return mock data if all fails
    return {
      symbol: symbol.toUpperCase(),
      price: 0,
      change: 0,
      change_percent: 0,
      volume: 0,
      high: 0,
      low: 0,
      open: 0,
      previous_close: 0,
      timestamp: new Date().toISOString()
    }
  }
}

// Fetch fundamentals from enhanced endpoint
export interface FundamentalsData {
  symbol: string
  company_name?: string
  sector?: string
  industry?: string
  market_cap?: number
  pe_ratio?: number
  forward_pe?: number
  peg_ratio?: number
  price_to_sales?: number
  price_to_book?: number
  profit_margin?: number
  operating_margin?: number
  gross_margin?: number
  roe?: number
  roa?: number
  debt_to_equity?: number
  current_ratio?: number
  quick_ratio?: number
  beta?: number
  rsi?: number
  week_52_high?: number
  week_52_low?: number
  eps?: number
  eps_next_quarter?: number
  earnings_date?: string
  target_price?: number
  recommendation?: string
}

// Fetch quote from Finnhub with priority parameter
export async function fetchFinnhubQuote(symbol: string, priority: 'high' | 'normal' = 'high'): Promise<QuoteData> {
  try {
    const response = await fetch(`${API_URL}/api/v1/enhanced/quote/${symbol}/finnhub?priority=${priority}`)
    const data = await parseJsonSafe<Record<string, unknown>>(response)
    if (data) {
      return {
        ...normalizeQuoteData(data, symbol),
        data_source: 'finnhub',
        latency_ms: 50,
      }
    }
    return fetchQuote(symbol, priority)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!message.includes('Failed to fetch Finnhub quote')) {
      console.error('Error fetching Finnhub quote:', error)
    }
    // Fallback to regular quote
    return fetchQuote(symbol, priority)
  }
}

export async function fetchFundamentals(symbol: string): Promise<FundamentalsData> {
  try {
    const response = await fetch(`${API_URL}/api/v1/enhanced/fundamentals/${symbol}`)
    if (!response.ok) {
      throw new Error(`Failed to fetch fundamentals: ${response.status}`)
    }
    return response.json()
  } catch (error) {
    console.error('Error fetching fundamentals:', error)
    return { symbol: symbol.toUpperCase() }
  }
}

// Market Data API
export interface StockPerformance {
  symbol: string
  name: string
  price: number
  change: number
  change_percent: number
  volume: number
  market_cap?: number
  sector?: string
}

export interface SectorPerformance {
  sector: string
  change_percent: number
  stocks: StockPerformance[]
}

export interface HeatmapData {
  sectors: SectorPerformance[]
  total_stocks: number
  gainers: number
  losers: number
  unchanged: number
}

export interface MarketMovers {
  gainers: StockPerformance[]
  losers: StockPerformance[]
  updated_at: string
}

export interface IpoCalendarEntry {
  date: string
  symbol?: string | null
  name: string
  exchange?: string | null
  status?: string | null
  price?: string | null
  shares?: number | null
}

export async function fetchIpoCalendar(): Promise<IpoCalendarEntry[]> {
  try {
    const response = await fetchWithTimeout(`${API_URL}/api/v1/market/ipo-calendar`, 20_000)
    const data = await parseJsonSafe<IpoCalendarEntry[]>(response)
    if (data && Array.isArray(data) && data.length > 0) return data
  } catch (e) {
    console.error('Error fetching IPO calendar:', e)
  }
  try {
    const r = await fetchWithTimeout('/api/finnhub?type=ipo-calendar', 18_000)
    if (!r.ok) return []
    const raw = (await parseJsonSafe<Record<string, unknown>[]>(r)) ?? []
    if (!Array.isArray(raw) || raw.length === 0) return []
    return raw.map((row) => ({
      date: String(row.date ?? ''),
      symbol: row.symbol != null ? String(row.symbol) : null,
      name: String(row.name ?? row.symbol ?? 'IPO'),
      exchange: row.exchange != null ? String(row.exchange) : null,
      status: row.status != null ? String(row.status) : null,
      price: row.price != null ? String(row.price) : null,
      shares: typeof row.numberOfShares === 'number' ? row.numberOfShares : null,
    }))
  } catch {
    return []
  }
}

export interface MarketIndex {
  symbol: string
  name: string
  price: number
  change: number
  change_percent: number
  timestamp: string
}

const MARKETS_OVERVIEW_INDEX_SYMBOLS =
  '^GSPC,^IXIC,^DJI,^RUT,^VIX,GLD,USO,TLT,XLF,XLE'

/** Next.js route: Yahoo → FMP → Twelve → Finnhub (works when backend yfinance is blocked). */
async function fetchMarketIndicesFromNextProxy(): Promise<MarketIndex[] | null> {
  try {
    const res = await fetch(
      `/api/quotes/indices?symbols=${encodeURIComponent(MARKETS_OVERVIEW_INDEX_SYMBOLS)}`
    )
    if (!res.ok) return null
    const rows = (await parseJsonSafe<
      Array<{
        symbol: string
        name: string
        shortName?: string
        price: number
        change: number
        change_percent: number
      }>
    >(res)) ?? []
    if (!Array.isArray(rows) || rows.length === 0) return null
    if (!rows.some((r) => isFiniteNumber(r.price) && r.price > 0)) return null
    const ts = new Date().toISOString()
    return rows.map((r) => ({
      symbol: r.symbol,
      name: (r.name && r.name.trim()) || r.shortName || r.symbol,
      price: Number(r.price) || 0,
      change: Number(r.change) || 0,
      change_percent: Number(r.change_percent) || 0,
      timestamp: ts,
    }))
  } catch {
    return null
  }
}

export async function fetchMarketIndices(): Promise<MarketIndex[]> {
  const proxied = await fetchMarketIndicesFromNextProxy()
  if (proxied && proxied.length > 0) return proxied

  try {
    const response = await fetch(`${API_URL}/api/v1/enhanced/market-indices`)
    const data = await parseJsonSafe<MarketIndex[]>(response)
    if (data && Array.isArray(data) && data.length > 0) {
      // If upstream returns zeros (common when yfinance blocks), fallback to liquid ETFs via quote endpoint
      const allZero = data.every((i) => !isFiniteNumber(i.price) || i.price === 0)
      if (!allZero) return data
    }
    console.error('Failed to fetch market indices:', response.status)
    // Fallback to ETFs that track indices (uses enhanced quote endpoint)
    try {
      const [spy, qqq, dia] = await Promise.all([
        fetchQuote('SPY', 'normal'),
        fetchQuote('QQQ', 'normal'),
        fetchQuote('DIA', 'normal'),
      ])
      return [
        {
          symbol: '^GSPC',
          name: 'S&P 500',
          price: spy.price,
          change: spy.change,
          change_percent: spy.change_percent,
          timestamp: spy.timestamp,
        },
        {
          symbol: '^IXIC',
          name: 'NASDAQ',
          price: qqq.price,
          change: qqq.change,
          change_percent: qqq.change_percent,
          timestamp: qqq.timestamp,
        },
        {
          symbol: '^DJI',
          name: 'Dow Jones',
          price: dia.price,
          change: dia.change,
          change_percent: dia.change_percent,
          timestamp: dia.timestamp,
        },
      ]
    } catch {
      return []
    }
  } catch (error) {
    console.error('Error fetching market indices:', error)
    // Fallback to ETFs that track indices (uses enhanced quote endpoint)
    try {
      const [spy, qqq, dia] = await Promise.all([
        fetchQuote('SPY', 'normal'),
        fetchQuote('QQQ', 'normal'),
        fetchQuote('DIA', 'normal'),
      ])
      return [
        {
          symbol: '^GSPC',
          name: 'S&P 500',
          price: spy.price,
          change: spy.change,
          change_percent: spy.change_percent,
          timestamp: spy.timestamp,
        },
        {
          symbol: '^IXIC',
          name: 'NASDAQ',
          price: qqq.price,
          change: qqq.change,
          change_percent: qqq.change_percent,
          timestamp: qqq.timestamp,
        },
        {
          symbol: '^DJI',
          name: 'Dow Jones',
          price: dia.price,
          change: dia.change,
          change_percent: dia.change_percent,
          timestamp: dia.timestamp,
        },
      ]
    } catch {
      return []
    }
  }
}

export async function fetchMarketStocks(
  sector?: string,
  limit: number = 100
): Promise<StockPerformance[]> {
  const url = new URL(`${API_URL}/api/v1/market/stocks`)
  if (sector) url.searchParams.append('sector', sector)
  url.searchParams.append('limit', limit.toString())
  
  const response = await fetch(url.toString())
  if (!response.ok) {
    throw new Error('Failed to fetch market stocks')
  }
  return response.json()
}

export async function fetchSectorPerformance(): Promise<SectorPerformance[]> {
  try {
    const response = await fetchWithTimeout(`${API_URL}/api/v1/market/sectors`, 60_000)
    const data = await parseJsonSafe<SectorPerformance[]>(response)
    if (data) return data
    if (!response.ok) {
      console.error('Failed to fetch sector performance:', response.status, response.statusText)
      return []
    }
    return []
  } catch (error) {
    console.error('Error fetching sector performance:', error)
    return []
  }
}

export interface MarketCoverageStats {
  heatmap_universe_count: number
  symbols_master_active: number
  symbols_master_total: number
  note: string
}

export async function fetchMarketCoverage(): Promise<MarketCoverageStats | null> {
  try {
    const response = await fetchWithTimeout(
      `${API_URL}/api/v1/market/coverage`,
      15_000
    )
    const data = await parseJsonSafe<MarketCoverageStats>(response)
    if (data) return data
    if (!response.ok) return null
    return null
  } catch {
    return null
  }
}

export async function fetchHeatmapData(): Promise<HeatmapData> {
  const response = await fetch(`${API_URL}/api/v1/market/heatmap`)
  const data = await parseJsonSafe<HeatmapData>(response)
  if (data) return data
  if (!response.ok) {
    throw new Error('Failed to fetch heatmap data')
  }
  return {
    sectors: [],
    total_stocks: 0,
    gainers: 0,
    losers: 0,
    unchanged: 0,
  }
}

export async function fetchMarketMovers(forceRefresh: boolean = false): Promise<MarketMovers> {
  const updatedAt = () => new Date().toISOString()
  try {
    const url = new URL(`${API_URL}/api/v1/market/movers`)
    if (forceRefresh) {
      url.searchParams.append('force_refresh', 'true')
    }
    const response = await fetchWithTimeout(url.toString(), 60_000)
    const data = await parseJsonSafe<MarketMovers>(response)
    if (data && (data.gainers?.length > 0 || data.losers?.length > 0)) {
      return { ...data, updated_at: data.updated_at || updatedAt() }
    }

    if (!forceRefresh) {
      const forceUrl = new URL(`${API_URL}/api/v1/market/movers`)
      forceUrl.searchParams.append('force_refresh', 'true')
      const forceResponse = await fetchWithTimeout(forceUrl.toString(), 60_000)
      const forceData = await parseJsonSafe<MarketMovers>(forceResponse)
      if (forceData && (forceData.gainers?.length > 0 || forceData.losers?.length > 0)) {
        return { ...forceData, updated_at: forceData.updated_at || updatedAt() }
      }
    }

    const [gainers, losers] = await Promise.all([
      fetchTopGainers(10, true),
      fetchTopLosers(10, true),
    ])
    if (gainers.length > 0 || losers.length > 0) {
      return { gainers, losers, updated_at: updatedAt() }
    }

    if (!response.ok) {
      console.error('Failed to fetch market movers:', response.status, response.statusText)
    }

    return {
      gainers: data?.gainers ?? [],
      losers: data?.losers ?? [],
      updated_at: updatedAt(),
    }
  } catch (error) {
    console.error('Error fetching market movers:', error)
    try {
      const [gainers, losers] = await Promise.all([
        fetchTopGainers(10, true),
        fetchTopLosers(10, true),
      ])
      return { gainers, losers, updated_at: updatedAt() }
    } catch {
      return { gainers: [], losers: [], updated_at: updatedAt() }
    }
  }
}

// Fetch multiple quotes in batch for market overview with priority support
export async function fetchBatchQuotes(
  symbols: string[], 
  priority: 'high' | 'normal' = 'normal'
): Promise<QuoteData[]> {
  try {
    const promises = symbols.map(symbol => fetchQuote(symbol, priority))
    return await Promise.all(promises)
  } catch (error) {
    console.error('Error fetching batch quotes:', error)
    return []
  }
}

export async function fetchTopGainers(limit: number = 10, forceRefresh: boolean = false): Promise<StockPerformance[]> {
  const url = new URL(`${API_URL}/api/v1/market/gainers`)
  url.searchParams.append('limit', limit.toString())
  if (forceRefresh) {
    url.searchParams.append('force_refresh', 'true')
  }
  
  try {
    const response = await fetchWithTimeout(url.toString(), 60_000)
    if (!response.ok) {
      throw new Error(`Failed to fetch top gainers: ${response.status}`)
    }
    const data = await response.json()
    return Array.isArray(data) ? data : []
  } catch (error) {
    console.error('Error fetching top gainers:', error)
    return []
  }
}

export async function fetchTopLosers(limit: number = 10, forceRefresh: boolean = false): Promise<StockPerformance[]> {
  const url = new URL(`${API_URL}/api/v1/market/losers`)
  url.searchParams.append('limit', limit.toString())
  if (forceRefresh) {
    url.searchParams.append('force_refresh', 'true')
  }
  
  try {
    const response = await fetchWithTimeout(url.toString(), 60_000)
    if (!response.ok) {
      throw new Error(`Failed to fetch top losers: ${response.status}`)
    }
    const data = await response.json()
    return Array.isArray(data) ? data : []
  } catch (error) {
    console.error('Error fetching top losers:', error)
    return []
  }
}

// Market Status API
export interface MarketStatus {
  is_open: boolean
  status: 'OPEN' | 'CLOSED'
  current_time_et: string
  market_open: string
  market_close: string
  is_weekday: boolean
  exchanges: {
    NYSE: boolean
    NASDAQ: boolean
  }
}

export async function fetchMarketStatus(): Promise<MarketStatus> {
  const response = await fetch(`${API_URL}/api/v1/market/status`)
  const data = await parseJsonSafe<MarketStatus>(response)
  if (data) return data
  if (!response.ok) {
    return {
      is_open: false,
      status: 'CLOSED',
      current_time_et: new Date().toISOString(),
      market_open: '09:30 ET',
      market_close: '16:00 ET',
      is_weekday: false,
      exchanges: { NYSE: false, NASDAQ: false }
    }
  }
  return {
    is_open: false,
    status: 'CLOSED',
    current_time_et: new Date().toISOString(),
    market_open: '09:30 ET',
    market_close: '16:00 ET',
    is_weekday: false,
    exchanges: { NYSE: false, NASDAQ: false }
  }
}

// ========================================
// Billing API (Stripe Checkout)
// ========================================

export type BillingPlan = 'plus_monthly' | 'plus_yearly'

export interface CheckoutSessionResponse {
  url: string
}

export interface BillingPortalResponse {
  url: string
}

export interface BillingSessionStatus {
  id: string
  status?: string
  customer_id?: string
  subscription_id?: string
  price_id?: string
}

export interface SubscriptionStatus {
  has_active: boolean
  is_pro?: boolean
  plan_label?: string
  status?: string
  price_id?: string
  current_period_end?: string | null
  cancel_at_period_end?: boolean | null
}

export interface UserPreferences {
  analyst_personality?: string
  data_sources?: { sec?: boolean; social?: boolean; technical?: boolean }
  notifications?: Record<string, boolean>
  pro_alerts?: { watchlist_price?: boolean; watchlist_news?: boolean }
}

async function getAuthJsonHeaders() {
  if (typeof window === 'undefined') {
    return { 'Content-Type': 'application/json' }
  }
  const { getAuthHeaders } = await import('./auth')
  return {
    'Content-Type': 'application/json',
    ...getAuthHeaders()
  }
}

export async function createCheckoutSession(
  params: { plan?: BillingPlan; price_id?: string }
): Promise<CheckoutSessionResponse> {
  const headers = await getAuthJsonHeaders()

  const response = await apiFetch(`${API_URL}/api/v1/billing/checkout-session`, {
    method: 'POST',
    headers,
    body: JSON.stringify(params),
  })

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}))
    const message =
      (errorBody && (errorBody.detail || errorBody.message)) ||
      'Failed to start checkout session'
    throw new Error(message)
  }

  return response.json()
}

export async function createBillingPortalSession(): Promise<BillingPortalResponse> {
  const headers = await getAuthJsonHeaders()

  const response = await apiFetch(`${API_URL}/api/v1/billing/portal`, {
    method: 'POST',
    headers,
  })

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}))
    const message =
      (errorBody && (errorBody.detail || errorBody.message)) ||
      'Failed to open billing portal'
    throw new Error(message)
  }

  return response.json()
}

export async function getBillingSessionStatus(
  sessionId: string
): Promise<BillingSessionStatus> {
  const url = new URL(`${API_URL}/api/v1/billing/session-status`)
  url.searchParams.append('session_id', sessionId)

  const response = await fetch(url.toString())
  if (!response.ok) {
    throw new Error('Failed to fetch session status')
  }

  return response.json()
}

export async function getSubscriptionStatus(): Promise<SubscriptionStatus> {
  const headers = await getAuthJsonHeaders()

  const response = await apiFetch(`${API_URL}/api/v1/billing/subscription`, {
    headers,
  })

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}))
    const message =
      (errorBody && (errorBody.detail || errorBody.message)) ||
      'Failed to fetch subscription status'
    throw new Error(message)
  }

  return response.json()
}

export async function cancelSubscriptionAtPeriodEnd(
  atPeriodEnd: boolean = true
): Promise<{ ok: boolean; message?: string }> {
  const headers = await getAuthJsonHeaders()
  const response = await apiFetch(`${API_URL}/api/v1/billing/cancel-subscription`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ at_period_end: atPeriodEnd }),
  })
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}))
    const message =
      (errorBody && (errorBody.detail || errorBody.message)) ||
      'Failed to cancel subscription'
    throw new Error(typeof message === 'string' ? message : 'Failed to cancel subscription')
  }
  return response.json()
}

export async function getUserPreferences(): Promise<UserPreferences> {
  const headers = await getAuthJsonHeaders()
  const response = await apiFetch(`${API_URL}/api/v1/user/preferences`, { headers })
  if (!response.ok) {
    throw new Error('Failed to load preferences')
  }
  return response.json()
}

export async function putUserPreferences(
  patch: Partial<UserPreferences>
): Promise<UserPreferences> {
  const headers = await getAuthJsonHeaders()
  const response = await apiFetch(`${API_URL}/api/v1/user/preferences`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(patch),
  })
  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to save preferences')
  }
  return response.json()
}

export async function requestAccountDeletionOtp(): Promise<{ ok: boolean; message?: string }> {
  const headers = await getAuthJsonHeaders()
  const response = await apiFetch(`${API_URL}/api/v1/account/delete-request`, {
    method: 'POST',
    headers,
  })
  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to send verification email')
  }
  return response.json()
}

export async function confirmAccountDeletion(otp: string): Promise<{ ok: boolean }> {
  const headers = await getAuthJsonHeaders()
  const response = await apiFetch(`${API_URL}/api/v1/account/delete-confirm`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ otp: otp.trim() }),
  })
  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err.detail || 'Invalid or expired code')
  }
  return response.json()
}

// ── Ideas Lab ────────────────────────────────────────────────────────────────

export interface TradeIdea {
  symbol: string
  company_name: string
  idea_type: 'long' | 'short'
  entry_price: number | null
  target_price: number | null
  stop_loss: number | null
  risk_reward: number | null
  confidence: number
  timeframe: string
  catalyst: string
  sector: string
  category?: string
  rsi: number | null
  change_percent: string | null
  volume_ratio: number | null
  data_source?: string
  signal_strength?: number | null
  trend?: string | null
  momentum?: string | null
}

export interface IdeasResponse {
  ideas: TradeIdea[]
  generated_at: string
  is_live?: boolean
  data_sources_used?: string[]
  market_pulse: {
    total_scanned?: number
    total_ideas?: number
    bullish_count?: number
    bearish_count?: number
    avg_confidence?: number
    top_bullish?: {
      symbol: string
      company_name?: string | null
      confidence: number
      catalyst: string
      change_percent?: string | null
      data_source?: string
    }[]
    top_bearish?: {
      symbol: string
      company_name?: string | null
      confidence: number
      catalyst: string
      change_percent?: string | null
      data_source?: string
    }[]
    sector_rotation?: Record<string, { etf?: string; change_pct?: number; sentiment?: string; bullish?: number; bearish?: number }>
    sector_sentiment?: Record<string, { bullish: number; bearish: number }>
  }
}

export async function generateIdeas(): Promise<IdeasResponse> {
  const headers = await getAuthJsonHeaders()
  const response = await apiFetch(`${API_URL}/api/v1/ideas/generate`, { headers })
  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to generate ideas')
  }
  return response.json()
}

export async function getTrendingIdeas(): Promise<IdeasResponse> {
  const response = await fetch(`${API_URL}/api/v1/ideas/trending`)
  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to fetch trending ideas')
  }
  return response.json()
}

// ── Copilot API Usage ─────────────────────────────────────────────────

export interface CopilotUsage {
  today_requests: number
  today_input_tokens: number
  today_output_tokens: number
  today_cost_usd: number
  daily_budget_usd: number
  budget_remaining_usd: number
  budget_ok: boolean
  is_pro: boolean
  free_limit: number
  free_remaining: number
}

export async function getCopilotUsage(): Promise<CopilotUsage> {
  const headers = await getAuthHeadersClient()
  const response = await apiFetch(`${API_URL}/api/v1/copilot/usage`, { headers })
  if (!response.ok) return {
    today_requests: 0, today_input_tokens: 0, today_output_tokens: 0,
    today_cost_usd: 0, daily_budget_usd: 2.0, budget_remaining_usd: 2.0, budget_ok: true,
    is_pro: false, free_limit: 5, free_remaining: 5,
  }
  return response.json()
}


// ── Model Index Engine (AI Basket Intelligence) ─────────────────────────────

export interface BasketHolding {
  ticker: string
  company_name: string | null
  sector: string | null
  industry: string | null
  weight_pct: number
  overall_ai_score: number
  confidence_score: number
  grade: string
  fundamental_score: number
  valuation_score: number
  quality_score: number
  technical_score: number
  sentiment_score: number
  macro_fit_score: number
  geopolitical_resilience_score: number
  risk_score: number
  diversification_score: number
  analyst_score: number
  role: { role_id: string; role_label: string; role_description: string }
  suggested_weight_pct: number
  data_completeness: number
}

export interface IndexSnapshot {
  index_id: string
  index_name: string
  short_name: string
  description: string
  category: string
  methodology: string
  benchmark: string
  rebalance_cadence: string
  risk_profile: string
  regime_label: string
  regime: string
  regime_confidence: number
  strategy_type: string
  num_holdings: number
  avg_ai_score: number
  avg_confidence: number
  weighting_method: string
  holdings: BasketHolding[]
  rejected: { ticker: string; exclusion_reason: string }[]
  sector_allocation: Record<string, number>
  factor_exposure: Record<string, number>
  risk_level: string
  risk_score: number
  portfolio_volatility_ann: number
  portfolio_beta: number
  max_drawdown_estimate_pct: number
  var_95_daily_pct: number
  concentration: {
    hhi: number
    max_single_weight_pct: number
    top5_weight_pct: number
    max_sector_weight_pct: number
    num_sectors: number
    avg_pairwise_correlation: number
  }
  expected_return_range: {
    low_pct: number
    high_pct: number
    expected_pct: number
    horizon_days: number
  } | null
  monte_carlo: {
    expected_return_pct: number
    return_std_pct: number
    percentiles: Record<string, number>
    probabilities: Record<string, number>
    bull_case: { return_pct: number; description: string }
    base_case: { return_pct: number; description: string }
    bear_case: { return_pct: number; description: string }
  } | null
  scenarios: {
    scenario_label: string
    projected_basket_return_pct: number
    scenario_description: string
  }[] | null
  explanation: {
    basket_thesis: string
    why_this_basket_now: string
    top_supporting_signals: { factor: string; label: string; score: number }[]
    top_risks: string[]
    allocation_methodology: string
    risk_summary: { level: string; score: number; volatility: number; beta: number }
  }
  model_version: string
  generated_at: string
}

export interface IndexDefinition {
  index_id: string
  name: string
  short_name: string
  description: string
  category: string
  risk_profile: string
  benchmark: string
  rebalance_cadence: string
  target_holdings: [number, number]
}

export interface RegimeData {
  regime: string
  regime_label: string
  regime_description: string
  confidence: number
  signals: {
    vix: number | null
    vix_signal: string
    breadth_sma200_pct: number
    breadth_sma50_pct: number
    momentum_breadth_pct: number
    breadth_signal: string
    momentum_signal: string
  }
  secondary_regime: string | null
}

export async function fetchModelIndices(): Promise<{ indices: IndexDefinition[]; total: number }> {
  const response = await fetch(`${API_URL}/api/v1/model-index/indices`)
  if (!response.ok) throw new Error('Failed to fetch model indices')
  return response.json()
}

export async function fetchIndexSnapshot(indexId: string): Promise<IndexSnapshot> {
  const response = await fetch(`${API_URL}/api/v1/model-index/indices/${indexId}`)
  if (!response.ok) throw new Error('Failed to fetch index snapshot')
  return response.json()
}

export interface BatchLoadResponse {
  indices: IndexDefinition[]
  snapshots: Record<string, IndexSnapshot>
  regime: RegimeData | null
  total: number
  cached: number
}

export async function fetchBatchLoad(): Promise<BatchLoadResponse> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 30_000)
  try {
    const response = await fetch(`${API_URL}/api/v1/model-index/batch`, { signal: controller.signal })
    if (!response.ok) throw new Error('Failed to batch load')
    return response.json()
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('Loading baskets timed out — please refresh the page.')
    }
    throw err
  } finally {
    clearTimeout(timeoutId)
  }
}

export async function refreshIndex(
  indexId: string,
  sync = true,
  /** Skip Monte Carlo + scenarios — faster; avoids proxy/worker timeouts in production */
  fast = true,
): Promise<IndexSnapshot & { error?: string }> {
  const headers = await getAuthHeadersClient()
  const q = new URLSearchParams({ sync: String(sync), fast: String(fast) })

  // AbortController with 90s timeout — Cloudflare free-tier proxy kills at ~100s
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 90_000)

  try {
    const response = await apiFetch(
      `${API_URL}/api/v1/model-index/indices/${encodeURIComponent(indexId)}/refresh?${q}`,
      { method: 'POST', headers, signal: controller.signal },
    )
    if (!response.ok) {
      const err = await response.json().catch(() => ({})) as { detail?: string | { msg?: string }[] }
      const d = err.detail
      const msg =
        typeof d === 'string'
          ? d
          : Array.isArray(d)
            ? d.map((x) => (typeof x === 'object' && x && 'msg' in x ? String((x as { msg: string }).msg) : '')).filter(Boolean).join('; ')
            : 'Failed to refresh index'
      throw new Error(msg || 'Failed to refresh index')
    }
    return response.json()
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('Basket generation timed out. The market data pipeline is still running — try again in 30 seconds.')
    }
    throw err
  } finally {
    clearTimeout(timeoutId)
  }
}

export async function fetchRegime(): Promise<RegimeData> {
  const response = await fetch(`${API_URL}/api/v1/model-index/regime`)
  if (!response.ok) throw new Error('Failed to fetch regime')
  return response.json()
}

export async function fetchStockDeepDive(ticker: string): Promise<any> {
  const response = await fetch(`${API_URL}/api/v1/model-index/stock/${ticker.toUpperCase()}`)
  if (!response.ok) throw new Error('Failed to fetch stock analysis')
  return response.json()
}

export async function fetchUniverseRankings(indexType = 'balanced_core'): Promise<any> {
  const response = await fetch(`${API_URL}/api/v1/model-index/rankings?index_type=${indexType}`)
  if (!response.ok) throw new Error('Failed to fetch rankings')
  return response.json()
}

// ── Options API (Public.com) ────────────────────────────────────────────

export interface OptionContract {
  symbol: string
  strike: number | null
  bid: number | null
  ask: number | null
  mid: number | null
  last: number | null
  volume: number | null
  open_interest: number | null
  implied_volatility: number | null
  delta: number | null
  gamma: number | null
  theta: number | null
  vega: number | null
  rho: number | null
}

export interface OptionChainData {
  symbol: string
  expiration: string
  calls: OptionContract[]
  puts: OptionContract[]
  source: string
  fetched_at: string
}

export interface OptionExpirationsData {
  symbol: string
  expirations: string[]
  source: string
}

// ── Intraday Chart Data ─────────────────────────────────────────────

export async function fetchIntradayPrices(
  symbol: string,
  interval: '1m' | '5m' | '15m' | '1h' = '5m',
  days: number = 1,
  extendedHours: boolean = false,
): Promise<PriceBar[]> {
  const params = new URLSearchParams({ interval, days: String(days) })
  if (extendedHours) params.append('extended_hours', 'true')
  const response = await fetch(
    `${API_URL}/api/v1/prices/${symbol.toUpperCase()}/intraday?${params}`
  )
  if (!response.ok) return []
  const data = await response.json()
  return (data || []).map((bar: any) => ({
    timestamp: bar.timestamp,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
  }))
}

export async function fetchOptionExpirations(symbol: string): Promise<OptionExpirationsData> {
  const response = await fetch(`${API_URL}/api/v1/options/${symbol.toUpperCase()}/expirations`)
  if (!response.ok) throw new Error('Failed to fetch option expirations')
  return response.json()
}

export async function fetchOptionChain(symbol: string, expiration: string): Promise<OptionChainData> {
  const response = await fetch(
    `${API_URL}/api/v1/options/${symbol.toUpperCase()}/chain?expiration=${encodeURIComponent(expiration)}`
  )
  if (!response.ok) throw new Error('Failed to fetch option chain')
  return response.json()
}

// ── Community API ──────────────────────────────────────────────────────

export interface CommunityPost {
  id: number
  title: string
  body: string
  post_type: string
  tickers: string[]
  sentiment: string | null
  vote_count: number
  upvote_count?: number
  downvote_count?: number
  comment_count: number
  view_count?: number
  user_vote: number | null
  is_pinned?: boolean
  is_locked?: boolean
  created_at: string
  updated_at?: string
  author: { id: number; username: string; full_name?: string; avatar_url?: string | null }
  community: { slug: string; name: string; icon?: string }
  // Flat fields from backend (before normalization)
  community_slug?: string
  community_name?: string
  disclaimer?: string
}

/** Normalize backend post shape (flat community_slug/name → nested community object) */
function normalizePost(raw: any): CommunityPost {
  return {
    ...raw,
    vote_count: raw.vote_count ?? ((raw.upvote_count ?? 0) - (raw.downvote_count ?? 0)),
    user_vote: raw.user_vote ?? null,
    community: raw.community ?? {
      slug: raw.community_slug ?? '',
      name: raw.community_name ?? '',
    },
    author: raw.author ?? { id: 0, username: 'unknown' },
  }
}

export function normalizePosts(items: any[]): CommunityPost[] {
  return items.map(normalizePost)
}

export interface Community {
  id?: number
  slug: string
  name: string
  description: string
  icon?: string
  icon_url?: string
  banner_url?: string
  category: string
  ticker_focus?: string
  member_count: number
  post_count?: number
  is_private?: boolean
  created_at?: string
  creator_username?: string
  is_member: boolean
}

export interface Notification {
  id: number
  type: 'reply' | 'upvote' | 'mention' | 'follow' | 'alert'
  title: string
  body: string
  action_url?: string
  is_read: boolean
  created_at: string
}

export async function fetchFeed(sort: string = 'hot', cursor?: number, limit: number = 20, time?: string) {
  const params = new URLSearchParams({ sort, limit: String(limit) })
  if (cursor) params.set('cursor', String(cursor))
  if (time && sort === 'top') params.set('time', time)
  const res = await apiFetch(`${API_URL}/api/v1/feed?${params}`)
  if (!res.ok) return { posts: [] as CommunityPost[], next_cursor: null as number | null }
  const data = await res.json()
  return {
    posts: normalizePosts(data.posts || data.items || []),
    next_cursor: data.next_cursor as number | null,
  }
}

export async function fetchPopularFeed(cursor?: number, limit: number = 20, sort: string = 'hot', time?: string) {
  const params = new URLSearchParams({ sort, limit: String(limit) })
  if (cursor) params.set('cursor', String(cursor))
  if (time && sort === 'top') params.set('time', time)
  const res = await apiFetch(`${API_URL}/api/v1/feed/popular?${params}`)
  if (!res.ok) return { posts: [] as CommunityPost[], next_cursor: null as number | null }
  const data = await res.json()
  return {
    posts: normalizePosts(data.posts || data.items || []),
    next_cursor: data.next_cursor as number | null,
  }
}

export async function fetchTickerFeed(symbol: string, cursor?: number) {
  const params = new URLSearchParams({ limit: '20' })
  if (cursor) params.set('cursor', String(cursor))
  const res = await apiFetch(`${API_URL}/api/v1/feed/ticker/${symbol}?${params}`)
  if (!res.ok) return { posts: [] as CommunityPost[], next_cursor: null as number | null }
  const data = await res.json()
  return {
    posts: normalizePosts(data.posts || data.items || []),
    next_cursor: data.next_cursor as number | null,
  }
}

export async function fetchMarketMood(hours: number = 24) {
  const res = await apiFetch(`${API_URL}/api/v1/feed/market-mood?hours=${hours}`)
  if (!res.ok) return null
  return res.json() as Promise<{
    mood: string; counts: { bullish: number; bearish: number; neutral: number };
    total_posts: number; bullish_pct: number; bearish_pct: number
  }>
}

export async function fetchTrendingTickers(hours: number = 24, limit: number = 10) {
  const res = await apiFetch(`${API_URL}/api/v1/feed/trending-tickers?hours=${hours}&limit=${limit}`)
  if (!res.ok) return { tickers: [] as { symbol: string; mention_count: number }[], time_window_hours: 24 }
  return res.json() as Promise<{ tickers: { symbol: string; mention_count: number }[]; time_window_hours: number }>
}

export async function fetchCommunities(category?: string) {
  const params = category ? `?category=${category}` : ''
  const res = await apiFetch(`${API_URL}/api/v1/communities${params}`)
  if (!res.ok) return { communities: [] as Community[] }
  const data = await res.json()
  // Backend returns { items: [...] } but callers expect { communities: [...] }
  return { communities: (data.communities || data.items || []) as Community[] }
}

export async function fetchCommunity(slug: string) {
  const res = await apiFetch(`${API_URL}/api/v1/communities/${slug}`)
  if (!res.ok) return null
  return res.json() as Promise<Community>
}

export async function joinCommunity(slug: string) {
  const res = await apiFetch(`${API_URL}/api/v1/communities/${slug}/join`, { method: 'POST' })
  return res.ok
}

export async function leaveCommunity(slug: string) {
  const res = await apiFetch(`${API_URL}/api/v1/communities/${slug}/leave`, { method: 'DELETE' })
  return res.ok
}

export async function createPost(data: { title: string; body: string; community_slug: string; post_type?: string; tickers?: string[]; sentiment?: string; media_urls?: string[] }) {
  const res = await apiFetch(`${API_URL}/api/v1/posts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const errData = await res.json().catch(() => null)
    throw new Error(errData?.detail || 'Failed to create post')
  }
  const raw = await res.json()
  return normalizePost(raw) as CommunityPost
}

export async function fetchPost(postId: number) {
  const res = await apiFetch(`${API_URL}/api/v1/posts/${postId}`)
  if (!res.ok) return null
  const data = await res.json()
  return normalizePost(data) as CommunityPost
}

export async function votePost(postId: number, direction: 1 | -1) {
  const res = await apiFetch(`${API_URL}/api/v1/posts/${postId}/vote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ direction }),
  })
  return res.ok
}

export async function fetchComments(postId: number, sort: string = 'best') {
  const res = await apiFetch(`${API_URL}/api/v1/posts/${postId}/comments?sort=${sort}`)
  if (!res.ok) return { comments: [] }
  return res.json()
}

export async function createComment(postId: number, body: string, parentId?: number) {
  const res = await apiFetch(`${API_URL}/api/v1/posts/${postId}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body, parent_id: parentId }),
  })
  if (!res.ok) throw new Error('Failed to create comment')
  return res.json()
}

export async function voteComment(commentId: number, direction: 1 | -1) {
  const res = await apiFetch(`${API_URL}/api/v1/comments/${commentId}/vote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ direction }),
  })
  return res.ok
}

export async function fetchNotifications(limit: number = 20) {
  const res = await apiFetch(`${API_URL}/api/v1/notifications?limit=${limit}`)
  if (!res.ok) return { notifications: [] }
  return res.json()
}

export async function fetchUnreadCount() {
  const res = await apiFetch(`${API_URL}/api/v1/notifications/unread-count`)
  if (!res.ok) return { count: 0 }
  return res.json()
}

export async function markNotificationRead(id: number) {
  await apiFetch(`${API_URL}/api/v1/notifications/${id}/read`, { method: 'PATCH' })
}

export async function markAllNotificationsRead() {
  await apiFetch(`${API_URL}/api/v1/notifications/read-all`, { method: 'POST' })
}

// ── Bookmarks ──────────────────────────────────────────────────────────

export async function bookmarkPost(postId: number) {
  const res = await apiFetch(`${API_URL}/api/v1/posts/${postId}/bookmark`, { method: 'POST' })
  // 409 means already bookmarked — treat as success (no-op)
  return res.ok || res.status === 409
}

export async function unbookmarkPost(postId: number) {
  const res = await apiFetch(`${API_URL}/api/v1/posts/${postId}/bookmark`, { method: 'DELETE' })
  // 404 means bookmark already removed — treat as success (no-op)
  return res.ok || res.status === 404
}

export async function fetchBookmarks(cursor?: number) {
  const params = new URLSearchParams({ limit: '20' })
  if (cursor) params.set('cursor', String(cursor))
  const res = await apiFetch(`${API_URL}/api/v1/users/me/bookmarks?${params}`)
  if (!res.ok) return { posts: [] as CommunityPost[], next_cursor: null as number | null }
  const data = await res.json()
  return {
    posts: normalizePosts(data.posts || data.items || []),
    next_cursor: data.next_cursor as number | null,
  }
}

// ── Reactions API ─────────────────────────────────────────────────��────

export interface ReactionSummary {
  emoji: string
  count: number
  reacted: boolean
}

export async function addReaction(postId: number, emoji: string): Promise<boolean> {
  const res = await apiFetch(`${API_URL}/api/v1/posts/${postId}/reactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ emoji }),
  })
  return res.ok
}

export async function removeReaction(postId: number, emoji: string): Promise<boolean> {
  const res = await apiFetch(`${API_URL}/api/v1/posts/${postId}/reactions/${encodeURIComponent(emoji)}`, {
    method: 'DELETE',
  })
  return res.ok
}

export async function fetchReactions(postId: number): Promise<ReactionSummary[]> {
  const res = await apiFetch(`${API_URL}/api/v1/posts/${postId}/reactions`)
  if (!res.ok) return []
  const data = await res.json()
  // Normalize: backend returns {counts: [{emoji, count}], user_reactions: [emoji]}
  const userReactions = new Set(data.user_reactions || [])
  return (data.counts || []).map((c: { emoji: string; count: number }) => ({
    emoji: c.emoji,
    count: c.count,
    reacted: userReactions.has(c.emoji),
  }))
}

// ── Image Upload ───────────────────────────────────────────────────────

export async function uploadImage(file: File): Promise<{ url: string; filename: string; size: number }> {
  const formData = new FormData()
  formData.append('file', file)
  const res = await fetch(`${API_URL}/api/v1/uploads/image`, {
    method: 'POST',
    credentials: 'include',
    body: formData,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Upload failed' }))
    throw new Error(err.detail || 'Upload failed')
  }
  return res.json()
}

// ── User Profile ───────────────────────────────────────────────────────

export async function updateProfile(data: { bio?: string; trading_style?: string; experience?: string; avatar_url?: string; full_name?: string }) {
  const res = await apiFetch(`${API_URL}/api/v1/users/me/profile`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error('Failed to update profile')
  return res.json()
}

export async function fetchUserComments(userId: number | string, cursor?: number) {
  const params = new URLSearchParams({ limit: '20' })
  if (cursor) params.set('cursor', String(cursor))
  const res = await apiFetch(`${API_URL}/api/v1/users/${userId}/comments?${params}`)
  if (!res.ok) return { comments: [], next_cursor: null }
  return res.json()
}

// ── Post Management ────────────────────────────────────────────────────

export async function togglePinPost(postId: number) {
  const res = await apiFetch(`${API_URL}/api/v1/posts/${postId}/pin`, { method: 'POST' })
  if (!res.ok) throw new Error('Failed to toggle pin')
  return res.json() as Promise<{ post_id: number; is_pinned: boolean }>
}

export async function toggleLockPost(postId: number) {
  const res = await apiFetch(`${API_URL}/api/v1/posts/${postId}/lock`, { method: 'POST' })
  if (!res.ok) throw new Error('Failed to toggle lock')
  return res.json() as Promise<{ post_id: number; is_locked: boolean }>
}

// ── Moderation API ──────────────────────────────────────────────────────

export async function fetchModerationQueue(status: string = 'pending') {
  const res = await apiFetch(`${API_URL}/api/v1/moderation/queue?status=${status}`)
  if (!res.ok) return { items: [] }
  return res.json()
}

export async function moderationAction(reportId: number, action: string, reason?: string) {
  const res = await apiFetch(`${API_URL}/api/v1/moderation/action/${reportId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, reason }),
  })
  return res.ok
}

export async function reportContent(targetId: number, targetType: string, reason: string, description?: string) {
  const res = await apiFetch(`${API_URL}/api/v1/reports`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target_id: targetId, target_type: targetType, reason, description }),
  })
  return res.ok
}

// ── User Profile API ────────────────────────────────────────────────────

export async function fetchUserProfile(username: string) {
  const res = await apiFetch(`${API_URL}/api/v1/users/by-username/${encodeURIComponent(username)}`)
  if (!res.ok) return null
  const data = await res.json()
  // Normalize field names between backend response and frontend expectations
  return {
    ...data,
    display_name: data.display_name || data.full_name || data.username,
    posts_count: data.posts_count ?? data.post_count ?? 0,
    followers_count: data.followers_count ?? data.follower_count ?? 0,
    following_count: data.following_count ?? data.following_count ?? 0,
    joined_at: data.joined_at || data.created_at,
    badges: data.badges || [],
    is_following: data.is_following ?? false,
  }
}

export async function fetchUserPosts(username: string, cursor?: number) {
  const params = new URLSearchParams({ limit: '20' })
  if (cursor) params.set('cursor', String(cursor))
  const res = await apiFetch(`${API_URL}/api/v1/users/by-username/${encodeURIComponent(username)}/posts?${params}`)
  if (!res.ok) return { posts: [] }
  const data = await res.json()
  return { posts: data.items || data.posts || [], next_cursor: data.next_cursor }
}

export async function followUser(userId: number) {
  const res = await apiFetch(`${API_URL}/api/v1/users/${userId}/follow`, { method: 'POST' })
  return res.ok
}

export async function unfollowUser(userId: number) {
  const res = await apiFetch(`${API_URL}/api/v1/users/${userId}/follow`, { method: 'DELETE' })
  return res.ok
}

// ── Direct Messages (DM) ────────────────────────────────────────────

export interface DMConversation {
  id: number
  other_user: { id: number; username: string; avatar_url?: string | null }
  last_message_preview: string | null
  last_message_at: string | null
  message_count: number
  unread: boolean
}

export interface DMMessage {
  id: number
  sender_id: number
  sender_username: string
  body: string
  parent_id: number | null
  is_edited: boolean
  created_at: string
}

export async function fetchDMConversations(limit = 20, offset = 0): Promise<{ conversations: DMConversation[] }> {
  const res = await apiFetch(`${API_URL}/api/v1/messages/conversations?limit=${limit}&offset=${offset}`)
  if (!res.ok) return { conversations: [] }
  return res.json()
}

export async function createDMConversation(recipientId: number, message: string): Promise<{ conversation_id?: number; message_id?: number; error?: string }> {
  const res = await apiFetch(`${API_URL}/api/v1/messages/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient_id: recipientId, message }),
  })
  return res.json()
}

export async function fetchDMMessages(conversationId: number, limit = 50, beforeId?: number): Promise<{ messages: DMMessage[]; has_more: boolean }> {
  let url = `${API_URL}/api/v1/messages/conversations/${conversationId}?limit=${limit}`
  if (beforeId) url += `&before_id=${beforeId}`
  const res = await apiFetch(url)
  if (!res.ok) return { messages: [], has_more: false }
  return res.json()
}

export async function sendDMMessage(conversationId: number, body: string, parentId?: number): Promise<{ message_id?: number; created_at?: string }> {
  const res = await apiFetch(`${API_URL}/api/v1/messages/conversations/${conversationId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body, parent_id: parentId || null }),
  })
  return res.json()
}

export async function fetchUnreadDMCount(): Promise<number> {
  const res = await apiFetch(`${API_URL}/api/v1/messages/unread`)
  if (!res.ok) return 0
  const data = await res.json()
  return data.unread || 0
}

export async function blockDMUser(userId: number): Promise<boolean> {
  const res = await apiFetch(`${API_URL}/api/v1/messages/block/${userId}`, { method: 'POST' })
  return res.ok
}

export async function unblockDMUser(userId: number): Promise<boolean> {
  const res = await apiFetch(`${API_URL}/api/v1/messages/block/${userId}`, { method: 'DELETE' })
  return res.ok
}

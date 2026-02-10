/**
 * API client for backend communication
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

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
  end?: string
): Promise<PriceBar[]> {
  const url = new URL(`${API_URL}/api/v1/prices/${symbol}`)
  if (start) url.searchParams.append('start', start)
  if (end) url.searchParams.append('end', end)
  
  const response = await fetch(url.toString())
  if (!response.ok) {
    throw new Error('Failed to fetch prices')
  }
  return response.json()
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
    
    const response = await fetch(url.toString())
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

// Breaking market news
export async function fetchBreakingMarketNews(
  limit: number = 10
): Promise<NewsArticle[]> {
  try {
    const url = new URL(`${API_URL}/api/v1/enhanced/news/market/breaking`)
    url.searchParams.append('limit', limit.toString())
    
    const response = await fetch(url.toString())
    const data = await parseJsonSafe<NewsArticle[]>(response)
    if (data) return data
    if (!response.ok) {
      throw new Error('Failed to fetch breaking news')
    }
    return []
  } catch (error) {
    console.error('Error fetching breaking news:', error)
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
}

export interface ChatResponse {
  response: string
  sources: string[]
  context_docs: number
  symbol?: string
  session_id?: string
}

export async function sendChatMessage(message: ChatMessage): Promise<ChatResponse> {
  try {
    // Attach auth headers if user is logged in so chat history can be tied to user
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    
    // Only get auth headers on client side
    if (typeof window !== 'undefined') {
      const { getAuthHeaders } = await import('./auth')
      Object.assign(headers, getAuthHeaders())
    }

    const response = await fetch(`${API_URL}/api/v1/chat`, {
      method: 'POST',
      headers,
      body: JSON.stringify(message),
    })
    
    if (!response.ok) {
      throw new Error('Failed to send chat message')
    }
    return response.json()
  } catch (error) {
    console.error('Error sending chat message:', error)
    throw error
  }
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
  note: string | null
  source: string | null
  added_at: string
  updated_at: string | null
}

export interface AddWatchlistParams {
  symbol: string
  note?: string
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
    
    const { getAuthHeaders } = await import('./auth')
    const headers = getAuthHeaders()
    if (!headers.Authorization) {
      return []
    }
    
    const response = await fetch(`${API_URL}/api/v1/watchlist`, {
      headers
    })
    
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
  
  const { getAuthHeaders } = await import('./auth')
  const headers = getAuthHeaders()
  
  if (!headers.Authorization) {
    throw new Error('Please sign in to add items to your watchlist')
  }
  
  const response = await fetch(`${API_URL}/api/v1/watchlist`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers
    },
    body: JSON.stringify({
      symbol: params.symbol.trim().toUpperCase(),
      note: params.note,
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
  
  const { getAuthHeaders } = await import('./auth')
  const headers = getAuthHeaders()
  
  if (!headers.Authorization) {
    throw new Error('Please sign in to manage your watchlist')
  }
  
  const response = await fetch(`${API_URL}/api/v1/watchlist/${encodeURIComponent(symbol.toUpperCase())}`, {
    method: 'DELETE',
    headers
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

/**
 * Update note for a watchlist item
 * @throws Error with message for UI display
 */
export async function updateWatchlistNote(symbol: string, note: string | null): Promise<WatchlistItem> {
  if (typeof window === 'undefined') {
    throw new Error('Client-side only')
  }
  
  const { getAuthHeaders } = await import('./auth')
  const headers = getAuthHeaders()
  
  if (!headers.Authorization) {
    throw new Error('Please sign in to manage your watchlist')
  }
  
  const response = await fetch(`${API_URL}/api/v1/watchlist/${encodeURIComponent(symbol.toUpperCase())}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...headers
    },
    body: JSON.stringify({ note })
  })
  
  if (!response.ok) {
    const error: WatchlistError = await response.json().catch(() => ({ detail: 'Failed to update note' }))
    
    if (response.status === 404) {
      throw new Error(`${symbol.toUpperCase()} is not in your watchlist`)
    }
    throw new Error(error.detail || 'Failed to update note')
  }
  
  return response.json()
}

// Phase 4: Backtesting
export interface BacktestRequest {
  symbol: string
  start_date: string
  end_date: string
  strategy: string
  initial_capital: number
}

export interface BacktestResult {
  symbol: string
  strategy: string
  initial_capital: number
  final_equity: number
  total_return: number
  total_trades: number
  win_rate: number
  max_drawdown: number
  sharpe_ratio: number
  equity_curve: number[]
  trades: any[]
}

export async function runBacktest(request: BacktestRequest): Promise<BacktestResult> {
  const response = await fetch(`${API_URL}/api/v1/backtest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  })
  if (!response.ok) {
    throw new Error('Failed to run backtest')
  }
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

export interface MarketIndex {
  symbol: string
  name: string
  price: number
  change: number
  change_percent: number
  timestamp: string
}

export async function fetchMarketIndices(): Promise<MarketIndex[]> {
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
    const response = await fetch(`${API_URL}/api/v1/market/sectors`)
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

export async function fetchMarketMovers(): Promise<MarketMovers> {
  try {
    // Try enhanced endpoint first for faster real-time data
    const response = await fetch(`${API_URL}/api/v1/market/movers`)
    const data = await parseJsonSafe<MarketMovers>(response)
    if (data) return data
    if (!response.ok) {
      console.error('Failed to fetch market movers:', response.status, response.statusText)
      return {
        gainers: [],
        losers: [],
        updated_at: new Date().toISOString()
      }
    }
    return {
      gainers: [],
      losers: [],
      updated_at: new Date().toISOString()
    }
  } catch (error) {
    console.error('Error fetching market movers:', error)
    return {
      gainers: [],
      losers: [],
      updated_at: new Date().toISOString()
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

export async function fetchTopGainers(limit: number = 10): Promise<StockPerformance[]> {
  const url = new URL(`${API_URL}/api/v1/market/gainers`)
  url.searchParams.append('limit', limit.toString())
  
  const response = await fetch(url.toString())
  if (!response.ok) {
    throw new Error('Failed to fetch top gainers')
  }
  return response.json()
}

export async function fetchTopLosers(limit: number = 10): Promise<StockPerformance[]> {
  const url = new URL(`${API_URL}/api/v1/market/losers`)
  url.searchParams.append('limit', limit.toString())
  
  const response = await fetch(url.toString())
  if (!response.ok) {
    throw new Error('Failed to fetch top losers')
  }
  return response.json()
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

  const response = await fetch(`${API_URL}/api/v1/billing/checkout-session`, {
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

  const response = await fetch(`${API_URL}/api/v1/billing/portal`, {
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

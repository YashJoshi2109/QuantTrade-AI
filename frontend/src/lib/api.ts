/**
 * API client for backend communication
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export interface Symbol {
  id: number
  symbol: string
  name: string | null
  sector: string | null
  industry: string | null
  market_cap: number | null
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
    if (!response.ok) {
      throw new Error('Failed to fetch real-time news')
    }
    return response.json()
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
    if (!response.ok) {
      throw new Error('Failed to fetch yfinance news')
    }
    return response.json()
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
    if (!response.ok) {
      throw new Error('Failed to fetch breaking news')
    }
    return response.json()
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

export async function getWatchlist(): Promise<any[]> {
  try {
    // Only get auth headers on client side
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
        // Not authenticated - return empty array
        return []
      }
      throw new Error('Failed to fetch watchlist')
    }
    return response.json()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!message.includes('Failed to fetch')) {
      console.error('Error fetching watchlist:', error)
    }
    return []
  }
}

export async function addToWatchlist(symbol: string): Promise<any> {
  try {
    // Only on client side
    if (typeof window === 'undefined') {
      throw new Error('Client-side only')
    }
    
    const { getAuthHeaders } = await import('./auth')
    const headers = getAuthHeaders()
    
    const response = await fetch(`${API_URL}/api/v1/watchlist`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers
      },
      body: JSON.stringify({ symbol }),
    })
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Failed to add to watchlist' }))
      throw new Error(error.detail || 'Failed to add to watchlist')
    }
    return response.json()
  } catch (error) {
    console.error('Error adding to watchlist:', error)
    throw error
  }
}

export async function removeFromWatchlist(symbol: string): Promise<any> {
  try {
    // Only on client side
    if (typeof window === 'undefined') {
      throw new Error('Client-side only')
    }
    
    const { getAuthHeaders } = await import('./auth')
    const headers = getAuthHeaders()
    
    const response = await fetch(`${API_URL}/api/v1/watchlist/${symbol}`, {
      method: 'DELETE',
      headers
    })
    
    if (!response.ok) {
      throw new Error('Failed to remove from watchlist')
    }
    return response.json()
  } catch (error) {
    console.error('Error removing from watchlist:', error)
    throw error
  }
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
    if (response.ok) {
      const data = await response.json()
      return {
      symbol: data.symbol || symbol.toUpperCase(),
      price: data.last_price || data.price || 0,
      change: data.change || 0,
      change_percent: data.change_percent || 0,
      volume: data.volume || 0,
      high: data.high_price || data.high || 0,
      low: data.low_price || data.low || 0,
      open: data.open_price || data.open || 0,
      previous_close: data.previous_close || 0,
      timestamp: data.quote_timestamp || data.updated_at || new Date().toISOString(),
      bid_price: data.bid_price,
      ask_price: data.ask_price,
      market_status: data.market_status,
      data_source: data.data_source,
      latency_ms: data.latency_ms
      }
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
  eps?: number
  dividend_yield?: number
  beta?: number
  week_52_high?: number
  week_52_low?: number
}

// Fetch quote from Finnhub with priority parameter
export async function fetchFinnhubQuote(symbol: string, priority: 'high' | 'normal' = 'high'): Promise<QuoteData> {
  try {
    const response = await fetch(`${API_URL}/api/v1/enhanced/quote/${symbol}/finnhub?priority=${priority}`)
    if (response.ok) {
      const data = await response.json()
      return {
        symbol: data.symbol || symbol.toUpperCase(),
        price: data.current_price || 0,
        change: data.change || 0,
        change_percent: data.change_percent || 0,
        volume: data.volume || 0,
        high: data.high || 0,
        low: data.low || 0,
        open: data.open || 0,
        previous_close: data.previous_close || 0,
        timestamp: data.timestamp || new Date().toISOString(),
        data_source: 'finnhub',
        latency_ms: 50
      }
    }
    throw new Error('Failed to fetch Finnhub quote')
  } catch (error) {
    console.error('Error fetching Finnhub quote:', error)
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
    if (!response.ok) {
      console.error('Failed to fetch sector performance:', response.status, response.statusText)
      // Return empty array on error instead of throwing
      return []
    }
    return response.json()
  } catch (error) {
    console.error('Error fetching sector performance:', error)
    return []
  }
}

export async function fetchHeatmapData(): Promise<HeatmapData> {
  const response = await fetch(`${API_URL}/api/v1/market/heatmap`)
  if (!response.ok) {
    throw new Error('Failed to fetch heatmap data')
  }
  return response.json()
}

export async function fetchMarketMovers(): Promise<MarketMovers> {
  try {
    // Try enhanced endpoint first for faster real-time data
    const response = await fetch(`${API_URL}/api/v1/market/movers`)
    if (!response.ok) {
      console.error('Failed to fetch market movers:', response.status, response.statusText)
      // Return empty movers on error
      return {
        gainers: [],
        losers: [],
        updated_at: new Date().toISOString()
      }
    }
    return response.json()
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
  if (!response.ok) {
    // Return default closed status on error
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
  return response.json()
}

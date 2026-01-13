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
}

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
}

export interface ChatResponse {
  response: string
  sources: string[]
  context_docs: number
  symbol?: string
}

export async function sendChatMessage(message: ChatMessage): Promise<ChatResponse> {
  const response = await fetch(`${API_URL}/api/v1/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(message),
  })
  if (!response.ok) {
    throw new Error('Failed to send chat message')
  }
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

export async function getWatchlist(userId: string = 'default'): Promise<any[]> {
  const response = await fetch(`${API_URL}/api/v1/watchlist?user_id=${userId}`)
  if (!response.ok) {
    throw new Error('Failed to fetch watchlist')
  }
  return response.json()
}

export async function addToWatchlist(symbol: string, userId: string = 'default'): Promise<any> {
  const response = await fetch(`${API_URL}/api/v1/watchlist?user_id=${userId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ symbol }),
  })
  if (!response.ok) {
    throw new Error('Failed to add to watchlist')
  }
  return response.json()
}

export async function removeFromWatchlist(symbol: string, userId: string = 'default'): Promise<any> {
  const response = await fetch(`${API_URL}/api/v1/watchlist/${symbol}?user_id=${userId}`, {
    method: 'DELETE',
  })
  if (!response.ok) {
    throw new Error('Failed to remove from watchlist')
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

// Quote API for live prices
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
}

export async function fetchQuote(symbol: string): Promise<QuoteData> {
  const response = await fetch(`${API_URL}/api/v1/prices/${symbol}/quote`)
  if (!response.ok) {
    // Return mock data if API fails
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
  return response.json()
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
  const response = await fetch(`${API_URL}/api/v1/market/sectors`)
  if (!response.ok) {
    throw new Error('Failed to fetch sector performance')
  }
  return response.json()
}

export async function fetchHeatmapData(): Promise<HeatmapData> {
  const response = await fetch(`${API_URL}/api/v1/market/heatmap`)
  if (!response.ok) {
    throw new Error('Failed to fetch heatmap data')
  }
  return response.json()
}

export async function fetchMarketMovers(): Promise<MarketMovers> {
  const response = await fetch(`${API_URL}/api/v1/market/movers`)
  if (!response.ok) {
    throw new Error('Failed to fetch market movers')
  }
  return response.json()
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

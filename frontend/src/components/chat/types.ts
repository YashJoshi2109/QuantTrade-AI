import type { StockPerformance, SectorPerformance } from '@/lib/api'

export type AIResponseType = 'stock_analysis' | 'comparison' | 'screener' | 'sector' | 'text'

export interface TechnicalSignal {
  trend: 'bullish' | 'bearish' | 'neutral'
  confidence: number
  bullish_pct?: number
  signals: Array<{
    name: string
    signal: 'bullish' | 'bearish' | 'neutral'
    weight: number
  }>
}

export interface RegimeData {
  regime: 'BULLISH' | 'BEARISH' | 'NEUTRAL'
  confidence: number
  probabilities: {
    BULLISH: number
    BEARISH: number
    NEUTRAL: number
  }
}

export interface SentimentData {
  overall: 'positive' | 'negative' | 'neutral'
  score: number
  analyst_recommendation?: string | null
  target_price?: number | null
  target_upside?: number | null
}

export interface MonteCarloForecast {
  current_price: number
  days: number
  num_simulations: number
  expected_price: number
  expected_return_pct: number
  percentiles: {
    p5: number
    p10: number
    p25: number
    p50: number
    p75: number
    p90: number
    p95: number
  }
  probabilities: {
    price_up: number
    price_down: number
    gain_5pct: number
    gain_10pct: number
    gain_20pct: number
    loss_5pct: number
    loss_10pct: number
    loss_20pct: number
  }
  confidence_intervals: {
    '80': { lower: number; upper: number }
    '95': { lower: number; upper: number }
  }
  min_price: number
  max_price: number
  historical_days?: number
  mean_daily_return?: number
  daily_volatility?: number
  annualized_volatility?: number
  sample_paths?: number[][]
}

export interface MonteCarloData {
  forecast_30d?: MonteCarloForecast
  forecast_90d?: MonteCarloForecast
}

export interface EnhancedRiskFactors {
  sharpe_ratio: number
  annualized_volatility: number
  var_95: number
  beta: number
  max_drawdown_pct: number
}

export interface StockAnalysisData {
  symbol: string
  quote?: {
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
  indicators?: {
    current_price?: number | null
    sma_20?: number | null
    sma_50?: number | null
    sma_200?: number | null
    rsi?: number | null
    macd?: { macd: number | null; signal: number | null; histogram: number | null }
    bollinger_bands?: { upper: number | null; middle: number | null; lower: number | null }
  }
  fundamentals?: {
    market_cap?: number | null
    pe_ratio?: number | null
    forward_pe?: number | null
    peg_ratio?: number | null
    price_to_book?: number | null
    eps?: number | null
    beta?: number | null
    rsi?: number | null
    dividend_yield?: number | null
    week_52_high?: number | null
    week_52_low?: number | null
    profit_margin?: number | null
    operating_margin?: number | null
    roe?: number | null
    roa?: number | null
    debt_to_equity?: number | null
    current_ratio?: number | null
    target_price?: number | null
    recommendation?: string | null
    earnings_date?: string | null
    revenue?: number | null
    volume?: number | null
    avg_volume?: number | null
  }
  risk?: {
    risk_score: number
    risk_level: string
    factors: {
      volatility: number
      max_drawdown: number
      beta: number
      rsi: number | null
    }
    breakdown?: {
      volatility_contribution: number
      drawdown_contribution: number
      beta_contribution: number
      momentum_contribution: number
    }
    enhanced?: EnhancedRiskFactors
  }
  company?: {
    name: string | null
    sector: string | null
    industry: string | null
    market_cap: number | null
  }
  prediction?: {
    summary: string
  }
  technical_signal?: TechnicalSignal
  regime?: RegimeData
  sentiment?: SentimentData
  monte_carlo?: MonteCarloData
}

export interface ComparisonData {
  stocks: StockAnalysisData[]
}

export interface ScreenerData {
  gainers: StockPerformance[]
  losers: StockPerformance[]
}

export interface SectorData {
  sectors: SectorPerformance[]
}

export type StructuredData = StockAnalysisData | ComparisonData | ScreenerData | SectorData

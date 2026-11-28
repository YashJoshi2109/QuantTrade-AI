/**
 * Shapes of the backend payloads the /stocks/{SYMBOL} page reads. Only the
 * fields the page uses are typed; every one is optional because any source can
 * be missing, and the page skips a sentence rather than invent a number.
 */

export interface IdentityPayload {
  ticker?: string
  listed_name?: string | null
  filer_name?: string | null
  known_symbol?: boolean
  lifecycle_status?: 'active' | 'inactive' | 'reused' | string
  is_active?: boolean
  current_name?: string | null
  status_note?: string | null
  retirement_kind?: string | null
}

export interface SymbolPayload {
  symbol?: string
  name?: string | null
  sector?: string | null
  industry?: string | null
}

export interface QuotePayload {
  symbol?: string
  price?: number | null
  change?: number | null
  change_percent?: number | null
  volume?: number | null
  previous_close?: number | null
  data_source?: string | null
  as_of?: string | null
  stale?: boolean | null
  unavailable?: boolean
  regular?: {
    price: number
    previous_close: number | null
    change: number | null
    change_percent: number | null
    session_date: string
    live: boolean
  } | null
  extended?: {
    price: number
    change?: number | null
    change_percent?: number | null
    time?: string | null
    session?: string
  } | null
}

export interface FundamentalsPayload {
  asset_type?: string | null
  company_name?: string | null
  sector?: string | null
  industry?: string | null
  country?: string | null
  market_cap?: number | null
  pe_ratio?: number | null
  forward_pe?: number | null
  price_to_sales?: number | null
  price_to_book?: number | null
  profit_margin?: number | null
  operating_margin?: number | null
  gross_margin?: number | null
  roe?: number | null
  dividend_yield?: number | null
  debt_to_equity?: number | null
  beta?: number | null
  week_52_high?: number | null
  week_52_low?: number | null
  eps?: number | null
  earnings_date?: string | null
  target_price?: number | null
  recommendation?: string | null
  fetched_at?: string | null
  data_quality?: string | null
}

export interface IndicatorsPayload {
  indicators?: {
    current_price?: number | null
    sma_20?: number | null
    sma_50?: number | null
    sma_200?: number | null
    rsi?: number | null
    macd?: { macd?: number | null; signal?: number | null; histogram?: number | null } | null
    data_source?: string | null
  }
}

export interface EarningsNextPayload {
  date?: string | null
  hour_label?: string | null
  days_until?: number | null
  eps_estimate?: number | null
  revenue_estimate?: number | null
  fiscal_period?: string | null
}

export interface EarningsHistoryPayload {
  available?: boolean
  quarters?: Array<{
    period: string
    label?: string
    eps_actual?: number | null
    eps_estimate?: number | null
    surprise_pct?: number | null
  }>
  source?: string | null
}

export interface DividendsPayload {
  available?: boolean
  payments?: Array<{ ex_date: string; amount: number }>
  ttm_total?: number | null
  ttm_count?: number | null
  frequency_label?: string | null
  next_ex_date?: string | null
  next_pay_date?: string | null
  source?: string | null
}

export interface InsiderWindow {
  days: number
  buy_transactions: number
  sell_transactions: number
  buy_value: number
  sell_value: number
  net_value: number
  distinct_buyers: number
  distinct_sellers: number
  sells_under_10b5_1_plan?: number
}

export interface InsidersPayload {
  status?: string
  summary?: Record<string, InsiderWindow>
  transactions?: Array<{
    date: string
    insider: string
    title?: string | null
    code?: string
    type?: string
    shares?: number | null
    price?: number | null
    value?: number | null
    url?: string | null
    plan_10b5_1?: boolean
  }>
  latest_filing?: string | null
  attribution?: { text?: string; url?: string } | null
}

export interface InstitutionalPayload {
  status?: string
  period?: string | null
  holders?: number | null
  total_shares?: number | null
  total_value_usd?: number | null
  qoq?: { holders_change?: number | null; shares_change_pct?: number | null } | null
  top_holders?: Array<{ filer: string; shares: number; value_usd: number; change_pct?: number | null; status?: string }>
  attribution?: { text?: string; url?: string } | null
}

export interface NewsItem {
  title: string
  url: string
  source?: string | null
  published_at?: string | null
}

export interface ForecastHorizon {
  h: number
  label: string
  date: string
  range_80: [number, number]
  range_80_pct?: [number, number]
  edge?: boolean
  edge_text?: string
  hit_rate_80?: number | null
  hit_rate_tests?: number | null
  calibration?: string
}

export interface ForecastSummary {
  as_of?: string
  last_close?: number
  vol_annualized_pct?: number | null
  benchmark?: string
  any_edge?: boolean
  label?: string
  horizons?: ForecastHorizon[]
  ml_gate?: { promoted?: boolean; note?: string } | null
}

export interface CompanyOverviewPayload {
  cik?: string | null
  company_name?: string | null
  sic_description?: string | null
  state_of_incorporation?: string | null
  fiscal_year_end?: string | null
  category?: string | null
}

export interface PriceBar {
  timestamp: string
  close: number
}

export interface StockPageData {
  symbol: string
  identity: IdentityPayload | null
  symbolRow: SymbolPayload | null
  quote: QuotePayload | null
  fundamentals: FundamentalsPayload | null
  indicators: IndicatorsPayload | null
  earningsNext: EarningsNextPayload | null
  earningsHistory: EarningsHistoryPayload | null
  dividends: DividendsPayload | null
  insiders: InsidersPayload | null
  institutional: InstitutionalPayload | null
  news: NewsItem[]
  forecast: ForecastSummary | null
  overview: CompanyOverviewPayload | null
  bars: PriceBar[]
  /** when this page's data was assembled (UTC ISO) */
  fetchedAt: string
}

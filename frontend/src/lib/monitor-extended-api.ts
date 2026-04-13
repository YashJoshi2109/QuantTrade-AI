/**
 * Extended Global Monitor API Client
 * Market Radar, Economic Indicators, Trade Policy, Continent News,
 * Polymarket Finance, ACLED, Energy, Internet Outages
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || ''

// ─── Market Radar ────────────────────────────────────────────

export interface MarketRadarSignal {
  name: string
  status: string
  status_color: string
  value?: string
  detail?: string
  sparkline?: number[]
}

export interface MarketRadarData {
  overall_signal: string
  bullish_count: number
  total_signals: number
  signals: MarketRadarSignal[]
  fear_greed_index?: number
  fear_greed_label?: string
  updated_at: string
}

export async function fetchMarketRadar(): Promise<MarketRadarData> {
  const res = await fetch(`${API_URL}/api/v1/monitor/market-radar`)
  if (!res.ok) throw new Error('Failed to fetch market radar')
  return res.json()
}

// ─── Economic Indicators ─────────────────────────────────────

export interface EconomicIndicator {
  name: string
  series_id: string
  value: string
  date: string
  change?: string
  change_direction?: string
}

export interface EconomicIndicatorsData {
  tab: string
  indicators: EconomicIndicator[]
  updated_at: string
}

export async function fetchEconomicIndicators(
  tab: string = 'indicators'
): Promise<EconomicIndicatorsData> {
  const res = await fetch(`${API_URL}/api/v1/monitor/economic-indicators?tab=${tab}`)
  if (!res.ok) throw new Error('Failed to fetch economic indicators')
  return res.json()
}

// ─── Economic Calendar ──────────────────────────────────────────

export interface EconomicCalendarEvent {
  country: string
  country_code: string
  time: string
  event_name: string
  actual: string | null
  forecast: string | null
  prior: string | null
  impact: 'high' | 'medium' | 'low'
  unit?: string | null
}

export async function fetchEconomicCalendar(): Promise<{ events: EconomicCalendarEvent[]; updated_at: string }> {
  const res = await fetch(`${API_URL}/api/v1/monitor/economic-calendar`)
  if (!res.ok) return { events: [], updated_at: new Date().toISOString() }
  return res.json()
}

// ─── Trade Policy ────────────────────────────────────────────

export interface TradePolicy {
  title: string
  country?: string
  date: string
  description?: string
  source: string
  category?: string
  url?: string
}

export interface TradePolicyData {
  policies: TradePolicy[]
  total: number
  updated_at: string
}

export async function fetchTradePolicy(limit: number = 20): Promise<TradePolicyData> {
  const res = await fetch(`${API_URL}/api/v1/monitor/trade-policy?limit=${limit}`)
  if (!res.ok) throw new Error('Failed to fetch trade policy')
  return res.json()
}

// ─── Continent News ──────────────────────────────────────────

export interface ContinentNewsArticle {
  title: string
  source: string
  url?: string
  image_url?: string
  time_ago: string
  tags: string[]
  tickers?: string[]
  threat_level?: string
  category?: string
}

export interface ContinentNewsFeed {
  continent: string
  live: boolean
  count: number
  articles: ContinentNewsArticle[]
}

export interface ContinentNewsData {
  feeds: ContinentNewsFeed[]
  updated_at: string
}

export async function fetchContinentNews(): Promise<ContinentNewsData> {
  const res = await fetch(`${API_URL}/api/v1/monitor/continent-news`)
  if (!res.ok) throw new Error('Failed to fetch continent news')
  return res.json()
}

// ─── Polymarket Finance ──────────────────────────────────────

export interface PolymarketOutcome {
  name: string
  price: number
}

export interface PolymarketFinanceItem {
  question: string
  yes_price?: number | null
  no_price?: number | null
  outcomes?: PolymarketOutcome[]
  volume_24h?: number | null
  volume?: string
  category?: string
  slug?: string
}

export interface PolymarketFinanceData {
  stocks: PolymarketFinanceItem[]
  macro: PolymarketFinanceItem[]
  trending: PolymarketFinanceItem[]
  updated_at: string
}

export async function fetchPolymarketFinance(): Promise<PolymarketFinanceData> {
  const res = await fetch(`${API_URL}/api/v1/monitor/polymarket-finance`)
  if (!res.ok) throw new Error('Failed to fetch polymarket finance')
  return res.json()
}

/** Copilot stock card — Gamma search proxied (browser CORS blocks gamma-api.polymarket.com). */
export interface PolymarketStockEvent {
  id: string
  slug?: string
  title?: string
  question?: string
  markets?: {
    outcomes?: PolymarketOutcome[]
    volume_24hr?: number
    slug?: string
  }[]
}

export async function fetchPolymarketStockEvents(
  symbol: string,
  companyName?: string,
): Promise<PolymarketStockEvent[]> {
  const u = new URL(`${API_URL}/api/v1/monitor/polymarket-stock-events`)
  u.searchParams.set('symbol', symbol)
  if (companyName?.trim()) u.searchParams.set('company', companyName.trim())
  const res = await fetch(u.toString(), { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error('Failed to fetch Polymarket events')
  const data = (await res.json()) as { events?: PolymarketStockEvent[] }
  return Array.isArray(data.events) ? data.events : []
}

export interface PolymarketBrowseTile {
  id: string
  question: string
  yes_price?: number | null
  volume_24h?: number | null
}

export async function fetchPolymarketBrowseTiles(limit = 24): Promise<PolymarketBrowseTile[]> {
  const u = new URL(`${API_URL}/api/v1/monitor/polymarket-events-browse`)
  u.searchParams.set('limit', String(limit))
  const res = await fetch(u.toString(), { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error('Failed to fetch Polymarket browse')
  const data = (await res.json()) as { tiles?: PolymarketBrowseTile[] }
  return Array.isArray(data.tiles) ? data.tiles : []
}

// ─── ACLED Conflicts ─────────────────────────────────────────

export interface ACLEDEvent {
  event_id: string
  event_date: string
  event_type: string
  sub_event_type?: string
  country: string
  region: string
  latitude: number
  longitude: number
  fatalities: number
  notes?: string
  source?: string
}

export interface ACLEDData {
  events: ACLEDEvent[]
  total: number
  updated_at: string
}

export async function fetchACLEDConflicts(
  limit: number = 100
): Promise<ACLEDData> {
  const res = await fetch(`${API_URL}/api/v1/monitor/acled-conflicts?limit=${limit}`)
  if (!res.ok) throw new Error('Failed to fetch ACLED conflicts')
  return res.json()
}

// ─── Energy Data ─────────────────────────────────────────────

export interface EnergyDataPoint {
  name: string
  series_id: string
  value: string
  date: string
  unit: string
  change?: string
}

export interface EnergyData {
  data: EnergyDataPoint[]
  updated_at: string
}

export async function fetchEnergyData(): Promise<EnergyData> {
  const res = await fetch(`${API_URL}/api/v1/monitor/energy-data`)
  if (!res.ok) throw new Error('Failed to fetch energy data')
  return res.json()
}

// ─── Internet Outages ────────────────────────────────────────

export interface OutageEvent {
  country: string
  country_code: string
  score: number
  status: string
  timestamp: string
}

export interface OutageData {
  outages: OutageEvent[]
  updated_at: string
}

export async function fetchInternetOutages(): Promise<OutageData> {
  const res = await fetch(`${API_URL}/api/v1/monitor/internet-outages`)
  if (!res.ok) throw new Error('Failed to fetch internet outages')
  return res.json()
}

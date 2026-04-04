/**
 * Global Monitor API Client
 * Handles all API calls for global monitoring data
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export interface GlobalEvent {
  id: number
  event_id: string
  source: string
  category: string
  title: string
  description?: string
  severity?: number
  threat_level: 'critical' | 'high' | 'medium' | 'low' | 'unknown'
  latitude: number
  longitude: number
  location_name?: string
  country_code?: string
  event_timestamp: string
  keywords?: string[]
  market_impact_score?: number
  correlated_sectors?: string[]
  is_anomaly: boolean
  /**
   * Optional raw source payload, used for specialized visualizations
   * (e.g. aviation routes where departure/arrival data is needed).
   */
  raw_data?: Record<string, any> | null
}

export interface GeographicCluster {
  id: number
  cell_id: string
  cell_lat: number
  cell_lon: number
  event_count: number
  distinct_categories: number
  avg_severity?: number
  max_threat_level: string
  is_hotspot: boolean
  hotspot_score?: number
  event_ids: string[]
  category_breakdown?: Record<string, number>
  affected_tickers?: string[]
}

export interface CountryInstability {
  country_code: string
  country_name: string
  instability_index: number
  risk_level: string
  conflict_score: number
  political_score: number
  disaster_score: number
  economic_score: number
  active_event_count: number
  critical_event_count: number
  calculated_at: string
  trend?: string
}

export interface EventAnomaly {
  id: number
  anomaly_type: string
  event_category?: string
  observed_value: number
  expected_value: number
  z_score: number
  severity: string
  description?: string
  detected_at: string
  country_code?: string
}

export interface TickerImpact {
  ticker: string
  company_name?: string
  sector?: string
  impact_score: number
  correlation_type: string
  confidence: number
  expected_direction?: string
  impact_reason?: string
  related_etfs?: string[]
  peer_tickers?: string[]
  volatility_increase?: number
}

export interface MapData {
  events: GlobalEvent[]
  clusters: GeographicCluster[]
  instability: CountryInstability[]
  anomalies: EventAnomaly[]
  stats: {
    total_events: number
    critical_events: number
    high_threat_events: number
    total_hotspots: number
    countries_monitored: number
    high_risk_countries: number
    anomalies_detected: number
    last_updated: string
    time_window_hours: number
  }
}

export interface MonitorStats {
  total_active_events: number
  events_last_24h: number
  events_last_7d: number
  threat_distribution: Record<string, number>
  category_distribution: Record<string, number>
  total_countries_monitored: number
  total_hotspots: number
  last_updated: string
}

/**
 * Fetch complete map data for visualization
 */
export async function fetchMapData(
  hours: number = 24,
  includeAnomalies: boolean = true
): Promise<MapData> {
  const params = new URLSearchParams({
    hours: hours.toString(),
    include_anomalies: includeAnomalies.toString()
  })
  
  const response = await fetch(`${API_URL}/api/v1/monitor/map-data?${params}`)
  
  if (!response.ok) {
    throw new Error('Failed to fetch map data')
  }
  
  return response.json()
}

/**
 * Fetch global events with filters
 */
export async function fetchGlobalEvents(params: {
  category?: string
  threat_level?: string
  country_code?: string
  hours?: number
  limit?: number
}): Promise<GlobalEvent[]> {
  const searchParams = new URLSearchParams()
  
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) {
      searchParams.append(key, value.toString())
    }
  })
  
  const response = await fetch(`${API_URL}/api/v1/monitor/events?${searchParams}`)
  
  if (!response.ok) {
    throw new Error('Failed to fetch events')
  }
  
  return response.json()
}

/**
 * Fetch geographic hotspots
 */
export async function fetchHotspots(
  minEvents: number = 3,
  hours: number = 24
): Promise<GeographicCluster[]> {
  const params = new URLSearchParams({
    min_events: minEvents.toString(),
    hours: hours.toString()
  })
  
  const response = await fetch(`${API_URL}/api/v1/monitor/hotspots?${params}`)
  
  if (!response.ok) {
    throw new Error('Failed to fetch hotspots')
  }
  
  return response.json()
}

/**
 * Fetch country instability indices
 */
export async function fetchCountryInstability(
  minIndex: number = 0,
  riskLevel?: string
): Promise<CountryInstability[]> {
  const params = new URLSearchParams({ min_index: minIndex.toString() })
  
  if (riskLevel) {
    params.append('risk_level', riskLevel)
  }
  
  const response = await fetch(`${API_URL}/api/v1/monitor/instability?${params}`)
  
  if (!response.ok) {
    throw new Error('Failed to fetch instability data')
  }
  
  return response.json()
}

/**
 * Fetch detected anomalies
 */
export async function fetchAnomalies(
  anomalyType?: string,
  minZScore: number = 2.0,
  hours: number = 24
): Promise<EventAnomaly[]> {
  const params = new URLSearchParams({
    min_z_score: minZScore.toString(),
    hours: hours.toString()
  })
  
  if (anomalyType) {
    params.append('anomaly_type', anomalyType)
  }
  
  const response = await fetch(`${API_URL}/api/v1/monitor/anomalies?${params}`)
  
  if (!response.ok) {
    throw new Error('Failed to fetch anomalies')
  }
  
  return response.json()
}

// ── Sector → ticker map for client-side synthesis ────────────────────────────
const SECTOR_TICKERS: Record<string, string[]> = {
  energy: ['XOM', 'CVX', 'COP', 'SLB', 'OXY'],
  technology: ['NVDA', 'AAPL', 'MSFT', 'GOOGL', 'META'],
  defense: ['LMT', 'RTX', 'NOC', 'GD', 'BA'],
  financials: ['JPM', 'BAC', 'GS', 'MS', 'WFC'],
  shipping: ['ZIM', 'MATX', 'STNG', 'FRO', 'GOGL'],
  commodities: ['GLD', 'SLV', 'USO', 'UNG', 'CORN'],
  cyber: ['CRWD', 'PANW', 'ZS', 'FTNT', 'S'],
  healthcare: ['UNH', 'JNJ', 'PFE', 'ABBV', 'MRK'],
  'emerging markets': ['EEM', 'VWO', 'EWZ', 'MCHI', 'EPI'],
  infrastructure: ['CAT', 'DE', 'VMC', 'MLM', 'URI'],
  agriculture: ['ADM', 'BG', 'CORN', 'WEAT', 'SOYB'],
  aviation: ['DAL', 'UAL', 'AAL', 'LUV', 'ALK'],
  insurance: ['AIZ', 'ALL', 'TRV', 'PGR', 'HIG'],
}

const CATEGORY_TICKERS: Record<string, Array<{ ticker: string; direction: 'positive' | 'negative' | 'neutral'; reason: string }>> = {
  conflict: [
    { ticker: 'LMT', direction: 'positive', reason: 'Defense contracts increase during conflict' },
    { ticker: 'RTX', direction: 'positive', reason: 'Weapons systems demand rises' },
    { ticker: 'NOC', direction: 'positive', reason: 'Aerospace & defense beneficiary' },
    { ticker: 'XOM', direction: 'positive', reason: 'Supply disruptions lift energy prices' },
    { ticker: 'GLD', direction: 'positive', reason: 'Safe-haven demand spikes in conflict' },
    { ticker: 'TLT', direction: 'positive', reason: 'Flight to safety boosts bonds' },
  ],
  disaster: [
    { ticker: 'AIZ', direction: 'negative', reason: 'Insurance claims surge' },
    { ticker: 'ALL', direction: 'negative', reason: 'Property damage liabilities rise' },
    { ticker: 'TRV', direction: 'negative', reason: 'Catastrophe loss exposure' },
    { ticker: 'CAT', direction: 'negative', reason: 'Heavy equipment supply chain disruption' },
    { ticker: 'HD', direction: 'positive', reason: 'Reconstruction demand drives sales' },
  ],
  economic: [
    { ticker: 'JPM', direction: 'negative', reason: 'Credit risk rises in economic stress' },
    { ticker: 'GS', direction: 'negative', reason: 'Deal flow slows in downturns' },
    { ticker: 'GLD', direction: 'positive', reason: 'Safe haven asset demand increases' },
    { ticker: 'TLT', direction: 'positive', reason: 'Bonds rally on rate cut expectations' },
    { ticker: 'VIX', direction: 'positive', reason: 'Volatility spikes on uncertainty' },
  ],
  cyber: [
    { ticker: 'CRWD', direction: 'positive', reason: 'Cybersecurity spending accelerates' },
    { ticker: 'PANW', direction: 'positive', reason: 'Demand for threat prevention rises' },
    { ticker: 'ZS', direction: 'positive', reason: 'Zero-trust architecture adoption grows' },
    { ticker: 'FTNT', direction: 'positive', reason: 'Enterprise firewall solutions in demand' },
  ],
  shipping: [
    { ticker: 'ZIM', direction: 'negative', reason: 'Route disruption reduces shipping volumes' },
    { ticker: 'MATX', direction: 'negative', reason: 'Freight rates volatile on route changes' },
    { ticker: 'FDX', direction: 'negative', reason: 'Supply chain delays impact logistics' },
    { ticker: 'UPS', direction: 'negative', reason: 'Delivery network disruptions' },
  ],
  political: [
    { ticker: 'EEM', direction: 'negative', reason: 'Emerging market risk premium rises' },
    { ticker: 'GLD', direction: 'positive', reason: 'Political instability boosts safe havens' },
    { ticker: 'DXY', direction: 'positive', reason: 'Dollar strengthens on uncertainty' },
  ],
  climate: [
    { ticker: 'NEE', direction: 'positive', reason: 'Clean energy transition accelerates' },
    { ticker: 'ENPH', direction: 'positive', reason: 'Solar adoption benefits from climate action' },
    { ticker: 'XOM', direction: 'negative', reason: 'Fossil fuel demand faces headwinds' },
  ],
}

/**
 * Synthesize ticker impacts from event metadata (client-side fallback).
 * Used when the backend endpoint returns empty or fails.
 */
export function synthesizeTickerImpacts(event: GlobalEvent, limit: number = 15): TickerImpact[] {
  const map = new Map<string, TickerImpact>()
  const baseScore = event.market_impact_score ?? 30
  const weight = event.threat_level === 'critical' ? 1.5 : event.threat_level === 'high' ? 1.2 : 1.0

  // From category-specific tickers
  const catTickers = CATEGORY_TICKERS[event.category] ?? []
  catTickers.forEach(({ ticker, direction, reason }) => {
    map.set(ticker, {
      ticker,
      impact_score: Math.min(95, Math.round(baseScore * weight)),
      correlation_type: 'category',
      confidence: event.threat_level === 'critical' ? 0.85 : event.threat_level === 'high' ? 0.75 : 0.65,
      expected_direction: direction,
      impact_reason: reason,
    })
  })

  // From correlated sectors
  ;(event.correlated_sectors ?? []).forEach((sector) => {
    const tickers = SECTOR_TICKERS[sector.toLowerCase()] ?? []
    tickers.forEach((ticker) => {
      if (!map.has(ticker)) {
        map.set(ticker, {
          ticker,
          impact_score: Math.min(80, Math.round(baseScore * weight * 0.8)),
          correlation_type: 'sector',
          confidence: 0.6,
          expected_direction: 'neutral',
          impact_reason: `Exposure via ${sector} sector`,
        })
      }
    })
  })

  return Array.from(map.values())
    .sort((a, b) => b.impact_score - a.impact_score)
    .slice(0, limit)
}

/**
 * Fetch ticker impact for a specific event.
 * Falls back to client-side synthesis if the endpoint returns nothing.
 */
export async function fetchTickerImpact(
  eventId: string,
  limit: number = 20,
  event?: GlobalEvent
): Promise<TickerImpact[]> {
  try {
    const params = new URLSearchParams({ limit: limit.toString() })
    const response = await fetch(`${API_URL}/api/v1/monitor/ticker-impact/${eventId}?${params}`)

    if (response.ok) {
      const data: TickerImpact[] = await response.json()
      if (data && data.length > 0) return data
    }
  } catch {
    // Network error — fall through to synthesis
  }

  // Synthesize from event metadata if provided
  if (event) {
    return synthesizeTickerImpacts(event, limit)
  }

  return []
}

/**
 * Fetch monitor statistics
 */
export async function fetchMonitorStats(): Promise<MonitorStats> {
  const response = await fetch(`${API_URL}/api/v1/monitor/stats`)
  
  if (!response.ok) {
    throw new Error('Failed to fetch monitor stats')
  }
  
  return response.json()
}

/**
 * Check monitor health
 */
export async function fetchMonitorHealth(): Promise<{
  status: string
  data_sources: Record<string, any>
  timestamp: string
}> {
  const response = await fetch(`${API_URL}/api/v1/monitor/health`)
  
  if (!response.ok) {
    throw new Error('Failed to fetch monitor health')
  }
  
  return response.json()
}

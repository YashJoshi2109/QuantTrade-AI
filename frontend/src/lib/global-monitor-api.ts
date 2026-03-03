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

/**
 * Fetch ticker impact for a specific event
 */
export async function fetchTickerImpact(
  eventId: string,
  limit: number = 20
): Promise<TickerImpact[]> {
  const params = new URLSearchParams({ limit: limit.toString() })
  
  const response = await fetch(`${API_URL}/api/v1/monitor/ticker-impact/${eventId}?${params}`)
  
  if (!response.ok) {
    throw new Error('Failed to fetch ticker impact')
  }
  
  return response.json()
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

/**
 * World Exchanges & Global Indices
 * Covers ~53,795 publicly listed companies across all major exchanges
 */

export type Continent = 'global' | 'americas' | 'europe' | 'asia' | 'africa' | 'oceania'

export interface Exchange {
  id: string
  name: string
  shortName: string
  country: string
  countryCode: string
  continent: Continent
  currency: string
  timezone: string
  openTime: string  // local HH:MM
  closeTime: string // local HH:MM
  mainIndex: string   // Yahoo Finance symbol
  indices: ExchangeIndex[]
  color: string
}

export interface ExchangeIndex {
  symbol: string  // Yahoo Finance symbol
  name: string
  shortName: string
}

export const WORLD_EXCHANGES: Exchange[] = [
  // ── AMERICAS ──────────────────────────────────────────────────────────
  {
    id: 'nyse',
    name: 'New York Stock Exchange',
    shortName: 'NYSE',
    country: 'United States',
    countryCode: 'US',
    continent: 'americas',
    currency: 'USD',
    timezone: 'America/New_York',
    openTime: '09:30',
    closeTime: '16:00',
    mainIndex: '^DJI',
    color: '#007AFF',
    indices: [
      { symbol: '^DJI', name: 'Dow Jones Industrial Average', shortName: 'DJIA' },
      { symbol: '^GSPC', name: 'S&P 500', shortName: 'SPX' },
    ],
  },
  {
    id: 'nasdaq',
    name: 'NASDAQ',
    shortName: 'NASDAQ',
    country: 'United States',
    countryCode: 'US',
    continent: 'americas',
    currency: 'USD',
    timezone: 'America/New_York',
    openTime: '09:30',
    closeTime: '16:00',
    mainIndex: '^IXIC',
    color: '#5AC8FA',
    indices: [
      { symbol: '^IXIC', name: 'NASDAQ Composite', shortName: 'COMP' },
      { symbol: '^NDX', name: 'NASDAQ 100', shortName: 'NDX' },
    ],
  },
  {
    id: 'tsx',
    name: 'Toronto Stock Exchange',
    shortName: 'TSX',
    country: 'Canada',
    countryCode: 'CA',
    continent: 'americas',
    currency: 'CAD',
    timezone: 'America/Toronto',
    openTime: '09:30',
    closeTime: '16:00',
    mainIndex: '^GSPTSE',
    color: '#FF3B30',
    indices: [
      { symbol: '^GSPTSE', name: 'S&P/TSX Composite', shortName: 'TSX' },
    ],
  },
  {
    id: 'b3',
    name: 'B3 — Brasil Bolsa Balcão',
    shortName: 'B3',
    country: 'Brazil',
    countryCode: 'BR',
    continent: 'americas',
    currency: 'BRL',
    timezone: 'America/Sao_Paulo',
    openTime: '10:00',
    closeTime: '17:55',
    mainIndex: '^BVSP',
    color: '#34C759',
    indices: [
      { symbol: '^BVSP', name: 'Ibovespa', shortName: 'IBOV' },
    ],
  },
  {
    id: 'bmv',
    name: 'Bolsa Mexicana de Valores',
    shortName: 'BMV',
    country: 'Mexico',
    countryCode: 'MX',
    continent: 'americas',
    currency: 'MXN',
    timezone: 'America/Mexico_City',
    openTime: '08:30',
    closeTime: '15:00',
    mainIndex: '^MXX',
    color: '#FF9500',
    indices: [
      { symbol: '^MXX', name: 'IPC (Índice de Precios y Cotizaciones)', shortName: 'IPC' },
    ],
  },

  // ── EUROPE ────────────────────────────────────────────────────────────
  {
    id: 'lse',
    name: 'London Stock Exchange',
    shortName: 'LSE',
    country: 'United Kingdom',
    countryCode: 'GB',
    continent: 'europe',
    currency: 'GBP',
    timezone: 'Europe/London',
    openTime: '08:00',
    closeTime: '16:30',
    mainIndex: '^FTSE',
    color: '#007AFF',
    indices: [
      { symbol: '^FTSE', name: 'FTSE 100', shortName: 'FTSE' },
      { symbol: '^FTMC', name: 'FTSE 250', shortName: 'FTMC' },
    ],
  },
  {
    id: 'frankfurt',
    name: 'Frankfurt Stock Exchange',
    shortName: 'FSE',
    country: 'Germany',
    countryCode: 'DE',
    continent: 'europe',
    currency: 'EUR',
    timezone: 'Europe/Berlin',
    openTime: '09:00',
    closeTime: '17:30',
    mainIndex: '^GDAXI',
    color: '#FF9500',
    indices: [
      { symbol: '^GDAXI', name: 'DAX 40', shortName: 'DAX' },
      { symbol: '^MDAXI', name: 'MDAX', shortName: 'MDAX' },
    ],
  },
  {
    id: 'euronext',
    name: 'Euronext Paris',
    shortName: 'ENX',
    country: 'France',
    countryCode: 'FR',
    continent: 'europe',
    currency: 'EUR',
    timezone: 'Europe/Paris',
    openTime: '09:00',
    closeTime: '17:30',
    mainIndex: '^FCHI',
    color: '#0071E3',
    indices: [
      { symbol: '^FCHI', name: 'CAC 40', shortName: 'CAC' },
      { symbol: '^SBF120', name: 'SBF 120', shortName: 'SBF' },
    ],
  },
  {
    id: 'six',
    name: 'SIX Swiss Exchange',
    shortName: 'SIX',
    country: 'Switzerland',
    countryCode: 'CH',
    continent: 'europe',
    currency: 'CHF',
    timezone: 'Europe/Zurich',
    openTime: '09:00',
    closeTime: '17:30',
    mainIndex: '^SSMI',
    color: '#FF2D55',
    indices: [
      { symbol: '^SSMI', name: 'Swiss Market Index', shortName: 'SMI' },
    ],
  },
  {
    id: 'amsterdam',
    name: 'Euronext Amsterdam',
    shortName: 'AMS',
    country: 'Netherlands',
    countryCode: 'NL',
    continent: 'europe',
    currency: 'EUR',
    timezone: 'Europe/Amsterdam',
    openTime: '09:00',
    closeTime: '17:30',
    mainIndex: '^AEX',
    color: '#FF6B00',
    indices: [
      { symbol: '^AEX', name: 'AEX Index', shortName: 'AEX' },
    ],
  },

  // ── ASIA PACIFIC ─────────────────────────────────────────────────────
  {
    id: 'tse',
    name: 'Tokyo Stock Exchange',
    shortName: 'TSE',
    country: 'Japan',
    countryCode: 'JP',
    continent: 'asia',
    currency: 'JPY',
    timezone: 'Asia/Tokyo',
    openTime: '09:00',
    closeTime: '15:30',
    mainIndex: '^N225',
    color: '#FF3B30',
    indices: [
      { symbol: '^N225', name: 'Nikkei 225', shortName: 'NK225' },
      { symbol: '^TPX', name: 'TOPIX', shortName: 'TOPIX' },
    ],
  },
  {
    id: 'hkex',
    name: 'Hong Kong Stock Exchange',
    shortName: 'HKEX',
    country: 'Hong Kong',
    countryCode: 'HK',
    continent: 'asia',
    currency: 'HKD',
    timezone: 'Asia/Hong_Kong',
    openTime: '09:30',
    closeTime: '16:00',
    mainIndex: '^HSI',
    color: '#34C759',
    indices: [
      { symbol: '^HSI', name: 'Hang Seng Index', shortName: 'HSI' },
      { symbol: '^HSCE', name: 'Hang Seng China Enterprises', shortName: 'HSCEI' },
    ],
  },
  {
    id: 'sse',
    name: 'Shanghai Stock Exchange',
    shortName: 'SSE',
    country: 'China',
    countryCode: 'CN',
    continent: 'asia',
    currency: 'CNY',
    timezone: 'Asia/Shanghai',
    openTime: '09:30',
    closeTime: '15:00',
    mainIndex: '000001.SS',
    color: '#FF9500',
    indices: [
      { symbol: '000001.SS', name: 'SSE Composite Index', shortName: 'SSEC' },
      { symbol: '000300.SS', name: 'CSI 300', shortName: 'CSI300' },
    ],
  },
  {
    id: 'nse',
    name: 'National Stock Exchange of India',
    shortName: 'NSE',
    country: 'India',
    countryCode: 'IN',
    continent: 'asia',
    currency: 'INR',
    timezone: 'Asia/Kolkata',
    openTime: '09:15',
    closeTime: '15:30',
    mainIndex: '^NSEI',
    color: '#5856D6',
    indices: [
      { symbol: '^NSEI', name: 'NIFTY 50', shortName: 'NIFTY' },
      { symbol: '^BSESN', name: 'BSE SENSEX', shortName: 'SENSEX' },
    ],
  },
  {
    id: 'krx',
    name: 'Korea Exchange',
    shortName: 'KRX',
    country: 'South Korea',
    countryCode: 'KR',
    continent: 'asia',
    currency: 'KRW',
    timezone: 'Asia/Seoul',
    openTime: '09:00',
    closeTime: '15:30',
    mainIndex: '^KS11',
    color: '#007AFF',
    indices: [
      { symbol: '^KS11', name: 'KOSPI', shortName: 'KOSPI' },
      { symbol: '^KQ11', name: 'KOSDAQ', shortName: 'KOSDAQ' },
    ],
  },
  {
    id: 'sgx',
    name: 'Singapore Exchange',
    shortName: 'SGX',
    country: 'Singapore',
    countryCode: 'SG',
    continent: 'asia',
    currency: 'SGD',
    timezone: 'Asia/Singapore',
    openTime: '09:00',
    closeTime: '17:00',
    mainIndex: '^STI',
    color: '#FF2D55',
    indices: [
      { symbol: '^STI', name: 'Straits Times Index', shortName: 'STI' },
    ],
  },

  // ── AFRICA & MIDDLE EAST ─────────────────────────────────────────────
  {
    id: 'jse',
    name: 'Johannesburg Stock Exchange',
    shortName: 'JSE',
    country: 'South Africa',
    countryCode: 'ZA',
    continent: 'africa',
    currency: 'ZAR',
    timezone: 'Africa/Johannesburg',
    openTime: '09:00',
    closeTime: '17:00',
    mainIndex: '^JN0U.JO',
    color: '#34C759',
    indices: [
      { symbol: '^JN0U.JO', name: 'FTSE/JSE Top 40', shortName: 'TOP40' },
    ],
  },
  {
    id: 'tadawul',
    name: 'Saudi Exchange (Tadawul)',
    shortName: 'TASI',
    country: 'Saudi Arabia',
    countryCode: 'SA',
    continent: 'africa',
    currency: 'SAR',
    timezone: 'Asia/Riyadh',
    openTime: '10:00',
    closeTime: '15:00',
    mainIndex: '^TASI.SR',
    color: '#007AFF',
    indices: [
      { symbol: '^TASI.SR', name: 'Tadawul All Share Index', shortName: 'TASI' },
    ],
  },

  // ── OCEANIA ───────────────────────────────────────────────────────────
  {
    id: 'asx',
    name: 'Australian Securities Exchange',
    shortName: 'ASX',
    country: 'Australia',
    countryCode: 'AU',
    continent: 'oceania',
    currency: 'AUD',
    timezone: 'Australia/Sydney',
    openTime: '10:00',
    closeTime: '16:00',
    mainIndex: '^AXJO',
    color: '#FF9500',
    indices: [
      { symbol: '^AXJO', name: 'ASX 200', shortName: 'ASX200' },
      { symbol: '^AORD', name: 'All Ordinaries', shortName: 'AORD' },
    ],
  },
  {
    id: 'nzx',
    name: 'New Zealand Exchange',
    shortName: 'NZX',
    country: 'New Zealand',
    countryCode: 'NZ',
    continent: 'oceania',
    currency: 'NZD',
    timezone: 'Pacific/Auckland',
    openTime: '10:00',
    closeTime: '16:45',
    mainIndex: '^NZ50',
    color: '#5AC8FA',
    indices: [
      { symbol: '^NZ50', name: 'NZX 50', shortName: 'NZ50' },
    ],
  },
]

// All unique index symbols across all exchanges
export const ALL_INDEX_SYMBOLS = Array.from(
  new Set(WORLD_EXCHANGES.flatMap((ex) => ex.indices.map((i) => i.symbol)))
)

export const CONTINENTS: Array<{
  id: Continent
  label: string
  emoji: string
  description: string
}> = [
  { id: 'global', label: 'Global', emoji: '🌐', description: 'All markets worldwide' },
  { id: 'americas', label: 'Americas', emoji: '🌎', description: 'US, Canada, Brazil, Mexico' },
  { id: 'europe', label: 'Europe', emoji: '🌍', description: 'UK, Germany, France, Switzerland' },
  { id: 'asia', label: 'Asia-Pacific', emoji: '🌏', description: 'Japan, China, India, Korea' },
  { id: 'africa', label: 'Africa & ME', emoji: '🌍', description: 'South Africa, Saudi Arabia' },
  { id: 'oceania', label: 'Oceania', emoji: '🌏', description: 'Australia, New Zealand' },
]

export function getExchangesByContinent(continent: Continent): Exchange[] {
  if (continent === 'global') return WORLD_EXCHANGES
  return WORLD_EXCHANGES.filter((ex) => ex.continent === continent)
}

export function getIndicesByContinent(continent: Continent): ExchangeIndex[] {
  return getExchangesByContinent(continent).flatMap((ex) => ex.indices)
}

export function getExchangeById(id: string): Exchange | undefined {
  return WORLD_EXCHANGES.find((e) => e.id === id)
}

/**
 * Resolve the IANA timezone for a stock based on its exchange name/code.
 * Falls back to 'America/New_York' for US stocks (default).
 */
export function getExchangeTimezone(exchangeNameOrCode?: string | null): string {
  if (!exchangeNameOrCode) return 'America/New_York'
  const lower = exchangeNameOrCode.toLowerCase()
  // Try matching by exchange id, name, or shortName
  const match = WORLD_EXCHANGES.find(
    (e) =>
      e.id.toLowerCase() === lower ||
      e.name.toLowerCase().includes(lower) ||
      e.shortName.toLowerCase() === lower ||
      lower.includes(e.name.toLowerCase()) ||
      lower.includes(e.shortName.toLowerCase())
  )
  if (match) return match.timezone
  // Common keyword fallbacks
  if (lower.includes('nasdaq') || lower.includes('nyse') || lower.includes('nyq') || lower.includes('nms'))
    return 'America/New_York'
  if (lower.includes('london') || lower.includes('lse') || lower.includes('lseg'))
    return 'Europe/London'
  if (lower.includes('tokyo') || lower.includes('tse') || lower.includes('jpx'))
    return 'Asia/Tokyo'
  if (lower.includes('hong kong') || lower.includes('hkex') || lower.includes('hkg'))
    return 'Asia/Hong_Kong'
  if (lower.includes('shanghai') || lower.includes('sse') || lower.includes('shh'))
    return 'Asia/Shanghai'
  if (lower.includes('toronto') || lower.includes('tsx'))
    return 'America/Toronto'
  if (lower.includes('frankfurt') || lower.includes('xetra') || lower.includes('fra'))
    return 'Europe/Berlin'
  if (lower.includes('paris') || lower.includes('euronext'))
    return 'Europe/Paris'
  if (lower.includes('sydney') || lower.includes('asx'))
    return 'Australia/Sydney'
  if (lower.includes('mumbai') || lower.includes('bse') || lower.includes('nse'))
    return 'Asia/Kolkata'
  if (lower.includes('korea') || lower.includes('krx') || lower.includes('kospi'))
    return 'Asia/Seoul'
  return 'America/New_York' // Default for US stocks
}

/** Gold, oil, long-duration rates proxy, financials & energy — always on dashboard macro row */
export const ALWAYS_ON_MACRO_SYMBOLS = ['GC=F', 'CL=F', 'TLT', 'XLF', 'XLE'] as const

export const MACRO_SYMBOL_LABELS: Record<string, { name: string; shortName: string }> = {
  'GC=F': { name: 'Gold (futures)', shortName: 'GOLD' },
  'CL=F': { name: 'WTI Crude Oil', shortName: 'OIL' },
  TLT: { name: '20+ Year Treasury ETF', shortName: 'TLT' },
  XLF: { name: 'Financial Sector SPDR', shortName: 'XLF' },
  XLE: { name: 'Energy Sector SPDR', shortName: 'XLE' },
}

/** Continent headline benchmarks for the 1D performance card row (+ macros appended in UI) */
export const CONTINENT_DASHBOARD_INDEX_SYMBOLS: Record<Continent, string[]> = {
  global: ['^GSPC', '^IXIC', '^DJI', '^RUT', '^VIX'],
  americas: ['^GSPC', '^IXIC', '^DJI', '^GSPTSE', '^BVSP'],
  europe: ['^FTSE', '^GDAXI', '^FCHI', '^STOXX50E', '^SSMI'],
  asia: ['^N225', '^HSI', '000001.SS', '^BSESN', '^KS11'],
  africa: ['^JN0U.JO', '^TASI.SR'],
  oceania: ['^AXJO', '^AORD', '^NZ50'],
}

/** Yahoo Finance news / context ETFs by continent (plus global) */
export const CONTINENT_NEWS_TICKERS: Record<Continent, string[]> = {
  global: ['SPY', 'QQQ', 'IWM'],
  americas: ['SPY', 'QQQ', 'EWC', 'EWZ', 'EWW'],
  europe: ['EWU', 'EWG', 'EWQ', 'VGK'],
  asia: ['EWJ', 'FXI', 'INDA', 'EWY'],
  africa: ['EZA', 'KSA'],
  oceania: ['EWA', 'ENZL'],
}

const EXCHANGE_MOVER_HINTS: Record<string, RegExp> = {
  nyse: /new york stock exchange|\bNYSE\b/i,
  nasdaq: /\bNASDAQ\b|NasdaqGS|Nasdaq CM/i,
  tsx: /Toronto|TSX|TSXV|CNQ/i,
  b3: /\bB3\b|Brasil|Brazil|BM&F/i,
  bmv: /Mexico|BMV|Mexican/i,
  lse: /London|LSE/i,
  frankfurt: /Frankfurt|XETRA|Deutsche/i,
  euronext: /Euronext|Paris/i,
  six: /Swiss|SIX/i,
  amsterdam: /Amsterdam/i,
  madrid: /Madrid|BME/i,
  milan: /Milan|BIT/i,
  stockholm: /Stockholm|Nasdaq Stockholm/i,
  oslo: /Oslo/i,
  jse: /Johannesburg|JSE/i,
  tadawul: /Tadawul|Saudi/i,
  tase: /Tel Aviv/i,
  tse: /Tokyo/i,
  hkex: /Hong Kong|HKEX/i,
  sse: /Shanghai/i,
  szse: /Shenzhen/i,
  nse: /NSE|India/i,
  bse: /BSE|India/i,
  krx: /Korea|KRX/i,
  sgx: /Singapore/i,
  asx: /Australian|ASX/i,
  nzx: /NZX|New Zealand/i,
}

export function filterMoversByExchange(
  movers: { exchange: string; symbol: string }[],
  exchange: Exchange | undefined
): typeof movers {
  if (!exchange) return movers
  const re = EXCHANGE_MOVER_HINTS[exchange.id]
  if (!re) {
    const hint = exchange.shortName.slice(0, 6).toLowerCase()
    const filtered = movers.filter(
      (m) =>
        (m.exchange || '').toLowerCase().includes(hint) ||
        (m.exchange || '').toLowerCase().includes(exchange.country.toLowerCase().slice(0, 4))
    )
    return filtered.length >= 2 ? filtered : movers
  }
  const filtered = movers.filter((m) => re.test(m.exchange || ''))
  return filtered.length >= 2 ? filtered : movers
}

/** Globe.gl points for the dashboard mini map — `continents` includes `global` to show everywhere */
export type GlobeDashboardPoint = {
  type: 'exchange' | 'financial' | 'bank' | 'weather' | 'economic'
  name: string
  lat: number
  lng: number
  color: string
  continents: Array<Continent | 'global'>
}

export const GLOBE_DASHBOARD_POINTS: GlobeDashboardPoint[] = [
  { type: 'exchange', name: 'NYSE', lat: 40.7128, lng: -74.006, color: '#f59e0b', continents: ['americas', 'global'] },
  { type: 'exchange', name: 'NASDAQ', lat: 40.758, lng: -73.9855, color: '#f59e0b', continents: ['americas', 'global'] },
  { type: 'exchange', name: 'LSE', lat: 51.5074, lng: -0.1278, color: '#f59e0b', continents: ['europe', 'global'] },
  { type: 'exchange', name: 'TSE', lat: 35.6762, lng: 139.6503, color: '#f59e0b', continents: ['asia', 'global'] },
  { type: 'exchange', name: 'SSE', lat: 31.2304, lng: 121.4737, color: '#f59e0b', continents: ['asia', 'global'] },
  { type: 'exchange', name: 'HKEX', lat: 22.3193, lng: 114.1694, color: '#f59e0b', continents: ['asia', 'global'] },
  { type: 'exchange', name: 'Euronext', lat: 48.8566, lng: 2.3522, color: '#f59e0b', continents: ['europe', 'global'] },
  { type: 'exchange', name: 'BSE India', lat: 19.076, lng: 72.8777, color: '#f59e0b', continents: ['asia', 'global'] },
  { type: 'exchange', name: 'ASX', lat: -33.8688, lng: 151.2093, color: '#f59e0b', continents: ['oceania', 'global'] },
  { type: 'exchange', name: 'JSE', lat: -26.2041, lng: 28.0473, color: '#f59e0b', continents: ['africa', 'global'] },
  { type: 'financial', name: 'London', lat: 51.5074, lng: -0.1278, color: '#06b6d4', continents: ['europe', 'global'] },
  { type: 'financial', name: 'Singapore', lat: 1.3521, lng: 103.8198, color: '#06b6d4', continents: ['asia', 'global'] },
  { type: 'financial', name: 'Hong Kong', lat: 22.3193, lng: 114.1694, color: '#06b6d4', continents: ['asia', 'global'] },
  { type: 'financial', name: 'Zurich', lat: 47.3769, lng: 8.5417, color: '#06b6d4', continents: ['europe', 'global'] },
  { type: 'financial', name: 'Frankfurt', lat: 50.1109, lng: 8.6821, color: '#06b6d4', continents: ['europe', 'global'] },
  { type: 'financial', name: 'Dubai', lat: 25.2048, lng: 55.2708, color: '#06b6d4', continents: ['africa', 'global'] },
  { type: 'financial', name: 'Sydney', lat: -33.8688, lng: 151.2093, color: '#06b6d4', continents: ['oceania', 'global'] },
  { type: 'financial', name: 'São Paulo', lat: -23.5505, lng: -46.6333, color: '#06b6d4', continents: ['americas', 'global'] },
  { type: 'bank', name: 'Federal Reserve', lat: 38.8937, lng: -77.0465, color: '#3b82f6', continents: ['americas', 'global'] },
  { type: 'bank', name: 'ECB', lat: 50.1109, lng: 8.6821, color: '#3b82f6', continents: ['europe', 'global'] },
  { type: 'bank', name: 'Bank of Japan', lat: 35.6762, lng: 139.6503, color: '#3b82f6', continents: ['asia', 'global'] },
  { type: 'bank', name: 'Bank of England', lat: 51.5142, lng: -0.0931, color: '#3b82f6', continents: ['europe', 'global'] },
  { type: 'bank', name: 'PBoC', lat: 39.9042, lng: 116.4074, color: '#3b82f6', continents: ['asia', 'global'] },
  { type: 'bank', name: 'RBA', lat: -35.2809, lng: 149.13, color: '#3b82f6', continents: ['oceania', 'global'] },
  { type: 'economic', name: 'Silicon Valley', lat: 37.3861, lng: -122.0839, color: '#10b981', continents: ['americas', 'global'] },
  { type: 'economic', name: 'Shenzhen', lat: 22.5431, lng: 114.0579, color: '#10b981', continents: ['asia', 'global'] },
  { type: 'economic', name: 'Tel Aviv', lat: 32.0853, lng: 34.7818, color: '#10b981', continents: ['africa', 'global'] },
  { type: 'economic', name: 'Bangalore', lat: 12.9716, lng: 77.5946, color: '#10b981', continents: ['asia', 'global'] },
]

export function filterGlobePointsForContinent(
  continent: Continent,
  points: GlobeDashboardPoint[] = GLOBE_DASHBOARD_POINTS
): GlobeDashboardPoint[] {
  if (continent === 'global') return points
  return points.filter((p) => p.continents.includes('global') || p.continents.includes(continent))
}

// ─── Exchange-specific stock lists for sector heatmap ────────────────────
export interface ExchangeStock {
  symbol: string   // Yahoo Finance / FMP symbol
  name: string
  sector: string
}

export const EXCHANGE_HEATMAP_STOCKS: Record<string, ExchangeStock[]> = {
  // ── JSE (South Africa) ─────────────────────────────────────────────
  jse: [
    { symbol: 'SBK.JO', name: 'Standard Bank', sector: 'Financials' },
    { symbol: 'FSR.JO', name: 'Firstrand', sector: 'Financials' },
    { symbol: 'ABG.JO', name: 'Absa Group', sector: 'Financials' },
    { symbol: 'NED.JO', name: 'Nedbank Group', sector: 'Financials' },
    { symbol: 'DSY.JO', name: 'Discovery Ltd', sector: 'Financials' },
    { symbol: 'AGL.JO', name: 'Anglo American Plat', sector: 'Materials' },
    { symbol: 'GFI.JO', name: 'Gold Fields', sector: 'Materials' },
    { symbol: 'AMS.JO', name: 'Anglo Platinum', sector: 'Materials' },
    { symbol: 'HAR.JO', name: 'Harmony Gold', sector: 'Materials' },
    { symbol: 'BHP.JO', name: 'BHP Group', sector: 'Materials' },
    { symbol: 'SOL.JO', name: 'Sasol', sector: 'Energy' },
    { symbol: 'NPN.JO', name: 'Naspers', sector: 'Technology' },
    { symbol: 'PRX.JO', name: 'Prosus', sector: 'Technology' },
    { symbol: 'SHP.JO', name: 'Shoprite Holdings', sector: 'Consumer Defensive' },
    { symbol: 'TBS.JO', name: 'Tiger Brands', sector: 'Consumer Defensive' },
    { symbol: 'MRP.JO', name: 'Mr Price Group', sector: 'Consumer Cyclical' },
    { symbol: 'WHL.JO', name: 'Woolworths Holdings', sector: 'Consumer Cyclical' },
    { symbol: 'VOD.JO', name: 'Vodacom Group', sector: 'Communication Services' },
    { symbol: 'MTN.JO', name: 'MTN Group', sector: 'Communication Services' },
    { symbol: 'LHC.JO', name: 'Life Healthcare', sector: 'Healthcare' },
    { symbol: 'REM.JO', name: 'Remgro Ltd', sector: 'Industrials' },
    { symbol: 'MNP.JO', name: 'Mondi PLC', sector: 'Materials' },
  ],
  // ── Tadawul (Saudi Arabia) ─────────────────────────────────────────
  tadawul: [
    { symbol: '2222.SR', name: 'Saudi Aramco', sector: 'Energy' },
    { symbol: '2380.SR', name: 'Petro Rabigh', sector: 'Energy' },
    { symbol: '2010.SR', name: 'SABIC', sector: 'Materials' },
    { symbol: '2070.SR', name: 'SIPCHEM', sector: 'Materials' },
    { symbol: '1120.SR', name: 'Al Rajhi Bank', sector: 'Financials' },
    { symbol: '1180.SR', name: 'Saudi National Bank', sector: 'Financials' },
    { symbol: '1050.SR', name: 'Saudi Fransi Bank', sector: 'Financials' },
    { symbol: '1140.SR', name: 'Al Bilad Bank', sector: 'Financials' },
    { symbol: '1020.SR', name: 'Bank AlJazira', sector: 'Financials' },
    { symbol: '7010.SR', name: 'Saudi Telecom (STC)', sector: 'Communication Services' },
    { symbol: '7040.SR', name: 'Mobily', sector: 'Communication Services' },
    { symbol: '4009.SR', name: 'Mouwasat Medical', sector: 'Healthcare' },
    { symbol: '4020.SR', name: 'Dar Al-Arkan', sector: 'Real Estate' },
    { symbol: '4002.SR', name: 'National Industrialization', sector: 'Industrials' },
  ],
  // ── LSE (United Kingdom) ──────────────────────────────────────────
  lse: [
    { symbol: 'BP.L', name: 'BP PLC', sector: 'Energy' },
    { symbol: 'SHEL.L', name: 'Shell PLC', sector: 'Energy' },
    { symbol: 'BARC.L', name: 'Barclays PLC', sector: 'Financials' },
    { symbol: 'LLOY.L', name: 'Lloyds Banking Group', sector: 'Financials' },
    { symbol: 'NWG.L', name: 'NatWest Group', sector: 'Financials' },
    { symbol: 'HSBA.L', name: 'HSBC Holdings', sector: 'Financials' },
    { symbol: 'AZN.L', name: 'AstraZeneca', sector: 'Healthcare' },
    { symbol: 'GSK.L', name: 'GSK PLC', sector: 'Healthcare' },
    { symbol: 'AHT.L', name: 'Ashtead Group', sector: 'Industrials' },
    { symbol: 'ULVR.L', name: 'Unilever', sector: 'Consumer Defensive' },
    { symbol: 'DGE.L', name: 'Diageo', sector: 'Consumer Defensive' },
    { symbol: 'RIO.L', name: 'Rio Tinto', sector: 'Materials' },
    { symbol: 'GLEN.L', name: 'Glencore', sector: 'Materials' },
    { symbol: 'AAL.L', name: 'Anglo American', sector: 'Materials' },
    { symbol: 'VOD.L', name: 'Vodafone Group', sector: 'Communication Services' },
    { symbol: 'BT-A.L', name: 'BT Group', sector: 'Communication Services' },
    { symbol: 'SAGE.L', name: 'Sage Group', sector: 'Technology' },
    { symbol: 'REL.L', name: 'RELX PLC', sector: 'Industrials' },
    { symbol: 'BA.L', name: 'BAE Systems', sector: 'Industrials' },
    { symbol: 'RR.L', name: 'Rolls-Royce Holdings', sector: 'Industrials' },
  ],
  // ── Frankfurt (Germany) ───────────────────────────────────────────
  frankfurt: [
    { symbol: 'SAP.DE', name: 'SAP SE', sector: 'Technology' },
    { symbol: 'IFX.DE', name: 'Infineon Technologies', sector: 'Technology' },
    { symbol: 'BMW.DE', name: 'BMW AG', sector: 'Consumer Cyclical' },
    { symbol: 'MBG.DE', name: 'Mercedes-Benz Group', sector: 'Consumer Cyclical' },
    { symbol: 'VOW3.DE', name: 'Volkswagen', sector: 'Consumer Cyclical' },
    { symbol: 'MRK.DE', name: 'Merck KGaA', sector: 'Healthcare' },
    { symbol: 'BAY.DE', name: 'Bayer AG', sector: 'Healthcare' },
    { symbol: 'FRE.DE', name: 'Fresenius SE', sector: 'Healthcare' },
    { symbol: 'DBK.DE', name: 'Deutsche Bank', sector: 'Financials' },
    { symbol: 'ALV.DE', name: 'Allianz SE', sector: 'Financials' },
    { symbol: 'MUV2.DE', name: 'Munich Re', sector: 'Financials' },
    { symbol: 'SIE.DE', name: 'Siemens AG', sector: 'Industrials' },
    { symbol: 'DTE.DE', name: 'Deutsche Telekom', sector: 'Communication Services' },
    { symbol: 'BAS.DE', name: 'BASF SE', sector: 'Materials' },
    { symbol: 'HEN3.DE', name: 'Henkel AG', sector: 'Consumer Defensive' },
    { symbol: 'RWE.DE', name: 'RWE AG', sector: 'Utilities' },
    { symbol: 'EON.DE', name: 'E.ON SE', sector: 'Utilities' },
    { symbol: 'ADS.DE', name: 'Adidas AG', sector: 'Consumer Cyclical' },
  ],
  // ── Euronext Paris (France) ───────────────────────────────────────
  euronext: [
    { symbol: 'MC.PA', name: 'LVMH', sector: 'Consumer Cyclical' },
    { symbol: 'TTE.PA', name: 'TotalEnergies', sector: 'Energy' },
    { symbol: 'SAN.PA', name: 'Sanofi', sector: 'Healthcare' },
    { symbol: 'AIR.PA', name: 'Airbus SE', sector: 'Industrials' },
    { symbol: 'BNP.PA', name: 'BNP Paribas', sector: 'Financials' },
    { symbol: 'ACA.PA', name: 'Credit Agricole', sector: 'Financials' },
    { symbol: 'SG.PA', name: 'Societe Generale', sector: 'Financials' },
    { symbol: 'OR.PA', name: "L'Oreal", sector: 'Consumer Defensive' },
    { symbol: 'CAP.PA', name: 'Capgemini', sector: 'Technology' },
    { symbol: 'DG.PA', name: 'Vinci SA', sector: 'Industrials' },
    { symbol: 'AXA.PA', name: 'AXA', sector: 'Financials' },
    { symbol: 'BN.PA', name: 'Danone SA', sector: 'Consumer Defensive' },
    { symbol: 'VIE.PA', name: 'Veolia Environment', sector: 'Utilities' },
  ],
  // ── TSE (Japan) ───────────────────────────────────────────────────
  tse: [
    { symbol: '6758.T', name: 'Sony Group', sector: 'Technology' },
    { symbol: '6861.T', name: 'Keyence Corp', sector: 'Technology' },
    { symbol: '8035.T', name: 'Tokyo Electron', sector: 'Technology' },
    { symbol: '9984.T', name: 'SoftBank Group', sector: 'Communication Services' },
    { symbol: '7203.T', name: 'Toyota Motor', sector: 'Consumer Cyclical' },
    { symbol: '7267.T', name: 'Honda Motor', sector: 'Consumer Cyclical' },
    { symbol: '7269.T', name: 'Suzuki Motor', sector: 'Consumer Cyclical' },
    { symbol: '8306.T', name: 'Mitsubishi UFJ', sector: 'Financials' },
    { symbol: '8411.T', name: 'Mizuho Financial', sector: 'Financials' },
    { symbol: '8316.T', name: 'Sumitomo Mitsui', sector: 'Financials' },
    { symbol: '9983.T', name: 'Fast Retailing', sector: 'Consumer Cyclical' },
    { symbol: '7974.T', name: 'Nintendo Co', sector: 'Communication Services' },
    { symbol: '4519.T', name: 'Chugai Pharma', sector: 'Healthcare' },
    { symbol: '4502.T', name: 'Takeda Pharma', sector: 'Healthcare' },
    { symbol: '6301.T', name: 'Komatsu Ltd', sector: 'Industrials' },
    { symbol: '6501.T', name: 'Hitachi Ltd', sector: 'Industrials' },
  ],
  // ── HKEX (Hong Kong) ─────────────────────────────────────────────
  hkex: [
    { symbol: '0700.HK', name: 'Tencent Holdings', sector: 'Technology' },
    { symbol: '9988.HK', name: 'Alibaba Group', sector: 'Consumer Cyclical' },
    { symbol: '0005.HK', name: 'HSBC Holdings', sector: 'Financials' },
    { symbol: '0941.HK', name: 'China Mobile', sector: 'Communication Services' },
    { symbol: '1299.HK', name: 'AIA Group', sector: 'Financials' },
    { symbol: '0388.HK', name: 'HK Exchanges', sector: 'Financials' },
    { symbol: '2318.HK', name: 'Ping An Insurance', sector: 'Financials' },
    { symbol: '3690.HK', name: 'Meituan', sector: 'Consumer Cyclical' },
    { symbol: '9618.HK', name: 'JD.com', sector: 'Consumer Cyclical' },
    { symbol: '0939.HK', name: 'China Construction Bank', sector: 'Financials' },
    { symbol: '0883.HK', name: 'CNOOC Ltd', sector: 'Energy' },
    { symbol: '0027.HK', name: 'Galaxy Entertainment', sector: 'Consumer Cyclical' },
    { symbol: '0762.HK', name: 'China Unicom', sector: 'Communication Services' },
    { symbol: '2382.HK', name: 'Sunny Optical', sector: 'Technology' },
  ],
  // ── SSE (Shanghai/China) ──────────────────────────────────────────
  sse: [
    { symbol: '600519.SS', name: 'Kweichow Moutai', sector: 'Consumer Defensive' },
    { symbol: '601318.SS', name: 'Ping An Insurance', sector: 'Financials' },
    { symbol: '600036.SS', name: 'China Merchants Bank', sector: 'Financials' },
    { symbol: '600900.SS', name: 'Yangtze Power', sector: 'Utilities' },
    { symbol: '601857.SS', name: 'PetroChina', sector: 'Energy' },
    { symbol: '600028.SS', name: 'Sinopec Corp', sector: 'Energy' },
    { symbol: '601088.SS', name: 'China Shenhua Energy', sector: 'Energy' },
    { symbol: '600276.SS', name: 'Hengrui Medicine', sector: 'Healthcare' },
    { symbol: '601166.SS', name: 'Industrial Bank', sector: 'Financials' },
    { symbol: '600809.SS', name: 'Shanxi Xinghuacun', sector: 'Consumer Defensive' },
  ],
  // ── NSE (India) ───────────────────────────────────────────────────
  nse: [
    { symbol: 'RELIANCE.NS', name: 'Reliance Industries', sector: 'Energy' },
    { symbol: 'TCS.NS', name: 'Tata Consultancy', sector: 'Technology' },
    { symbol: 'INFY.NS', name: 'Infosys', sector: 'Technology' },
    { symbol: 'WIPRO.NS', name: 'Wipro Ltd', sector: 'Technology' },
    { symbol: 'HCLTECH.NS', name: 'HCL Technologies', sector: 'Technology' },
    { symbol: 'HDFCBANK.NS', name: 'HDFC Bank', sector: 'Financials' },
    { symbol: 'ICICIBANK.NS', name: 'ICICI Bank', sector: 'Financials' },
    { symbol: 'KOTAKBANK.NS', name: 'Kotak Mahindra Bank', sector: 'Financials' },
    { symbol: 'AXISBANK.NS', name: 'Axis Bank', sector: 'Financials' },
    { symbol: 'BAJFINANCE.NS', name: 'Bajaj Finance', sector: 'Financials' },
    { symbol: 'HINDUNILVR.NS', name: 'Hindustan Unilever', sector: 'Consumer Defensive' },
    { symbol: 'NESTLEIND.NS', name: 'Nestle India', sector: 'Consumer Defensive' },
    { symbol: 'SUNPHARMA.NS', name: 'Sun Pharmaceutical', sector: 'Healthcare' },
    { symbol: 'DRREDDY.NS', name: "Dr. Reddy's Labs", sector: 'Healthcare' },
    { symbol: 'TATAMOTORS.NS', name: 'Tata Motors', sector: 'Consumer Cyclical' },
    { symbol: 'MARUTI.NS', name: 'Maruti Suzuki', sector: 'Consumer Cyclical' },
    { symbol: 'NTPC.NS', name: 'NTPC Ltd', sector: 'Utilities' },
    { symbol: 'ONGC.NS', name: 'ONGC', sector: 'Energy' },
  ],
  // ── KRX (South Korea) ────────────────────────────────────────────
  krx: [
    { symbol: '005930.KS', name: 'Samsung Electronics', sector: 'Technology' },
    { symbol: '000660.KS', name: 'SK Hynix', sector: 'Technology' },
    { symbol: '035420.KS', name: 'Naver Corp', sector: 'Technology' },
    { symbol: '035720.KS', name: 'Kakao Corp', sector: 'Technology' },
    { symbol: '005380.KS', name: 'Hyundai Motor', sector: 'Consumer Cyclical' },
    { symbol: '000270.KS', name: 'Kia Corp', sector: 'Consumer Cyclical' },
    { symbol: '105560.KS', name: 'KB Financial Group', sector: 'Financials' },
    { symbol: '055550.KS', name: 'Shinhan Financial', sector: 'Financials' },
    { symbol: '207940.KS', name: 'Samsung Biologics', sector: 'Healthcare' },
    { symbol: '068270.KS', name: 'Celltrion Inc', sector: 'Healthcare' },
    { symbol: '034730.KS', name: 'SK Holdings', sector: 'Industrials' },
    { symbol: '096770.KS', name: 'SK Innovation', sector: 'Energy' },
    { symbol: '003550.KS', name: 'LG Corp', sector: 'Industrials' },
  ],
  // ── SGX (Singapore) ──────────────────────────────────────────────
  sgx: [
    { symbol: 'D05.SI', name: 'DBS Group Holdings', sector: 'Financials' },
    { symbol: 'O39.SI', name: 'OCBC Bank', sector: 'Financials' },
    { symbol: 'U11.SI', name: 'United Overseas Bank', sector: 'Financials' },
    { symbol: 'Z74.SI', name: 'Singapore Telecom', sector: 'Communication Services' },
    { symbol: 'C31.SI', name: 'CapitaLand Integrated', sector: 'Real Estate' },
    { symbol: 'S63.SI', name: 'ST Engineering', sector: 'Industrials' },
    { symbol: 'V03.SI', name: 'Venture Corp', sector: 'Technology' },
    { symbol: 'F34.SI', name: 'Wilmar International', sector: 'Consumer Defensive' },
    { symbol: 'G13.SI', name: 'Genting Singapore', sector: 'Consumer Cyclical' },
    { symbol: 'BS6.SI', name: 'Yangzijiang Shipbuilding', sector: 'Industrials' },
  ],
  // ── ASX (Australia) ───────────────────────────────────────────────
  asx: [
    { symbol: 'BHP.AX', name: 'BHP Group', sector: 'Materials' },
    { symbol: 'RIO.AX', name: 'Rio Tinto', sector: 'Materials' },
    { symbol: 'FMG.AX', name: 'Fortescue Metals', sector: 'Materials' },
    { symbol: 'NCM.AX', name: 'Newcrest Mining', sector: 'Materials' },
    { symbol: 'CBA.AX', name: 'Commonwealth Bank', sector: 'Financials' },
    { symbol: 'NAB.AX', name: 'National Australia Bank', sector: 'Financials' },
    { symbol: 'WBC.AX', name: 'Westpac Banking', sector: 'Financials' },
    { symbol: 'ANZ.AX', name: 'ANZ Group Holdings', sector: 'Financials' },
    { symbol: 'MQG.AX', name: 'Macquarie Group', sector: 'Financials' },
    { symbol: 'CSL.AX', name: 'CSL Limited', sector: 'Healthcare' },
    { symbol: 'RMD.AX', name: 'ResMed Inc', sector: 'Healthcare' },
    { symbol: 'WES.AX', name: 'Wesfarmers', sector: 'Consumer Cyclical' },
    { symbol: 'WOW.AX', name: 'Woolworths Group', sector: 'Consumer Defensive' },
    { symbol: 'COL.AX', name: 'Coles Group', sector: 'Consumer Defensive' },
    { symbol: 'GMG.AX', name: 'Goodman Group', sector: 'Real Estate' },
    { symbol: 'XRO.AX', name: 'Xero Limited', sector: 'Technology' },
  ],
  // ── TSX (Canada) ──────────────────────────────────────────────────
  tsx: [
    { symbol: 'RY.TO', name: 'Royal Bank of Canada', sector: 'Financials' },
    { symbol: 'TD.TO', name: 'Toronto-Dominion Bank', sector: 'Financials' },
    { symbol: 'BNS.TO', name: 'Bank of Nova Scotia', sector: 'Financials' },
    { symbol: 'BAM.TO', name: 'Brookfield Asset Mgmt', sector: 'Financials' },
    { symbol: 'MFC.TO', name: 'Manulife Financial', sector: 'Financials' },
    { symbol: 'CNQ.TO', name: 'Canadian Natural Resources', sector: 'Energy' },
    { symbol: 'SU.TO', name: 'Suncor Energy', sector: 'Energy' },
    { symbol: 'ENB.TO', name: 'Enbridge Inc', sector: 'Energy' },
    { symbol: 'ABX.TO', name: 'Barrick Gold', sector: 'Materials' },
    { symbol: 'NTR.TO', name: 'Nutrien Ltd', sector: 'Materials' },
    { symbol: 'CNR.TO', name: 'Canadian National Railway', sector: 'Industrials' },
    { symbol: 'CP.TO', name: 'Canadian Pacific Kansas City', sector: 'Industrials' },
    { symbol: 'BCE.TO', name: 'BCE Inc', sector: 'Communication Services' },
    { symbol: 'TRI.TO', name: 'Thomson Reuters', sector: 'Industrials' },
    { symbol: 'SHOP.TO', name: 'Shopify Inc', sector: 'Technology' },
  ],
  // ── B3 (Brazil) ───────────────────────────────────────────────────
  b3: [
    { symbol: 'PETR4.SA', name: 'Petrobras PN', sector: 'Energy' },
    { symbol: 'VALE3.SA', name: 'Vale SA', sector: 'Materials' },
    { symbol: 'ITUB4.SA', name: 'Itau Unibanco PN', sector: 'Financials' },
    { symbol: 'BBDC4.SA', name: 'Bradesco PN', sector: 'Financials' },
    { symbol: 'BBAS3.SA', name: 'Banco do Brasil', sector: 'Financials' },
    { symbol: 'WEGE3.SA', name: 'WEG SA', sector: 'Industrials' },
    { symbol: 'ABEV3.SA', name: 'Ambev SA', sector: 'Consumer Defensive' },
    { symbol: 'RENT3.SA', name: 'Localiza Rent a Car', sector: 'Consumer Cyclical' },
    { symbol: 'GGBR4.SA', name: 'Gerdau SA', sector: 'Materials' },
    { symbol: 'MGLU3.SA', name: 'Magazine Luiza', sector: 'Consumer Cyclical' },
  ],
  // ── NYSE (fallback — US movers shown via S&P500 in global view) ───
  nyse: [],
  nasdaq: [],
  // ── Euronext Amsterdam ────────────────────────────────────────────
  amsterdam: [
    { symbol: 'ASML.AS', name: 'ASML Holding', sector: 'Technology' },
    { symbol: 'HEIA.AS', name: 'Heineken NV', sector: 'Consumer Defensive' },
    { symbol: 'PHIA.AS', name: 'Philips NV', sector: 'Healthcare' },
    { symbol: 'INGA.AS', name: 'ING Group', sector: 'Financials' },
    { symbol: 'ABN.AS', name: 'ABN AMRO', sector: 'Financials' },
    { symbol: 'REN.AS', name: 'RELX NV', sector: 'Industrials' },
    { symbol: 'WKL.AS', name: 'Wolters Kluwer', sector: 'Industrials' },
  ],
  // ── SIX Swiss Exchange ────────────────────────────────────────────
  six: [
    { symbol: 'NESN.SW', name: 'Nestle SA', sector: 'Consumer Defensive' },
    { symbol: 'ROG.SW', name: 'Roche Holding', sector: 'Healthcare' },
    { symbol: 'NOVN.SW', name: 'Novartis AG', sector: 'Healthcare' },
    { symbol: 'ABBN.SW', name: 'ABB Ltd', sector: 'Industrials' },
    { symbol: 'ZURN.SW', name: 'Zurich Insurance', sector: 'Financials' },
    { symbol: 'CSGN.SW', name: 'Credit Suisse Group', sector: 'Financials' },
    { symbol: 'UBSG.SW', name: 'UBS Group AG', sector: 'Financials' },
    { symbol: 'SIKA.SW', name: 'Sika AG', sector: 'Materials' },
    { symbol: 'LONN.SW', name: 'Lonza Group', sector: 'Healthcare' },
  ],
  // ── NZX (New Zealand) ────────────────────────────────────────────
  nzx: [
    { symbol: 'FPH.NZ', name: 'Fisher & Paykel Healthcare', sector: 'Healthcare' },
    { symbol: 'ATM.NZ', name: 'a2 Milk Company', sector: 'Consumer Defensive' },
    { symbol: 'MFT.NZ', name: 'Mainfreight Ltd', sector: 'Industrials' },
    { symbol: 'MEL.NZ', name: 'Meridian Energy', sector: 'Utilities' },
    { symbol: 'CEN.NZ', name: 'Contact Energy', sector: 'Utilities' },
    { symbol: 'AIR.NZ', name: 'Air New Zealand', sector: 'Industrials' },
    { symbol: 'SCL.NZ', name: 'Scales Corp', sector: 'Consumer Defensive' },
  ],
}

// ─── Get stocks for a specific exchange ───────────────────────────────────
export function getExchangeStocks(exchangeId: string): ExchangeStock[] {
  return EXCHANGE_HEATMAP_STOCKS[exchangeId] ?? []
}

// ─── Get all stocks for a continent (combined from all exchanges) ──────────
export function getContinentStocks(continent: Continent): ExchangeStock[] {
  const exchanges = getExchangesByContinent(continent)
  const seen = new Set<string>()
  const out: ExchangeStock[] = []
  for (const ex of exchanges) {
    for (const stock of EXCHANGE_HEATMAP_STOCKS[ex.id] ?? []) {
      if (!seen.has(stock.symbol)) {
        seen.add(stock.symbol)
        out.push(stock)
      }
    }
  }
  return out
}

// Currencies available for price display
export const DISPLAY_CURRENCIES = [
  { code: 'USD', symbol: '$', name: 'US Dollar', flag: '🇺🇸' },
  { code: 'EUR', symbol: '€', name: 'Euro', flag: '🇪🇺' },
  { code: 'GBP', symbol: '£', name: 'British Pound', flag: '🇬🇧' },
  { code: 'JPY', symbol: '¥', name: 'Japanese Yen', flag: '🇯🇵' },
  { code: 'INR', symbol: '₹', name: 'Indian Rupee', flag: '🇮🇳' },
  { code: 'CNY', symbol: '¥', name: 'Chinese Yuan', flag: '🇨🇳' },
  { code: 'CAD', symbol: 'C$', name: 'Canadian Dollar', flag: '🇨🇦' },
  { code: 'AUD', symbol: 'A$', name: 'Australian Dollar', flag: '🇦🇺' },
  { code: 'CHF', symbol: 'Fr', name: 'Swiss Franc', flag: '🇨🇭' },
  { code: 'HKD', symbol: 'HK$', name: 'Hong Kong Dollar', flag: '🇭🇰' },
  { code: 'KRW', symbol: '₩', name: 'South Korean Won', flag: '🇰🇷' },
  { code: 'BRL', symbol: 'R$', name: 'Brazilian Real', flag: '🇧🇷' },
  { code: 'SAR', symbol: 'ر.س', name: 'Saudi Riyal', flag: '🇸🇦' },
  { code: 'ZAR', symbol: 'R', name: 'South African Rand', flag: '🇿🇦' },
]

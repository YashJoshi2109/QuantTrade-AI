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

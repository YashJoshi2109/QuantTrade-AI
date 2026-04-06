import { NextRequest, NextResponse } from 'next/server'
import { filterMoversByExchange, getExchangeById } from '@/lib/world-exchanges'

/**
 * Global Market Movers API
 * Provider chain:
 *  1. Yahoo Finance screener (free, no key)
 *  2. Financial Modeling Prep (250 calls/day — US + global screener)
 *  3. Twelve Data (800 credits/day — gainers/losers endpoint)
 */

export const dynamic = 'force-dynamic'

const FMP_KEY = process.env.FMP_API_KEY ?? ''
const TWELVE_KEY =
  process.env.TWELVE_DATA_API_KEY ?? process.env.TWELVEDATA_API_KEY ?? ''

export interface GlobalMover {
  symbol: string
  name: string
  price: number
  change: number
  change_percent: number
  volume: number
  market_cap: number
  exchange: string
  currency: string
}

// ─── Continent → Yahoo Finance region codes ────────────────────────────────
const CONTINENT_REGIONS: Record<string, string[]> = {
  global: ['US'],
  americas: ['US', 'CA', 'BR', 'MX'],
  europe: ['GB', 'DE', 'FR', 'CH', 'NL', 'IT', 'ES', 'SE'],
  asia: ['JP', 'HK', 'CN', 'IN', 'KR', 'SG', 'AU', 'TW'],
  africa: ['ZA', 'SA'],
  oceania: ['AU', 'NZ'],
}

// ─── Continent → FMP exchange codes ───────────────────────────────────────
const CONTINENT_FMP_EXCHANGES: Record<string, string[]> = {
  global: ['NYSE', 'NASDAQ'],
  americas: ['NYSE', 'NASDAQ', 'TSX', 'SAO', 'MEX'],
  europe: ['LON', 'XETRA', 'PAR', 'SWX', 'XAMS'],
  asia: ['JPX', 'HKSE', 'SHH', 'NSE', 'KSC', 'SES'],
  africa: ['JSE', 'SAU'],
  oceania: ['ASX', 'NZE'],
}

// ─── Continent → Twelve Data exchange + country ────────────────────────────
const CONTINENT_TWELVE_PARAMS: Record<string, { exchange: string; country?: string }[]> = {
  global: [{ exchange: 'NYSE' }, { exchange: 'NASDAQ' }],
  americas: [{ exchange: 'NYSE' }, { exchange: 'NASDAQ' }, { exchange: 'TSX' }, { exchange: 'BMFBOVESPA', country: 'Brazil' }],
  europe: [{ exchange: 'LSE' }, { exchange: 'XETRA' }, { exchange: 'EURONEXT' }, { exchange: 'SIX' }],
  asia: [{ exchange: 'TSE', country: 'Japan' }, { exchange: 'HKEX' }, { exchange: 'SSE', country: 'China' }, { exchange: 'NSE', country: 'India' }],
  africa: [{ exchange: 'JSE', country: 'South Africa' }, { exchange: 'TADAWUL', country: 'Saudi Arabia' }],
  oceania: [{ exchange: 'ASX', country: 'Australia' }, { exchange: 'NZX', country: 'New Zealand' }],
}

// ─── Yahoo Finance screener ────────────────────────────────────────────────
async function fetchYFScreener(
  scrId: 'day_gainers' | 'day_losers' | 'most_actives',
  region: string,
  count = 10
): Promise<GlobalMover[]> {
  try {
    const url = new URL('https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved')
    url.searchParams.set('formatted', 'false')
    url.searchParams.set('scrIds', scrId)
    url.searchParams.set('count', String(count))
    url.searchParams.set('region', region)
    url.searchParams.set('lang', 'en-US')

    const res = await fetch(url.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        Referer: 'https://finance.yahoo.com/',
      },
      cache: 'no-store',
    })

    if (!res.ok) return []

    const data = await res.json()
    const quotes = data?.finance?.result?.[0]?.quotes ?? []

    return quotes.map((q: Record<string, unknown>) => ({
      symbol: String(q.symbol ?? ''),
      name: String(q.longName ?? q.shortName ?? q.symbol ?? ''),
      price: Number(q.regularMarketPrice ?? 0),
      change: Number(q.regularMarketChange ?? 0),
      change_percent: Number(q.regularMarketChangePercent ?? 0),
      volume: Number(q.regularMarketVolume ?? 0),
      market_cap: Number(q.marketCap ?? 0),
      exchange: String(q.fullExchangeName ?? q.exchange ?? ''),
      currency: String(q.currency ?? 'USD'),
    }))
  } catch {
    return []
  }
}

// ─── FMP: US market movers (gainers / losers / actives) ───────────────────
async function fetchFMPUSMovers(type: 'gainers' | 'losers' | 'actives'): Promise<GlobalMover[]> {
  if (!FMP_KEY) return []
  try {
    const endpoint =
      type === 'gainers' ? 'gainers' : type === 'losers' ? 'losers' : 'actives'
    const res = await fetch(
      `https://financialmodelingprep.com/api/v3/stock_market/${endpoint}?apikey=${FMP_KEY}`,
      { cache: 'no-store' }
    )
    if (!res.ok) return []
    const data: Record<string, unknown>[] = await res.json()
    if (!Array.isArray(data)) return []
    return data.map((q) => ({
      symbol: String(q.symbol ?? ''),
      name: String(q.name ?? q.symbol ?? ''),
      price: Number(q.price ?? 0),
      change: Number(q.change ?? 0),
      change_percent: Number(q.changesPercentage ?? 0),
      volume: Number(q.volume ?? 0),
      market_cap: Number(q.marketCap ?? 0),
      exchange: String(q.exchange ?? 'NASDAQ'),
      currency: 'USD',
    })).filter((m) => m.symbol && m.price > 0)
  } catch {
    return []
  }
}

// ─── FMP: exchange-specific screener ──────────────────────────────────────
async function fetchFMPExchangeMovers(
  exchangeCode: string,
  type: 'gainers' | 'losers',
  count: number
): Promise<GlobalMover[]> {
  if (!FMP_KEY) return []
  try {
    const sortOrder = type === 'gainers' ? 'desc' : 'asc'
    const url =
      `https://financialmodelingprep.com/api/v3/stock-screener` +
      `?exchange=${exchangeCode}&limit=${count * 2}&sortBy=changePercentage&sortOrder=${sortOrder}` +
      `&isActivelyTrading=true&apikey=${FMP_KEY}`
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return []
    const data: Record<string, unknown>[] = await res.json()
    if (!Array.isArray(data)) return []
    return data
      .map((q) => ({
        symbol: String(q.symbol ?? ''),
        name: String(q.companyName ?? q.symbol ?? ''),
        price: Number(q.price ?? 0),
        change: Number(q.change ?? 0),
        change_percent: Number(q.changePercentage ?? q.changesPercentage ?? 0),
        volume: Number(q.volume ?? 0),
        market_cap: Number(q.marketCap ?? 0),
        exchange: String(q.exchangeShortName ?? q.exchange ?? exchangeCode),
        currency: String(q.currency ?? 'USD'),
      }))
      .filter((m) => m.symbol && m.price > 0)
  } catch {
    return []
  }
}

// ─── Twelve Data: gainers / losers ────────────────────────────────────────
async function fetchTwelveMovers(
  exchange: string,
  country: string | undefined,
  type: 'gainers' | 'losers',
  count: number
): Promise<GlobalMover[]> {
  if (!TWELVE_KEY) return []
  try {
    const params = new URLSearchParams({
      exchange,
      outputsize: String(count),
      apikey: TWELVE_KEY,
    })
    if (country) params.set('country', country)

    const endpoint = type === 'gainers' ? 'gainers' : 'losers'
    const res = await fetch(
      `https://api.twelvedata.com/${endpoint}?${params}`,
      { cache: 'no-store' }
    )
    if (!res.ok) return []
    const data = await res.json()
    const rows: Record<string, unknown>[] = data?.data ?? []
    if (!Array.isArray(rows)) return []
    return rows
      .map((q) => ({
        symbol: String(q.symbol ?? ''),
        name: String(q.name ?? q.symbol ?? ''),
        price: Number(q.last ?? q.close ?? 0),
        change: Number(q.absolute_change ?? 0),
        change_percent: Number(q.percent_change ?? 0),
        volume: Number(q.volume ?? 0),
        market_cap: 0,
        exchange: String(q.exchange ?? exchange),
        currency: String(q.currency ?? 'USD'),
      }))
      .filter((m) => m.symbol && m.price > 0)
  } catch {
    return []
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────
function dedupeMovers(rows: GlobalMover[]): GlobalMover[] {
  const seen = new Set<string>()
  const out: GlobalMover[] = []
  for (const m of rows) {
    if (!m.symbol || seen.has(m.symbol)) continue
    seen.add(m.symbol)
    out.push(m)
  }
  return out
}

// ─── Yahoo Finance continent movers (primary) ─────────────────────────────
async function yfContinentMovers(continent: string, count: number, type: 'gainers' | 'losers'): Promise<GlobalMover[]> {
  const regions = CONTINENT_REGIONS[continent] ?? CONTINENT_REGIONS.global
  const scrId = type === 'gainers' ? 'day_gainers' : 'day_losers'
  const batches = await Promise.all(regions.map((r) => fetchYFScreener(scrId, r, count)))
  const merged = dedupeMovers(batches.flat())
  merged.sort((a, b) =>
    type === 'gainers' ? b.change_percent - a.change_percent : a.change_percent - b.change_percent
  )
  return merged.slice(0, count)
}

async function yfContinentActives(continent: string, count: number): Promise<GlobalMover[]> {
  const regions = CONTINENT_REGIONS[continent] ?? CONTINENT_REGIONS.global
  const batches = await Promise.all(regions.map((r) => fetchYFScreener('most_actives', r, count)))
  const merged = dedupeMovers(batches.flat())
  merged.sort((a, b) => (b.volume || 0) - (a.volume || 0))
  return merged.slice(0, count)
}

// ─── FMP continent movers (fallback) ──────────────────────────────────────
async function fmpContinentMovers(continent: string, count: number, type: 'gainers' | 'losers'): Promise<GlobalMover[]> {
  if (!FMP_KEY) return []

  // For US/global use the dedicated endpoint (faster, more reliable)
  if (continent === 'global' || continent === 'americas') {
    return fetchFMPUSMovers(type)
  }

  const codes = CONTINENT_FMP_EXCHANGES[continent] ?? []
  const batches = await Promise.all(codes.map((c) => fetchFMPExchangeMovers(c, type, count)))
  const merged = dedupeMovers(batches.flat())
  merged.sort((a, b) =>
    type === 'gainers' ? b.change_percent - a.change_percent : a.change_percent - b.change_percent
  )
  return merged.slice(0, count)
}

async function fmpContinentActives(continent: string, count: number): Promise<GlobalMover[]> {
  if (!FMP_KEY) return []
  if (continent === 'global' || continent === 'americas') {
    return fetchFMPUSMovers('actives')
  }
  // For non-US, use screener sorted by volume
  const codes = CONTINENT_FMP_EXCHANGES[continent] ?? []
  const batches = await Promise.all(
    codes.map(async (c) => {
      try {
        const res = await fetch(
          `https://financialmodelingprep.com/api/v3/stock-screener?exchange=${c}&limit=${count * 2}&sortBy=volume&sortOrder=desc&isActivelyTrading=true&apikey=${FMP_KEY}`,
          { cache: 'no-store' }
        )
        if (!res.ok) return []
        const data: Record<string, unknown>[] = await res.json()
        if (!Array.isArray(data)) return []
        return data.map((q) => ({
          symbol: String(q.symbol ?? ''),
          name: String(q.companyName ?? q.symbol ?? ''),
          price: Number(q.price ?? 0),
          change: Number(q.change ?? 0),
          change_percent: Number(q.changePercentage ?? 0),
          volume: Number(q.volume ?? 0),
          market_cap: Number(q.marketCap ?? 0),
          exchange: String(q.exchangeShortName ?? c),
          currency: String(q.currency ?? 'USD'),
        })).filter((m: GlobalMover) => m.symbol && m.price > 0)
      } catch {
        return []
      }
    })
  )
  const merged = dedupeMovers(batches.flat())
  merged.sort((a, b) => (b.volume || 0) - (a.volume || 0))
  return merged.slice(0, count)
}

// ─── Twelve Data continent movers (tertiary fallback) ────────────────────
async function twelveContinentMovers(continent: string, count: number, type: 'gainers' | 'losers'): Promise<GlobalMover[]> {
  if (!TWELVE_KEY) return []
  const params = CONTINENT_TWELVE_PARAMS[continent] ?? CONTINENT_TWELVE_PARAMS.global
  const batches = await Promise.all(
    params.slice(0, 2).map(({ exchange, country }) => fetchTwelveMovers(exchange, country, type, count))
  )
  const merged = dedupeMovers(batches.flat())
  merged.sort((a, b) =>
    type === 'gainers' ? b.change_percent - a.change_percent : a.change_percent - b.change_percent
  )
  return merged.slice(0, count)
}

// ─── Unified mover fetch with fallback chain ───────────────────────────────
async function getContinentMovers(continent: string, count: number, type: 'gainers' | 'losers'): Promise<GlobalMover[]> {
  // 1. Yahoo Finance screener (accept partial — Yahoo often rate-limits in cloud)
  const yf = await yfContinentMovers(continent, count, type)
  if (yf.length >= 1) return yf

  // 2. FMP fallback
  const fmp = await fmpContinentMovers(continent, count, type)
  if (fmp.length >= 1) return fmp

  // 3. Twelve Data tertiary
  const twelve = await twelveContinentMovers(continent, count, type)
  return twelve
}

async function getContinentActives(continent: string, count: number): Promise<GlobalMover[]> {
  const yf = await yfContinentActives(continent, count)
  if (yf.length >= 1) return yf
  return fmpContinentActives(continent, count)
}

// ─── GET handler ───────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const continent = searchParams.get('continent') || 'global'
  const exchangeId = searchParams.get('exchange')
  const type = (searchParams.get('type') || 'both') as 'gainers' | 'losers' | 'both'
  const count = Math.min(parseInt(searchParams.get('count') ?? '12', 10), 25)
  const wantActives = searchParams.get('actives') !== '0'

  const empty = { gainers: [] as GlobalMover[], losers: [] as GlobalMover[], actives: [] as GlobalMover[] }

  try {
    // ── Exchange-specific movers ─────────────────────────────────────────
    if (exchangeId) {
      const ex = getExchangeById(exchangeId)
      if (!ex) return NextResponse.json(empty)

      const region = ex.countryCode
      const actN = Math.min(10, count)

      let gainers: GlobalMover[] = []
      let losers: GlobalMover[] = []
      let actives: GlobalMover[] = []

      if (type === 'gainers' || type === 'both') {
        const raw = await fetchYFScreener('day_gainers', region, count * 2)
        gainers = (filterMoversByExchange(raw, ex) as GlobalMover[]).slice(0, count)
        // Fallback if empty
        if (gainers.length < 2 && FMP_KEY) {
          const fmpCode = EXCHANGE_ID_TO_FMP[exchangeId] ?? exchangeId.toUpperCase()
          const fmpRaw = await fetchFMPExchangeMovers(fmpCode, 'gainers', count)
          gainers = fmpRaw.slice(0, count)
        }
      }
      if (type === 'losers' || type === 'both') {
        const raw = await fetchYFScreener('day_losers', region, count * 2)
        losers = (filterMoversByExchange(raw, ex) as GlobalMover[]).slice(0, count)
        if (losers.length < 2 && FMP_KEY) {
          const fmpCode = EXCHANGE_ID_TO_FMP[exchangeId] ?? exchangeId.toUpperCase()
          const fmpRaw = await fetchFMPExchangeMovers(fmpCode, 'losers', count)
          losers = fmpRaw.slice(0, count)
        }
      }
      if (wantActives) {
        const raw = await fetchYFScreener('most_actives', region, count * 2)
        actives = (filterMoversByExchange(raw, ex) as GlobalMover[]).slice(0, actN)
        if (actives.length < 2 && FMP_KEY) {
          const fmpRaw = await fmpContinentActives(continent, actN)
          actives = fmpRaw.slice(0, actN)
        }
      }
      return NextResponse.json({ gainers, losers, actives })
    }

    // ── Global tab: US movers only (fast, reliable) ─────────────────────
    if (continent === 'global') {
      const actN = Math.min(10, count)

      // Yahoo Finance first
      const [yfG, yfL, yfA] = await Promise.all([
        type !== 'losers' ? fetchYFScreener('day_gainers', 'US', count) : Promise.resolve([] as GlobalMover[]),
        type !== 'gainers' ? fetchYFScreener('day_losers', 'US', count) : Promise.resolve([] as GlobalMover[]),
        wantActives ? fetchYFScreener('most_actives', 'US', actN) : Promise.resolve([] as GlobalMover[]),
      ])

      let gainers = type !== 'losers' ? yfG : []
      let losers = type !== 'gainers' ? yfL : []
      let actives = wantActives ? yfA : []

      // FMP fallback for thin lists
      if (gainers.length < 1 && type !== 'losers') gainers = await fetchFMPUSMovers('gainers')
      if (losers.length < 1 && type !== 'gainers') losers = await fetchFMPUSMovers('losers')
      if (actives.length < 1 && wantActives) actives = await fetchFMPUSMovers('actives')

      // Twelve Data tertiary if still empty
      if (gainers.length < 1 && type !== 'losers') gainers = await fetchTwelveMovers('NYSE', undefined, 'gainers', count)
      if (losers.length < 1 && type !== 'gainers') losers = await fetchTwelveMovers('NYSE', undefined, 'losers', count)

      return NextResponse.json({
        gainers: gainers.slice(0, count),
        losers: losers.slice(0, count),
        actives: actives.slice(0, actN),
      })
    }

    // ── Non-global continent movers ─────────────────────────────────────
    const actN = Math.min(12, count)
    const [gainers, losers, actives] = await Promise.all([
      type !== 'losers' ? getContinentMovers(continent, count, 'gainers') : Promise.resolve([] as GlobalMover[]),
      type !== 'gainers' ? getContinentMovers(continent, count, 'losers') : Promise.resolve([] as GlobalMover[]),
      wantActives ? getContinentActives(continent, actN) : Promise.resolve([] as GlobalMover[]),
    ])
    return NextResponse.json({ gainers, losers, actives })
  } catch {
    return NextResponse.json(empty, { status: 200 })
  }
}

// ─── Exchange ID → FMP exchange code ──────────────────────────────────────
const EXCHANGE_ID_TO_FMP: Record<string, string> = {
  nyse: 'NYSE',
  nasdaq: 'NASDAQ',
  tsx: 'TSX',
  b3: 'SAO',
  bmv: 'MEX',
  lse: 'LON',
  frankfurt: 'XETRA',
  euronext: 'PAR',
  six: 'SWX',
  amsterdam: 'XAMS',
  tse: 'JPX',
  hkex: 'HKSE',
  sse: 'SHH',
  nse: 'NSE',
  krx: 'KSC',
  sgx: 'SES',
  jse: 'JSE',
  tadawul: 'SAU',
  asx: 'ASX',
  nzx: 'NZE',
}

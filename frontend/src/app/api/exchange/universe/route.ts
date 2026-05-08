import { NextRequest, NextResponse } from 'next/server'

/**
 * Exchange Universe API — ranked stock lists per exchange
 * Uses FMP screener sorted by market cap to return top N stocks.
 *
 * GET /api/exchange/universe?exchange=us&limit=300
 * GET /api/exchange/universe?exchange=india&limit=100
 *
 * Exchanges: us | india | uk | canada | germany | france | japan | hongkong | china | korea | australia | brazil
 * Returns: { stocks: [{ symbol, name, sector, price, change_percent, market_cap, currency }] }
 *
 * Cached: 6 hours server-side + Next.js revalidate
 */

export const dynamic = 'force-dynamic'

const FMP_KEY = process.env.FMP_API_KEY ?? ''
const TWELVE_KEY = process.env.TWELVE_DATA_API_KEY ?? process.env.TWELVEDATA_API_KEY ?? ''

// ── Exchange config ─────────────────────────────────────────────────────────
const EXCHANGE_CONFIG: Record<string, {
  fmpExchanges: string[]
  twelveExchange?: string
  twelveCountry?: string
  defaultLimit: number
  currency: string
}> = {
  us: { fmpExchanges: ['NYSE', 'NASDAQ', 'AMEX'], defaultLimit: 300, currency: 'USD' },
  india: { fmpExchanges: ['NSE', 'BSE'], twelveExchange: 'NSE', twelveCountry: 'India', defaultLimit: 100, currency: 'INR' },
  uk: { fmpExchanges: ['LON'], twelveExchange: 'LSE', defaultLimit: 75, currency: 'GBP' },
  canada: { fmpExchanges: ['TSX', 'TSXV'], twelveExchange: 'TSX', twelveCountry: 'Canada', defaultLimit: 50, currency: 'CAD' },
  germany: { fmpExchanges: ['XETRA', 'FRA'], defaultLimit: 50, currency: 'EUR' },
  france: { fmpExchanges: ['PAR'], defaultLimit: 40, currency: 'EUR' },
  japan: { fmpExchanges: ['JPX', 'TSE'], twelveExchange: 'TSE', twelveCountry: 'Japan', defaultLimit: 50, currency: 'JPY' },
  hongkong: { fmpExchanges: ['HKSE', 'HKEX'], twelveExchange: 'HKEX', twelveCountry: 'Hong Kong', defaultLimit: 40, currency: 'HKD' },
  china: { fmpExchanges: ['SHH', 'SHZ'], twelveExchange: 'SSE', twelveCountry: 'China', defaultLimit: 40, currency: 'CNY' },
  korea: { fmpExchanges: ['KSC', 'KOSDAQ'], twelveExchange: 'KOSPI', twelveCountry: 'South Korea', defaultLimit: 20, currency: 'KRW' },
  australia: { fmpExchanges: ['ASX'], twelveExchange: 'ASX', twelveCountry: 'Australia', defaultLimit: 20, currency: 'AUD' },
  brazil: { fmpExchanges: ['SAO'], twelveExchange: 'BMFBOVESPA', twelveCountry: 'Brazil', defaultLimit: 15, currency: 'BRL' },
}

export interface UniverseStock {
  symbol: string
  name: string
  sector: string
  industry?: string
  price: number
  change: number
  change_percent: number
  volume: number
  market_cap: number
  currency: string
  rank: number
}

// ── In-memory cache ─────────────────────────────────────────────────────────
const _cache = new Map<string, { data: UniverseStock[]; expires: number }>()
const CACHE_TTL_MS = 6 * 60 * 60 * 1000 // 6 hours

// ── FMP screener ─────────────────────────────────────────────────────────────
async function fetchFMPScreener(exchanges: string[], limit: number): Promise<UniverseStock[]> {
  if (!FMP_KEY) return []
  try {
    const exchangeParam = exchanges.join(',')
    const url = `https://financialmodelingprep.com/api/v3/stock-screener?exchange=${encodeURIComponent(exchangeParam)}&marketCapMoreThan=100000000&limit=${Math.min(limit * 2, 500)}&sortBy=marketCap&sortOrder=desc&apikey=${FMP_KEY}`
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return []
    const data: Record<string, unknown>[] = await res.json()
    if (!Array.isArray(data)) return []

    return data
      .filter((q) => q.symbol && Number(q.price ?? 0) > 0)
      .slice(0, limit)
      .map((q, i) => ({
        symbol: String(q.symbol ?? ''),
        name: String(q.companyName ?? q.symbol ?? ''),
        sector: String(q.sector ?? 'Other'),
        industry: String(q.industry ?? ''),
        price: Number(q.price ?? 0),
        change: Number(q.change ?? 0),
        change_percent: Number(q.changePercentage ?? q.changesPercentage ?? 0),
        volume: Number(q.volume ?? 0),
        market_cap: Number(q.marketCap ?? 0),
        currency: String(q.currency ?? 'USD'),
        rank: i + 1,
      }))
  } catch {
    return []
  }
}

// ── Twelve Data screener fallback ─────────────────────────────────────────────
async function fetchTwelveScreener(exchange: string, country: string | undefined, limit: number): Promise<UniverseStock[]> {
  if (!TWELVE_KEY) return []
  try {
    const params = new URLSearchParams({
      exchange,
      outputsize: String(limit),
      sort: 'DESC',
      sortby: 'market_cap',
      apikey: TWELVE_KEY,
    })
    if (country) params.set('country', country)
    const res = await fetch(`https://api.twelvedata.com/stocks?${params}`, { cache: 'no-store' })
    if (!res.ok) return []
    const data = await res.json()
    const rows: Record<string, unknown>[] = data?.data ?? []
    if (!Array.isArray(rows)) return []
    // Twelve Data stocks endpoint returns metadata, not prices — get batch quotes
    const symbols = rows.slice(0, limit).map((r) => String(r.symbol ?? '')).filter(Boolean)
    if (!symbols.length) return []

    const quoteRes = await fetch(
      `https://api.twelvedata.com/quote?symbol=${symbols.slice(0, 30).join(',')}&apikey=${TWELVE_KEY}`,
      { cache: 'no-store' }
    )
    if (!quoteRes.ok) return []
    const quoteData = await quoteRes.json()

    return symbols.slice(0, 30).map((sym, i) => {
      const qd = Array.isArray(quoteData) ? quoteData[i] : quoteData[sym] ?? {}
      const row = rows.find((r) => r.symbol === sym) ?? {}
      return {
        symbol: sym,
        name: String(row.name ?? qd?.name ?? sym),
        sector: String(row.sector ?? 'Other'),
        industry: '',
        price: Number(qd?.close ?? qd?.price ?? 0),
        change: Number(qd?.change ?? 0),
        change_percent: Number(qd?.percent_change ?? 0),
        volume: Number(qd?.volume ?? 0),
        market_cap: 0,
        currency: String(row.currency ?? 'USD'),
        rank: i + 1,
      }
    }).filter((s) => s.price > 0)
  } catch {
    return []
  }
}

// ── GET handler ─────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const exchange = (searchParams.get('exchange') || 'us').toLowerCase()
  const config = EXCHANGE_CONFIG[exchange]
  if (!config) {
    return NextResponse.json({ error: `Unknown exchange: ${exchange}. Valid: ${Object.keys(EXCHANGE_CONFIG).join(', ')}` }, { status: 400 })
  }

  const limit = Math.min(
    parseInt(searchParams.get('limit') ?? String(config.defaultLimit), 10),
    500
  )

  // Cache check
  const cacheKey = `${exchange}:${limit}`
  const cached = _cache.get(cacheKey)
  if (cached && cached.expires > Date.now()) {
    return NextResponse.json(
      { exchange, count: cached.data.length, stocks: cached.data },
      { headers: { 'X-Cache': 'HIT', 'Cache-Control': 'public, max-age=21600' } }
    )
  }

  // FMP primary
  let stocks = await fetchFMPScreener(config.fmpExchanges, limit)

  // Twelve Data fallback
  if (stocks.length < 5 && config.twelveExchange) {
    stocks = await fetchTwelveScreener(config.twelveExchange, config.twelveCountry, limit)
  }

  // Re-rank after fetch
  stocks = stocks.map((s, i) => ({ ...s, rank: i + 1 }))

  _cache.set(cacheKey, { data: stocks, expires: Date.now() + CACHE_TTL_MS })

  return NextResponse.json(
    { exchange, count: stocks.length, stocks },
    { headers: { 'X-Cache': 'MISS', 'Cache-Control': 'public, max-age=21600' } }
  )
}

import { NextRequest, NextResponse } from 'next/server'
import {
  EXCHANGE_HEATMAP_STOCKS,
  getExchangesByContinent,
  type Continent,
  type ExchangeStock,
} from '@/lib/world-exchanges'

/**
 * Exchange Sector Heatmap API
 * Fetches real-time quotes for exchange-specific stocks and groups by sector.
 *
 * Usage:
 *   GET /api/exchange/heatmap?exchange=jse          → JSE stocks by sector
 *   GET /api/exchange/heatmap?continent=africa      → all Africa exchange stocks
 *   GET /api/exchange/heatmap?continent=europe      → all Europe exchange stocks
 */

const FMP_KEY = process.env.FMP_API_KEY ?? ''

export interface ExchangeStockQuote extends ExchangeStock {
  price: number
  change: number
  change_percent: number
  volume: number
  market_cap: number
  currency: string
}

export interface ExchangeSector {
  sector: string
  change_percent: number
  stocks: ExchangeStockQuote[]
}

// ─── Yahoo Finance chart API (primary) ────────────────────────────────────
async function fetchYahooQuote(symbol: string): Promise<{
  price: number
  change: number
  change_percent: number
  volume: number
  market_cap: number
  currency: string
} | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'application/json',
        Referer: 'https://finance.yahoo.com/',
      },
      next: { revalidate: 120 },
    })
    if (!res.ok) return null

    const data = await res.json()
    const meta = data?.chart?.result?.[0]?.meta
    if (!meta) return null
    const price = Number(meta.regularMarketPrice ?? 0)
    if (price <= 0) return null
    const prev = Number(meta.chartPreviousClose ?? meta.previousClose ?? 0)
    const change = price - prev
    const change_percent = prev > 0 ? (change / prev) * 100 : 0
    return {
      price,
      change,
      change_percent,
      volume: Number(meta.regularMarketVolume ?? 0),
      market_cap: 0,
      currency: String(meta.currency ?? 'USD'),
    }
  } catch {
    return null
  }
}

// ─── FMP batch quote fallback ─────────────────────────────────────────────
async function fetchFMPBatch(symbols: string[]): Promise<Map<string, ReturnType<typeof fetchYahooQuote> extends Promise<infer T> ? NonNullable<T> : never>> {
  const map = new Map<string, { price: number; change: number; change_percent: number; volume: number; market_cap: number; currency: string }>()
  if (!FMP_KEY || symbols.length === 0) return map
  try {
    const encoded = symbols.map(encodeURIComponent).join(',')
    const res = await fetch(
      `https://financialmodelingprep.com/api/v3/quote/${encoded}?apikey=${FMP_KEY}`,
      { next: { revalidate: 120 } }
    )
    if (!res.ok) return map
    const data: Record<string, unknown>[] = await res.json()
    if (!Array.isArray(data)) return map
    for (const q of data) {
      const sym = String(q.symbol ?? '')
      if (!sym) continue
      const price = Number(q.price ?? 0)
      if (price <= 0) continue
      const prev = Number(q.previousClose ?? price)
      map.set(sym, {
        price,
        change: Number(q.change ?? price - prev),
        change_percent: Number(q.changesPercentage ?? 0),
        volume: Number(q.volume ?? 0),
        market_cap: Number(q.marketCap ?? 0),
        currency: String(q.currency ?? 'USD'),
      })
    }
  } catch {
    // silent
  }
  return map
}

// ─── Continent → universe exchange key mapping ─────────────────────────────
const CONTINENT_TO_UNIVERSE: Record<string, string[]> = {
  americas: ['us', 'canada', 'brazil'],
  europe: ['uk', 'germany', 'france'],
  asia: ['japan', 'hongkong', 'china', 'india', 'korea'],
  africa: [],
  oceania: ['australia'],
}

const EXCHANGE_ID_TO_UNIVERSE: Record<string, string> = {
  nyse: 'us', nasdaq: 'us',
  nse: 'india', bse: 'india',
  lse: 'uk',
  frankfurt: 'germany',
  euronext: 'france',
  tsx: 'canada',
  b3: 'brazil',
  tse: 'japan',
  hkex: 'hongkong',
  sse: 'china',
  krx: 'korea',
  asx: 'australia',
}

// ─── Universe exchange → FMP exchange codes ────────────────────────────────
const UNIVERSE_TO_FMP: Record<string, string[]> = {
  us: ['NYSE', 'NASDAQ', 'AMEX'],
  india: ['NSE', 'BSE'],
  uk: ['LON'],
  canada: ['TSX', 'TSXV'],
  germany: ['XETRA', 'FRA'],
  france: ['PAR'],
  japan: ['JPX', 'TSE'],
  hongkong: ['HKSE'],
  china: ['SHH', 'SHZ'],
  korea: ['KSC', 'KOSDAQ'],
  australia: ['ASX'],
  brazil: ['SAO'],
}

// In-memory cache for universe data (6h TTL)
const _universeCache = new Map<string, { data: ExchangeStock[]; expires: number }>()

async function fetchUniverseStocks(universeKey: string, limit: number): Promise<ExchangeStock[]> {
  const cacheKey = `${universeKey}:${limit}`
  const cached = _universeCache.get(cacheKey)
  if (cached && cached.expires > Date.now()) return cached.data

  const fmpExchanges = UNIVERSE_TO_FMP[universeKey]
  if (!fmpExchanges || !FMP_KEY) return []

  try {
    const exchangeParam = fmpExchanges.join(',')
    const res = await fetch(
      `https://financialmodelingprep.com/api/v3/stock-screener?exchange=${encodeURIComponent(exchangeParam)}&marketCapMoreThan=500000000&isActivelyTrading=true&limit=${Math.min(limit * 2, 500)}&sortBy=marketCap&sortOrder=desc&apikey=${FMP_KEY}`,
      { next: { revalidate: 21600 } }
    )
    if (!res.ok) return []
    const data: Record<string, unknown>[] = await res.json()
    if (!Array.isArray(data)) return []

    const stocks: ExchangeStock[] = data
      .filter((q) => q.symbol && Number(q.price ?? 0) > 0)
      .slice(0, limit)
      .map((q) => ({
        symbol: String(q.symbol ?? ''),
        name: String(q.companyName ?? q.symbol ?? ''),
        sector: String(q.sector ?? 'Other'),
      }))

    _universeCache.set(cacheKey, { data: stocks, expires: Date.now() + 6 * 60 * 60 * 1000 })
    return stocks
  } catch {
    return []
  }
}

// ─── GET handler ───────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const exchangeId = searchParams.get('exchange')
  const continent = searchParams.get('continent') as Continent | null

  // Build the stock list to fetch
  let stocks: ExchangeStock[] = []
  let exchangeLabel = ''

  // Limits per exchange
  const EXCHANGE_LIMITS: Record<string, number> = {
    us: 300, india: 100, uk: 75, canada: 50, germany: 50,
    france: 40, japan: 50, hongkong: 40, china: 40, korea: 20, australia: 20, brazil: 15,
  }

  if (exchangeId) {
    const hardcoded = EXCHANGE_HEATMAP_STOCKS[exchangeId] ?? []
    if (hardcoded.length > 0) {
      stocks = hardcoded
    } else {
      const universeKey = EXCHANGE_ID_TO_UNIVERSE[exchangeId]
      if (universeKey) {
        const limit = EXCHANGE_LIMITS[universeKey] ?? 100
        stocks = await fetchUniverseStocks(universeKey, limit)
      }
    }
    exchangeLabel = exchangeId.toUpperCase()
  } else if (continent && continent !== 'global') {
    const exchanges = getExchangesByContinent(continent)
    const seen = new Set<string>()
    for (const ex of exchanges) {
      const exStocks = EXCHANGE_HEATMAP_STOCKS[ex.id] ?? []
      for (const s of exStocks) {
        if (!seen.has(s.symbol)) { seen.add(s.symbol); stocks.push(s) }
      }
    }
    // Supplement sparse lists with universe data
    const universeKeys = CONTINENT_TO_UNIVERSE[continent] ?? []
    if (universeKeys.length > 0) {
      const dynamicBatches = await Promise.all(
        universeKeys.map((k) => fetchUniverseStocks(k, EXCHANGE_LIMITS[k] ?? 50))
      )
      for (const batch of dynamicBatches) {
        for (const s of batch) {
          if (!seen.has(s.symbol)) { seen.add(s.symbol); stocks.push(s) }
        }
      }
    }
    exchangeLabel = continent
  }

  if (stocks.length === 0) {
    return NextResponse.json({ sectors: [], exchangeLabel })
  }

  // Deduplicate by symbol
  const seen = new Set<string>()
  const uniqueStocks = stocks.filter((s) => {
    if (seen.has(s.symbol)) return false
    seen.add(s.symbol)
    return true
  })

  const symbols = uniqueStocks.map((s) => s.symbol)

  // 1. Yahoo Finance parallel fetch
  const BATCH_SIZE = 20
  const yfResults: Map<string, { price: number; change: number; change_percent: number; volume: number; market_cap: number; currency: string } | null> = new Map()

  // Process in batches of 20 to avoid overwhelming Yahoo Finance
  for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
    const batch = symbols.slice(i, i + BATCH_SIZE)
    const results = await Promise.allSettled(batch.map((s) => fetchYahooQuote(s)))
    for (let j = 0; j < batch.length; j++) {
      const r = results[j]
      yfResults.set(batch[j], r.status === 'fulfilled' ? r.value : null)
    }
  }

  // 2. Collect failed symbols for FMP fallback
  const failedSymbols = symbols.filter((s) => {
    const q = yfResults.get(s)
    return !q || q.price <= 0
  })

  const fmpMap = await fetchFMPBatch(failedSymbols.slice(0, 25)) // FMP limit

  // 3. Build sector groups
  const sectorMap: Record<string, ExchangeStockQuote[]> = {}

  for (const stock of uniqueStocks) {
    const quote = yfResults.get(stock.symbol) ?? fmpMap.get(stock.symbol) ?? null
    if (!quote || quote.price <= 0) continue

    const stockQuote: ExchangeStockQuote = {
      ...stock,
      ...quote,
    }

    if (!sectorMap[stock.sector]) sectorMap[stock.sector] = []
    sectorMap[stock.sector].push(stockQuote)
  }

  // 4. Build sector performance array
  const sectors: ExchangeSector[] = Object.entries(sectorMap)
    .map(([sector, sectorStocks]) => {
      const avg = sectorStocks.reduce((acc, s) => acc + s.change_percent, 0) / sectorStocks.length
      return {
        sector,
        change_percent: Math.round(avg * 100) / 100,
        stocks: sectorStocks,
      }
    })
    .sort((a, b) => b.change_percent - a.change_percent)

  return NextResponse.json(
    { sectors, exchangeLabel },
    {
      headers: {
        'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=240',
      },
    }
  )
}

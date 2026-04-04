import { NextRequest, NextResponse } from 'next/server'
import {
  ALL_INDEX_SYMBOLS,
  MACRO_SYMBOL_LABELS,
  WORLD_EXCHANGES,
  getExchangeById,
} from '@/lib/world-exchanges'

/**
 * World Exchange Indices Quote API
 * Provider chain:
 *  1. Yahoo Finance chart API (free, per-symbol)
 *  2. Financial Modeling Prep (batch fallback for failed symbols)
 *  3. Twelve Data (individual fallback)
 */

const FMP_KEY = process.env.FMP_API_KEY ?? ''
const TWELVE_KEY = process.env.TWELVE_DATA_API_KEY ?? ''

export interface IndexQuote {
  symbol: string
  name: string
  shortName: string
  exchangeId: string
  exchangeName: string
  country: string
  countryCode: string
  continent: string
  currency: string
  color: string
  price: number
  change: number
  change_percent: number
  prev_close: number
  day_high: number
  day_low: number
  volume: number
  market_state: string
}

type RawQuote = {
  price: number
  change: number
  change_percent: number
  prev_close: number
  day_high: number
  day_low: number
  volume: number
  market_state: string
}

// ─── Yahoo Finance chart API ───────────────────────────────────────────────
async function fetchYahooQuote(symbol: string): Promise<RawQuote | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        Referer: 'https://finance.yahoo.com/',
      },
      next: { revalidate: 60 },
    })

    if (!res.ok) return null

    const data = await res.json()
    const meta = data?.chart?.result?.[0]?.meta
    if (!meta) return null

    const price = meta.regularMarketPrice ?? 0
    const prev_close = meta.chartPreviousClose ?? meta.previousClose ?? 0
    const change = price - prev_close
    const change_percent = prev_close > 0 ? (change / prev_close) * 100 : 0

    return {
      price,
      change,
      change_percent,
      prev_close,
      day_high: meta.regularMarketDayHigh ?? 0,
      day_low: meta.regularMarketDayLow ?? 0,
      volume: meta.regularMarketVolume ?? 0,
      market_state: meta.marketState ?? 'UNKNOWN',
    }
  } catch {
    return null
  }
}

// ─── FMP batch quote (fallback) ────────────────────────────────────────────
async function fetchFMPQuotesBatch(symbols: string[]): Promise<Map<string, RawQuote>> {
  const result = new Map<string, RawQuote>()
  if (!FMP_KEY || symbols.length === 0) return result

  try {
    // FMP uses %5E for ^ in URL — encode each symbol
    const encoded = symbols.map((s) => encodeURIComponent(s)).join(',')
    const res = await fetch(
      `https://financialmodelingprep.com/api/v3/quote/${encoded}?apikey=${FMP_KEY}`,
      { next: { revalidate: 60 } }
    )
    if (!res.ok) return result
    const data: Record<string, unknown>[] = await res.json()
    if (!Array.isArray(data)) return result

    for (const q of data) {
      const sym = String(q.symbol ?? '')
      if (!sym) continue
      const price = Number(q.price ?? 0)
      const prev_close = Number(q.previousClose ?? 0)
      const change = Number(q.change ?? price - prev_close)
      const change_percent = Number(q.changesPercentage ?? 0)
      result.set(sym, {
        price,
        change,
        change_percent,
        prev_close,
        day_high: Number(q.dayHigh ?? 0),
        day_low: Number(q.dayLow ?? 0),
        volume: Number(q.volume ?? 0),
        market_state: 'REGULAR',
      })
    }
  } catch {
    // silent
  }
  return result
}

// ─── Twelve Data single quote (tertiary fallback) ─────────────────────────
async function fetchTwelveQuote(symbol: string): Promise<RawQuote | null> {
  if (!TWELVE_KEY) return null
  try {
    const res = await fetch(
      `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbol)}&apikey=${TWELVE_KEY}`,
      { next: { revalidate: 60 } }
    )
    if (!res.ok) return null
    const q = await res.json()
    if (q.status === 'error' || !q.close) return null
    const price = Number(q.close ?? 0)
    const prev_close = Number(q.previous_close ?? 0)
    const change = price - prev_close
    const change_percent = prev_close > 0 ? (change / prev_close) * 100 : 0
    return {
      price,
      change,
      change_percent,
      prev_close,
      day_high: Number(q.high ?? 0),
      day_low: Number(q.low ?? 0),
      volume: Number(q.volume ?? 0),
      market_state: 'REGULAR',
    }
  } catch {
    return null
  }
}

// ─── Meta helpers ──────────────────────────────────────────────────────────
function macroMeta(symbol: string) {
  const m = MACRO_SYMBOL_LABELS[symbol]
  return {
    name: m?.name ?? symbol,
    shortName: m?.shortName ?? symbol,
    exchangeId: 'macro',
    exchangeName: 'Macro',
    country: '—',
    countryCode: 'US',
    continent: 'global',
    currency: 'USD',
    color: '#fbbf24',
  }
}

// ─── GET handler ───────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const continent = searchParams.get('continent') || 'global'
  const exchangeId = searchParams.get('exchange')
  const symbolsParam = searchParams.get('symbols')

  // Build index info map
  const indexInfoMap: Record<string, ReturnType<typeof macroMeta>> = {}
  for (const ex of WORLD_EXCHANGES) {
    for (const idx of ex.indices) {
      indexInfoMap[idx.symbol] = {
        name: idx.name,
        shortName: idx.shortName,
        exchangeId: ex.id,
        exchangeName: ex.shortName,
        country: ex.country,
        countryCode: ex.countryCode,
        continent: ex.continent,
        currency: ex.currency,
        color: ex.color,
      }
    }
  }

  let symbols: string[]
  if (symbolsParam) {
    symbols = symbolsParam.split(',').map((s) => s.trim()).filter(Boolean)
  } else if (exchangeId) {
    const ex = getExchangeById(exchangeId)
    symbols = ex ? ex.indices.map((i) => i.symbol) : []
  } else if (continent === 'global') {
    symbols = [...ALL_INDEX_SYMBOLS]
  } else {
    symbols = WORLD_EXCHANGES.filter((ex) => ex.continent === continent).flatMap((ex) =>
      ex.indices.map((i) => i.symbol)
    )
  }

  const batch = symbols.slice(0, 40)

  // 1. Fetch all via Yahoo Finance in parallel
  const yfResults = await Promise.allSettled(batch.map((s) => fetchYahooQuote(s)))

  // Identify which symbols failed
  const failedSymbols: string[] = []
  const yfMap = new Map<string, RawQuote | null>()
  for (let i = 0; i < batch.length; i++) {
    const r = yfResults[i]
    const sym = batch[i]
    const val = r.status === 'fulfilled' ? r.value : null
    yfMap.set(sym, val)
    if (!val || val.price <= 0) failedSymbols.push(sym)
  }

  // 2. FMP batch fallback for failed symbols (max 20 at a time to save quota)
  const fmpMap = failedSymbols.length > 0
    ? await fetchFMPQuotesBatch(failedSymbols.slice(0, 20))
    : new Map<string, RawQuote>()

  // 3. Twelve Data for still-missing high-priority symbols (only the main indices)
  const stillMissing = failedSymbols.filter((s) => !fmpMap.has(s))
  const priorityMissing = stillMissing.filter((s) =>
    ['^GSPC', '^IXIC', '^DJI', '^N225', '^HSI', '^FTSE', '^GDAXI'].includes(s)
  )
  const twelveMap = new Map<string, RawQuote>()
  if (priorityMissing.length > 0) {
    const twelveResults = await Promise.allSettled(
      priorityMissing.map((s) => fetchTwelveQuote(s))
    )
    for (let i = 0; i < priorityMissing.length; i++) {
      const r = twelveResults[i]
      if (r.status === 'fulfilled' && r.value) {
        twelveMap.set(priorityMissing[i], r.value)
      }
    }
  }

  // Build final quotes array
  const quotes: IndexQuote[] = []
  for (const symbol of batch) {
    const info = indexInfoMap[symbol] ?? macroMeta(symbol)
    const quote = yfMap.get(symbol) ?? fmpMap.get(symbol) ?? twelveMap.get(symbol) ?? null

    if (quote && quote.price > 0) {
      quotes.push({ symbol, ...info, ...quote })
    } else {
      // Include with zero data so UI at least shows the index name
      quotes.push({
        symbol,
        ...info,
        price: 0,
        change: 0,
        change_percent: 0,
        prev_close: 0,
        day_high: 0,
        day_low: 0,
        volume: 0,
        market_state: 'CLOSED',
      })
    }
  }

  return NextResponse.json(quotes, {
    headers: {
      'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
    },
  })
}

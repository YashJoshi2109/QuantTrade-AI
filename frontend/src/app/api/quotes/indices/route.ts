import { NextRequest, NextResponse } from 'next/server'
import {
  ALL_INDEX_SYMBOLS,
  MACRO_SYMBOL_LABELS,
  WORLD_EXCHANGES,
  getExchangeById,
} from '@/lib/world-exchanges'

/**
 * World Exchange Indices Quote API
 * Fetches real-time prices for all world exchange indices via Yahoo Finance
 */

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

async function fetchYahooQuote(symbol: string): Promise<{
  price: number
  change: number
  change_percent: number
  prev_close: number
  day_high: number
  day_low: number
  volume: number
  market_state: string
} | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; QuantTradeAI/1.0)',
        Accept: 'application/json',
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

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const continent = searchParams.get('continent') || 'global'
  const exchangeId = searchParams.get('exchange')
  const symbolsParam = searchParams.get('symbols')

  // Build index map for quick lookup
  const indexInfoMap: Record<string, { name: string; shortName: string; exchangeId: string; exchangeName: string; country: string; countryCode: string; continent: string; currency: string; color: string }> = {}

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
    symbols = symbolsParam
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
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

  // Fetch all quotes in parallel (max 40 concurrent for custom symbol lists)
  const batch = symbols.slice(0, 40)
  const results = await Promise.allSettled(batch.map((s) => fetchYahooQuote(s)))

  const quotes: IndexQuote[] = []
  for (let i = 0; i < batch.length; i++) {
    const symbol = batch[i]
    const info = indexInfoMap[symbol] ?? macroMeta(symbol)

    const result = results[i]
    if (result.status === 'fulfilled' && result.value) {
      quotes.push({
        symbol,
        ...info,
        ...result.value,
      })
    } else {
      // Include with zero data so UI can show the index name at least
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

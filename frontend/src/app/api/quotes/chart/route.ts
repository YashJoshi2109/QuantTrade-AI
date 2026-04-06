import { NextRequest, NextResponse } from 'next/server'

/**
 * Stock chart data proxy — Yahoo Finance chart API
 * Returns OHLCV candles for sparklines and charts.
 *
 * GET /api/quotes/chart?symbol=AAPL&range=1d&interval=5m
 * Ranges: 1d | 5d | 1mo | 3mo | 1y
 * Intervals: 1m | 5m | 15m | 30m | 60m | 1d | 1wk
 */

export const dynamic = 'force-dynamic'

const RANGE_TO_INTERVAL: Record<string, string> = {
  '1d': '5m',
  '5d': '30m',
  '1mo': '1d',
  '3mo': '1d',
  '1y': '1wk',
}

const CACHE_TTL: Record<string, number> = {
  '1d': 60,       // 1 min
  '5d': 120,      // 2 min
  '1mo': 300,     // 5 min
  '3mo': 600,     // 10 min
  '1y': 1800,     // 30 min
}

// In-memory cache: key → { data, expires }
const _cache = new Map<string, { data: unknown; expires: number }>()

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const symbol = (searchParams.get('symbol') || '').toUpperCase()
  const range = searchParams.get('range') || '1d'
  const interval = searchParams.get('interval') || RANGE_TO_INTERVAL[range] || '5m'

  if (!symbol) {
    return NextResponse.json({ error: 'symbol required' }, { status: 400 })
  }

  const cacheKey = `${symbol}:${range}:${interval}`
  const cached = _cache.get(cacheKey)
  if (cached && cached.expires > Date.now()) {
    return NextResponse.json(cached.data, {
      headers: { 'X-Cache': 'HIT', 'Cache-Control': `public, max-age=${CACHE_TTL[range] ?? 60}` },
    })
  }

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}&includePrePost=false`
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Accept: 'application/json',
        Referer: 'https://finance.yahoo.com/',
      },
    })

    if (!res.ok) {
      return NextResponse.json({ error: `Yahoo Finance returned ${res.status}`, closes: [] }, { status: 200 })
    }

    const raw = await res.json()
    const result = raw?.chart?.result?.[0]
    if (!result) {
      return NextResponse.json({ closes: [], timestamps: [] })
    }

    const meta = result.meta ?? {}
    const timestamps: number[] = result.timestamp ?? []
    const quotes = result.indicators?.quote?.[0] ?? {}
    const closes: number[] = (quotes.close ?? []).map((v: number | null) => v ?? 0)
    const highs: number[] = (quotes.high ?? []).map((v: number | null) => v ?? 0)
    const lows: number[] = (quotes.low ?? []).map((v: number | null) => v ?? 0)
    const volumes: number[] = (quotes.volume ?? []).map((v: number | null) => v ?? 0)

    // Filter out zero/null candles
    const valid = timestamps.map((t, i) => ({
      t,
      o: (quotes.open ?? [])[i] ?? 0,
      h: highs[i],
      l: lows[i],
      c: closes[i],
      v: volumes[i],
    })).filter((c) => c.c > 0)

    const data = {
      symbol,
      range,
      interval,
      currency: meta.currency ?? 'USD',
      regularMarketPrice: meta.regularMarketPrice ?? 0,
      previousClose: meta.chartPreviousClose ?? meta.previousClose ?? 0,
      timestamps: valid.map((c) => c.t),
      closes: valid.map((c) => c.c),
      highs: valid.map((c) => c.h),
      lows: valid.map((c) => c.l),
      volumes: valid.map((c) => c.v),
    }

    const ttl = CACHE_TTL[range] ?? 60
    _cache.set(cacheKey, { data, expires: Date.now() + ttl * 1000 })

    return NextResponse.json(data, {
      headers: { 'X-Cache': 'MISS', 'Cache-Control': `public, max-age=${ttl}` },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg, closes: [] }, { status: 200 })
  }
}

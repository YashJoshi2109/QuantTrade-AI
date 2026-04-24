import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const FINNHUB_KEY = process.env.FINNHUB_API_KEY || ''
const BASE = 'https://finnhub.io/api/v1'

/** Per-IP sliding window: max requests per minute (Finnhub free tier is 60/min; stay under globally). */
const RATE_WINDOW_MS = 60_000
const RATE_MAX = 40
const ipBuckets = new Map<string, number[]>()

function clientIp(req: NextRequest): string {
  const xf = req.headers.get('x-forwarded-for')
  if (xf) return xf.split(',')[0]?.trim() || 'unknown'
  return req.headers.get('x-real-ip') || 'local'
}

function allowRate(ip: string): boolean {
  const now = Date.now()
  const prev = ipBuckets.get(ip) ?? []
  const fresh = prev.filter((t) => now - t < RATE_WINDOW_MS)
  if (fresh.length >= RATE_MAX) return false
  fresh.push(now)
  ipBuckets.set(ip, fresh)
  return true
}

async function fhFetch(path: string) {
  const sep = path.includes('?') ? '&' : '?'
  const res = await fetch(`${BASE}${path}${sep}token=${FINNHUB_KEY}`, {
    headers: { 'User-Agent': 'QuantTrade/1.0' },
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`Finnhub ${res.status}: ${path}`)
  return res.json()
}

export async function GET(req: NextRequest) {
  const ip = clientIp(req)
  if (!allowRate(ip)) {
    return NextResponse.json(
      { error: 'Too many Finnhub proxy requests. Try again in a minute.' },
      { status: 429, headers: { 'Retry-After': '60' } }
    )
  }

  if (!FINNHUB_KEY) {
    return NextResponse.json({ error: 'FINNHUB_API_KEY not configured' }, { status: 503 })
  }

  const { searchParams } = req.nextUrl
  const type = searchParams.get('type') || ''
  const symbol = (searchParams.get('symbol') || '').toUpperCase()

  // Date helpers
  const toDate = (d: Date) => d.toISOString().split('T')[0]
  const today = toDate(new Date())
  const past90 = toDate(new Date(Date.now() - 90 * 86400_000))
  const future90 = toDate(new Date(Date.now() + 90 * 86400_000))
  const past7 = toDate(new Date(Date.now() - 7 * 86400_000))

  try {
    switch (type) {
      // ── Real-time quote ──────────────────────────────────────────────────────
      case 'quote': {
        if (!symbol) return NextResponse.json({ error: 'symbol required' }, { status: 400 })
        const data = await fhFetch(`/quote?symbol=${symbol}`)
        return NextResponse.json(data)
      }

      // ── Company Profile (exchange, name, market cap, currency) ─────────────
      case 'profile': {
        if (!symbol) return NextResponse.json({ error: 'symbol required' }, { status: 400 })
        const data = await fhFetch(`/stock/profile2?symbol=${symbol}`)
        return NextResponse.json(data)
      }

      // ── Basic Financials (all metrics) ──────────────────────────────────────
      case 'basic-financials': {
        if (!symbol) return NextResponse.json({ error: 'symbol required' }, { status: 400 })
        const data = await fhFetch(`/stock/metric?symbol=${symbol}&metric=all`)
        return NextResponse.json(data)
      }

      // ── Recommendation Trends ────────────────────────────────────────────────
      case 'recommendations': {
        if (!symbol) return NextResponse.json({ error: 'symbol required' }, { status: 400 })
        const data = await fhFetch(`/stock/recommendation?symbol=${symbol}`)
        // Return latest 6 periods
        return NextResponse.json(Array.isArray(data) ? data.slice(0, 6) : data)
      }

      // ── Insider Transactions ─────────────────────────────────────────────────
      case 'insider-transactions': {
        if (!symbol) return NextResponse.json({ error: 'symbol required' }, { status: 400 })
        const data = await fhFetch(`/stock/insider-transactions?symbol=${symbol}`)
        // data.data is the array, limit to 50 most recent
        const transactions = data?.data ?? data
        const limited = Array.isArray(transactions)
          ? transactions.slice(0, 50)
          : transactions
        return NextResponse.json(limited)
      }

      // ── Company News ─────────────────────────────────────────────────────────
      case 'company-news': {
        if (!symbol) return NextResponse.json({ error: 'symbol required' }, { status: 400 })
        const data = await fhFetch(`/company-news?symbol=${symbol}&from=${past7}&to=${today}`)
        return NextResponse.json(Array.isArray(data) ? data.slice(0, 20) : data)
      }

      // ── SEC Filings ──────────────────────────────────────────────────────────
      case 'sec-filings': {
        if (!symbol) return NextResponse.json({ error: 'symbol required' }, { status: 400 })
        const data = await fhFetch(`/stock/filings?symbol=${symbol}`)
        // Limit to 250 as specified
        const filings = Array.isArray(data) ? data.slice(0, 250) : (data?.filings ?? [])
        return NextResponse.json(filings)
      }

      // ── IPO Calendar ─────────────────────────────────────────────────────────
      case 'ipo-calendar': {
        const data = await fhFetch(`/calendar/ipo?from=${today}&to=${future90}`)
        return NextResponse.json(data?.ipoCalendar ?? [])
      }

      // ── Country Metadata ─────────────────────────────────────────────────────
      case 'country': {
        const data = await fhFetch('/country')
        return NextResponse.json(Array.isArray(data) ? data : [])
      }

      // ── Earnings Calendar ─────────────────────────────────────────────────────
      case 'earnings-calendar': {
        const from = searchParams.get('from') || today
        const to = searchParams.get('to') || future90
        const symParam = symbol ? `&symbol=${symbol}` : ''
        const data = await fhFetch(`/calendar/earnings?from=${from}&to=${to}${symParam}`)
        return NextResponse.json(data?.earningsCalendar ?? [])
      }

      // ── Stock Candle (OHLCV for sparkline/chart) ─────────────────────────────
      case 'candle': {
        if (!symbol) return NextResponse.json({ error: 'symbol required' }, { status: 400 })
        const resolution = searchParams.get('resolution') || '60'
        const from = searchParams.get('from') || String(Math.floor((Date.now() - 30 * 86400_000) / 1000))
        const to = searchParams.get('to') || String(Math.floor(Date.now() / 1000))
        const data = await fhFetch(`/stock/candle?symbol=${symbol}&resolution=${resolution}&from=${from}&to=${to}`)
        return NextResponse.json(data)
      }

      // ── Symbol List (NYSE + NASDAQ + AMEX → 12,000+ US stocks) ───────────────
      // Finnhub /stock/symbol returns all listed stocks for a given exchange.
      // exchange=US  → covers NYSE + NASDAQ + AMEX (~8,000-11,000 symbols, common stocks + ETFs)
      // exchange=OTC → OTC / Pink sheet markets (~3,000-5,000 additional symbols)
      // Combined: 12,000-16,000 publicly traded US symbols.
      case 'symbol-list': {
        const exchange = (searchParams.get('exchange') || 'US').toUpperCase()
        if (!['US', 'OTC', 'NYSE', 'NASDAQ', 'AMEX'].includes(exchange)) {
          return NextResponse.json({ error: 'exchange must be US | OTC | NYSE | NASDAQ | AMEX' }, { status: 400 })
        }
        // Map friendly names to Finnhub exchange codes
        const fhExchange = exchange === 'NYSE' ? 'NYSE' : exchange === 'NASDAQ' ? 'NASDAQ' : exchange === 'AMEX' ? 'AS' : exchange
        const data = await fhFetch(`/stock/symbol?exchange=${fhExchange}&securityType=Common Stock`)
        const symbols = Array.isArray(data) ? data : []
        // Return minimal payload: symbol, description (company name), type, exchange
        const mapped = symbols.map((s: { symbol: string; description: string; type: string; exchange?: string }) => ({
          symbol: s.symbol,
          name: s.description,
          type: s.type,
          exchange: s.exchange ?? fhExchange,
        }))
        return NextResponse.json({ count: mapped.length, exchange: fhExchange, symbols: mapped })
      }

      // ── Symbol Search (full text search via Finnhub) ───────────────────────────
      case 'symbol-search': {
        const q = searchParams.get('q') || symbol
        if (!q) return NextResponse.json({ error: 'q or symbol required' }, { status: 400 })
        const data = await fhFetch(`/search?q=${encodeURIComponent(q)}`)
        return NextResponse.json(data?.result ?? [])
      }

      default:
        return NextResponse.json({ error: 'type required: quote | candle | basic-financials | recommendations | insider-transactions | company-news | sec-filings | ipo-calendar | country | earnings-calendar | symbol-list | symbol-search' }, { status: 400 })
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[finnhub]', msg)
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}

import { NextRequest, NextResponse } from 'next/server'

const FINNHUB_KEY = process.env.FINNHUB_API_KEY || ''
const BASE = 'https://finnhub.io/api/v1'

async function fhFetch(path: string) {
  const sep = path.includes('?') ? '&' : '?'
  const res = await fetch(`${BASE}${path}${sep}token=${FINNHUB_KEY}`, {
    headers: { 'User-Agent': 'QuantTrade/1.0' },
    next: { revalidate: 60 },
  })
  if (!res.ok) throw new Error(`Finnhub ${res.status}: ${path}`)
  return res.json()
}

export async function GET(req: NextRequest) {
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

      default:
        return NextResponse.json({ error: 'type required: quote | basic-financials | recommendations | insider-transactions | company-news | sec-filings | ipo-calendar | country | earnings-calendar' }, { status: 400 })
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[finnhub]', msg)
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}

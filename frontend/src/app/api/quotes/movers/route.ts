import { NextRequest, NextResponse } from 'next/server'
import { filterMoversByExchange, getExchangeById } from '@/lib/world-exchanges'

/**
 * Global Market Movers API
 * Fetches gainers, losers, and most-active (volume) via Yahoo Finance screeners
 */

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

const CONTINENT_REGIONS: Record<string, string[]> = {
  global: ['US'],
  americas: ['US', 'CA', 'BR', 'MX'],
  europe: ['GB', 'DE', 'FR', 'CH', 'NL', 'IT', 'ES', 'SE'],
  asia: ['JP', 'HK', 'CN', 'IN', 'KR', 'SG', 'AU', 'TW'],
  africa: ['ZA', 'SA'],
  oceania: ['AU', 'NZ'],
}

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
        'User-Agent': 'Mozilla/5.0 (compatible; QuantTradeAI/1.0)',
        Accept: 'application/json',
      },
      next: { revalidate: 120 },
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

async function mergedContinentMovers(
  continent: string,
  count: number,
  type: 'gainers' | 'losers'
): Promise<GlobalMover[]> {
  const regions = CONTINENT_REGIONS[continent] ?? CONTINENT_REGIONS.global
  const scrId = type === 'gainers' ? 'day_gainers' : 'day_losers'
  const batches = await Promise.all(regions.map((r) => fetchYFScreener(scrId, r, count)))
  const merged = dedupeMovers(batches.flat())
  merged.sort((a, b) =>
    type === 'gainers'
      ? b.change_percent - a.change_percent
      : a.change_percent - b.change_percent
  )
  return merged.slice(0, count)
}

async function mergedContinentActives(continent: string, count: number): Promise<GlobalMover[]> {
  const regions = CONTINENT_REGIONS[continent] ?? CONTINENT_REGIONS.global
  const batches = await Promise.all(regions.map((r) => fetchYFScreener('most_actives', r, count)))
  const merged = dedupeMovers(batches.flat())
  merged.sort((a, b) => (b.volume || 0) - (a.volume || 0))
  return merged.slice(0, count)
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const continent = searchParams.get('continent') || 'global'
  const exchangeId = searchParams.get('exchange')
  const type = (searchParams.get('type') || 'both') as 'gainers' | 'losers' | 'both'
  const count = Math.min(parseInt(searchParams.get('count') ?? '12', 10), 25)
  const wantActives = searchParams.get('actives') !== '0'

  const empty = { gainers: [] as GlobalMover[], losers: [] as GlobalMover[], actives: [] as GlobalMover[] }

  try {
    if (exchangeId) {
      const ex = getExchangeById(exchangeId)
      if (!ex) {
        return NextResponse.json(empty)
      }
      const region = ex.countryCode
      const actN = Math.min(10, count)

      if (type === 'gainers') {
        const raw = await fetchYFScreener('day_gainers', region, count * 2)
        const gainers = filterMoversByExchange(raw, ex).slice(0, count)
        const actives = wantActives
          ? filterMoversByExchange(
              await fetchYFScreener('most_actives', region, count * 2),
              ex
            ).slice(0, actN)
          : []
        return NextResponse.json({ gainers, losers: [], actives })
      }
      if (type === 'losers') {
        const raw = await fetchYFScreener('day_losers', region, count * 2)
        const losers = filterMoversByExchange(raw, ex).slice(0, count)
        const actives = wantActives
          ? filterMoversByExchange(
              await fetchYFScreener('most_actives', region, count * 2),
              ex
            ).slice(0, actN)
          : []
        return NextResponse.json({ gainers: [], losers, actives })
      }
      const [gRaw, lRaw, aRaw] = await Promise.all([
        fetchYFScreener('day_gainers', region, count * 2),
        fetchYFScreener('day_losers', region, count * 2),
        wantActives ? fetchYFScreener('most_actives', region, count * 2) : Promise.resolve([]),
      ])
      return NextResponse.json({
        gainers: filterMoversByExchange(gRaw, ex).slice(0, count),
        losers: filterMoversByExchange(lRaw, ex).slice(0, count),
        actives: wantActives ? filterMoversByExchange(aRaw, ex).slice(0, actN) : [],
      })
    }

    if (continent === 'global') {
      const primaryRegion = CONTINENT_REGIONS.global[0]
      const actN = Math.min(10, count)

      if (type === 'gainers') {
        const gainers = await fetchYFScreener('day_gainers', primaryRegion, count)
        const actives = wantActives
          ? await fetchYFScreener('most_actives', primaryRegion, actN)
          : []
        return NextResponse.json({ gainers, losers: [], actives })
      }
      if (type === 'losers') {
        const losers = await fetchYFScreener('day_losers', primaryRegion, count)
        const actives = wantActives
          ? await fetchYFScreener('most_actives', primaryRegion, actN)
          : []
        return NextResponse.json({ gainers: [], losers, actives })
      }
      const [gainers, losers, actives] = await Promise.all([
        fetchYFScreener('day_gainers', primaryRegion, count),
        fetchYFScreener('day_losers', primaryRegion, count),
        wantActives ? fetchYFScreener('most_actives', primaryRegion, actN) : Promise.resolve([]),
      ])
      return NextResponse.json({ gainers, losers, actives })
    }

    const actN = Math.min(12, count)

    if (type === 'gainers') {
      const gainers = await mergedContinentMovers(continent, count, 'gainers')
      const actives = wantActives ? await mergedContinentActives(continent, actN) : []
      return NextResponse.json({ gainers, losers: [], actives })
    }
    if (type === 'losers') {
      const losers = await mergedContinentMovers(continent, count, 'losers')
      const actives = wantActives ? await mergedContinentActives(continent, actN) : []
      return NextResponse.json({ gainers: [], losers, actives })
    }
    const [gainers, losers, actives] = await Promise.all([
      mergedContinentMovers(continent, count, 'gainers'),
      mergedContinentMovers(continent, count, 'losers'),
      wantActives ? mergedContinentActives(continent, actN) : Promise.resolve([]),
    ])
    return NextResponse.json({ gainers, losers, actives })
  } catch {
    return NextResponse.json(empty, { status: 200 })
  }
}

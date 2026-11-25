import { NextResponse } from 'next/server'

/**
 * Currency Exchange Rates API
 * Provider chain:
 *  1. ApiLayer Currency Data API (100 req/day free — very reliable)
 *  2. open.er-api.com (1500 req/month free — fallback)
 *  3. frankfurter.app (free, no limit — final fallback)
 *
 * The previous version awaited the providers one after another with no
 * timeout: a single hung upstream kept the route open until nginx gave up
 * (504). Now every provider call has a hard timeout, all providers race in
 * parallel (first good answer wins, in priority order when several succeed),
 * and the last good rates are served — flagged `stale` — when all of them fail.
 */

const APILAYER_KEY = process.env.APILAYER_CURRENCY_KEY ?? ''
const PROVIDER_TIMEOUT_MS = 4_000
const FRESH_MS = 60 * 60 * 1000 // rates refresh hourly upstream

export interface CurrencyRates {
  base: string
  rates: Record<string, number>
  timestamp: number
  stale?: boolean
  source?: string
}

type Rates = Record<string, number>

let lastGood: { rates: Rates; source: string; at: number } | null = null
let inflight: Promise<{ rates: Rates; source: string } | null> | null = null

async function getJson(url: string, init: RequestInit = {}): Promise<any | null> {
  try {
    const res = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      next: { revalidate: 3600 },
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null // timeout, DNS, TLS or JSON error
  }
}

function usable(rates: unknown): rates is Rates {
  return !!rates && typeof rates === 'object' && Object.keys(rates as object).length >= 10
}

async function fetchApiLayer(): Promise<Rates | null> {
  if (!APILAYER_KEY) return null
  const data = await getJson('https://api.apilayer.com/currency_data/live?source=USD', {
    headers: { apikey: APILAYER_KEY },
  })
  if (!data?.success || !data.quotes) return null
  // ApiLayer returns quotes prefixed with source: "USDEUR" → "EUR"
  const rates: Rates = {}
  for (const [key, value] of Object.entries(data.quotes as Record<string, number>)) {
    rates[key.slice(3)] = value
  }
  return rates
}

async function fetchOpenEr(): Promise<Rates | null> {
  const data = await getJson('https://open.er-api.com/v6/latest/USD', {
    headers: { Accept: 'application/json' },
  })
  return data?.rates ?? null
}

async function fetchFrankfurter(): Promise<Rates | null> {
  const data = await getJson('https://api.frankfurter.app/latest?from=USD')
  return data?.rates ? { ...data.rates, USD: 1 } : null
}

const PROVIDERS: Array<[string, () => Promise<Rates | null>]> = [
  ['apilayer', fetchApiLayer],
  ['open.er-api', fetchOpenEr],
  ['frankfurter', fetchFrankfurter],
]

/** Race all providers; resolve with the highest-priority usable answer (bounded by the timeout). */
async function fetchRates(): Promise<{ rates: Rates; source: string } | null> {
  const results = await Promise.all(
    PROVIDERS.map(async ([name, fn]) => {
      const rates = await fn().catch(() => null)
      return usable(rates) ? { rates, source: name } : null
    }),
  )
  return results.find((r) => r !== null) ?? null
}

export async function GET() {
  const now = Date.now()
  if (lastGood && now - lastGood.at < FRESH_MS) {
    return respond(lastGood.rates, lastGood.source, lastGood.at, false)
  }

  // One upstream round-trip at a time for all concurrent requests.
  inflight ??= fetchRates().finally(() => {
    inflight = null
  })
  const fresh = await inflight
  if (fresh) {
    lastGood = { ...fresh, at: Date.now() }
    return respond(fresh.rates, fresh.source, lastGood.at, false)
  }
  if (lastGood) {
    return respond(lastGood.rates, lastGood.source, lastGood.at, true)
  }
  return NextResponse.json(
    { error: 'Failed to fetch currency rates' },
    { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '60' } },
  )
}

function respond(rates: Rates, source: string, at: number, stale: boolean) {
  const body: CurrencyRates = { base: 'USD', rates, timestamp: at, source, ...(stale ? { stale: true } : {}) }
  return NextResponse.json(body, {
    headers: {
      'Cache-Control': stale
        ? 'public, s-maxage=60, stale-while-revalidate=600'
        : 'public, s-maxage=3600, stale-while-revalidate=7200',
    },
  })
}

import { NextResponse } from 'next/server'

/**
 * Currency Exchange Rates API
 * Provider chain:
 *  1. ApiLayer Currency Data API (100 req/day free — very reliable)
 *  2. open.er-api.com (1500 req/month free — fallback)
 *  3. frankfurter.app (free, no limit — final fallback)
 */

const APILAYER_KEY = process.env.APILAYER_CURRENCY_KEY ?? ''

export interface CurrencyRates {
  base: string
  rates: Record<string, number>
  timestamp: number
}

async function fetchApiLayer(): Promise<Record<string, number> | null> {
  if (!APILAYER_KEY) return null
  try {
    const res = await fetch('https://api.apilayer.com/currency_data/live?source=USD', {
      headers: { apikey: APILAYER_KEY },
      next: { revalidate: 3600 },
    })
    if (!res.ok) return null
    const data = await res.json()
    if (!data.success || !data.quotes) return null
    // ApiLayer returns quotes prefixed with source: "USDEUR" → "EUR"
    const rates: Record<string, number> = {}
    for (const [key, value] of Object.entries(data.quotes as Record<string, number>)) {
      const currency = key.slice(3) // remove "USD" prefix
      rates[currency] = value
    }
    return rates
  } catch {
    return null
  }
}

async function fetchOpenEr(): Promise<Record<string, number> | null> {
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD', {
      next: { revalidate: 3600 },
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return null
    const data = await res.json()
    return data.rates ?? null
  } catch {
    return null
  }
}

async function fetchFrankfurter(): Promise<Record<string, number> | null> {
  try {
    const res = await fetch('https://api.frankfurter.app/latest?from=USD', {
      next: { revalidate: 3600 },
    })
    if (!res.ok) return null
    const data = await res.json()
    const rates = { ...data.rates, USD: 1 }
    return rates
  } catch {
    return null
  }
}

export async function GET() {
  // Try providers in order
  const rates =
    (await fetchApiLayer()) ??
    (await fetchOpenEr()) ??
    (await fetchFrankfurter())

  if (!rates) {
    return NextResponse.json({ error: 'Failed to fetch currency rates' }, { status: 503 })
  }

  const response: CurrencyRates = {
    base: 'USD',
    rates,
    timestamp: Date.now(),
  }

  return NextResponse.json(response, {
    headers: {
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200',
    },
  })
}

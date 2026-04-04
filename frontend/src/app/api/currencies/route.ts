import { NextResponse } from 'next/server'

/**
 * Currency Exchange Rates API
 * Uses open.er-api.com (free tier: 1500 req/month)
 * Cached for 1 hour to stay well within limits
 */

export interface CurrencyRates {
  base: string
  rates: Record<string, number>
  timestamp: number
}

export async function GET() {
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD', {
      next: { revalidate: 3600 }, // cache 1 hour
      headers: { Accept: 'application/json' },
    })

    if (!res.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch rates' },
        { status: res.status }
      )
    }

    const data = await res.json()

    const rates: CurrencyRates = {
      base: 'USD',
      rates: data.rates ?? {},
      timestamp: Date.now(),
    }

    return NextResponse.json(rates, {
      headers: {
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200',
      },
    })
  } catch {
    return NextResponse.json({ error: 'Network error' }, { status: 500 })
  }
}

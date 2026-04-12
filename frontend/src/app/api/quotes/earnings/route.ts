import { NextRequest, NextResponse } from 'next/server'

/**
 * Earnings history API — returns quarterly EPS actual vs estimate.
 * Primary: Finnhub /stock/earnings (free, up to 4 quarters)
 * Fallback: FMP /stable/earnings-surprises
 */

export interface EarningsQuarter {
  period: string      // e.g. "2026-01-31"
  quarter: number     // e.g. 4
  year: number        // e.g. 2026
  actual: number | null
  estimate: number | null
  surprise_percent: number | null
}

async function fetchFinnhubEarnings(symbol: string): Promise<EarningsQuarter[]> {
  const key = process.env.FINNHUB_API_KEY
  if (!key) return []
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/stock/earnings?symbol=${encodeURIComponent(symbol)}&limit=8&token=${key}`,
      { next: { revalidate: 3600 } },
    )
    if (!res.ok) return []
    const data = await res.json()
    if (!Array.isArray(data)) return []
    return data.map((e: Record<string, unknown>) => ({
      period: String(e.period ?? ''),
      quarter: Number(e.quarter ?? 0),
      year: Number(e.year ?? 0),
      actual: typeof e.actual === 'number' ? e.actual : null,
      estimate: typeof e.estimate === 'number' ? e.estimate : null,
      surprise_percent: typeof e.surprisePercent === 'number' ? e.surprisePercent : null,
    }))
  } catch {
    return []
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const symbol = searchParams.get('symbol')?.trim()?.toUpperCase()

  if (!symbol) {
    return NextResponse.json({ error: 'Missing symbol' }, { status: 400 })
  }

  const earnings = await fetchFinnhubEarnings(symbol)

  return NextResponse.json(
    { symbol, quarters: earnings },
    { headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200' } },
  )
}

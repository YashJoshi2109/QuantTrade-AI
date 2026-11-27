import { NextRequest, NextResponse } from 'next/server'
import { searchYahoo, type GlobalSearchResult } from '../yahooSearch'

/**
 * Global stock search proxy
 * Searches Yahoo Finance for ~53,795+ global equities across all exchanges.
 * This server-side route avoids CORS restrictions on the Yahoo Finance API.
 */

export type { GlobalSearchResult } from '../yahooSearch'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const query = searchParams.get('q')?.trim()
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '15', 10), 30)

  if (!query || query.length < 1) {
    return NextResponse.json([] as GlobalSearchResult[], { status: 200 })
  }

  // Silently returns [] on upstream/network errors.
  return NextResponse.json(await searchYahoo(query, limit))
}

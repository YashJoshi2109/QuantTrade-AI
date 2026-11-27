import { NextRequest, NextResponse } from 'next/server'
import { searchYahoo } from './yahooSearch'
import { mergeSearchResults, type DbSearchRow, type SearchResponse } from '@/lib/symbolSearch'

/**
 * Unified symbol search for the global search UI: ONE browser request per
 * query. Merges our symbol master (/api/v1/symbols/search: ranked, market
 * cap) with Yahoo's global search (other exchanges, indices, crypto), deduped
 * by ticker. Either source failing just means fewer results.
 */

const UPSTREAM_TIMEOUT_MS = 4_000

async function searchDb(query: string, limit: number, signal: AbortSignal): Promise<DbSearchRow[]> {
  const base = (process.env.BACKEND_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || '').replace(/\/$/, '')
  if (!base) return []
  try {
    const url = `${base}/api/v1/symbols/search?q=${encodeURIComponent(query)}&limit=${limit}`
    const res = await fetch(url, { headers: { Accept: 'application/json' }, next: { revalidate: 60 }, signal })
    if (!res.ok) return []
    const json: unknown = await res.json()
    return Array.isArray(json) ? (json as DbSearchRow[]) : []
  } catch {
    return []
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const query = (searchParams.get('q') ?? '').trim().slice(0, 64)
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') ?? '12', 10) || 12, 1), 25)

  if (!query) {
    return NextResponse.json({ query, results: [] } satisfies SearchResponse)
  }

  // Stop upstream work when the browser cancels (next keystroke) or upstream hangs.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS)
  request.signal.addEventListener('abort', () => controller.abort())
  try {
    const [db, global] = await Promise.all([
      searchDb(query, limit, controller.signal),
      searchYahoo(query, limit, ['EQUITY', 'ETF', 'INDEX', 'CRYPTOCURRENCY'], controller.signal),
    ])
    const body: SearchResponse = { query, results: mergeSearchResults(db, global, query, limit) }
    return NextResponse.json(body, { headers: { 'Cache-Control': 'public, max-age=30, stale-while-revalidate=60' } })
  } finally {
    clearTimeout(timer)
  }
}

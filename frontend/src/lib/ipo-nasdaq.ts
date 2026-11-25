/**
 * Nasdaq public IPO calendar (api.nasdaq.com/api/ipo/calendar?date=YYYY-MM) parsing.
 *
 * Used as a free, keyless fallback when Finnhub's /calendar/ipo returns an empty
 * window (common on the free tier). Server-side only: Nasdaq requires a
 * browser-like User-Agent and does not send CORS headers.
 */

export type IpoPipelineStatus = 'expected' | 'priced' | 'filed'

export interface NasdaqIpoRow {
  date: string
  symbol: string | null
  name: string
  exchange: string | null
  status: IpoPipelineStatus
  price: string | null
  shares: number | null
}

export const NASDAQ_IPO_URL = 'https://api.nasdaq.com/api/ipo/calendar'
export const NASDAQ_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  Origin: 'https://www.nasdaq.com',
  Referer: 'https://www.nasdaq.com/',
}

type Raw = Record<string, unknown>

/** MM/DD/YYYY or YYYY-MM-DD → YYYY-MM-DD; '' when unparseable. */
export function nasdaqDateToIso(raw: unknown): string {
  const s = String(raw ?? '').trim()
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s)
  if (us) return `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  return ''
}

function toInt(raw: unknown): number | null {
  const s = String(raw ?? '').replace(/[,$]/g, '').trim()
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? Math.trunc(n) : null
}

function sectionRows(section: unknown): Raw[] {
  if (!section || typeof section !== 'object') return []
  const sec = section as Raw
  let rows = sec.rows
  if (rows == null && sec.upcomingTable && typeof sec.upcomingTable === 'object') {
    rows = (sec.upcomingTable as Raw).rows
  }
  return Array.isArray(rows) ? (rows.filter((r) => r && typeof r === 'object') as Raw[]) : []
}

function toRow(r: Raw, date: string, status: IpoPipelineStatus): NasdaqIpoRow | null {
  const name = String(r.companyName ?? '').trim()
  const symbol = String(r.proposedTickerSymbol ?? '').trim() || null
  if (!name && !symbol) return null
  return {
    date,
    symbol,
    name: name || symbol || 'IPO',
    exchange: String(r.proposedExchange ?? '').trim() || null,
    status,
    price: String(r.proposedSharePrice ?? '').trim() || null,
    shares: toInt(r.sharesOffered),
  }
}

/** Parse one monthly payload into rows (upcoming, priced, filed). */
export function parseNasdaqIpoCalendar(payload: unknown): NasdaqIpoRow[] {
  const data = payload && typeof payload === 'object' ? (payload as Raw).data : null
  if (!data || typeof data !== 'object') return []
  const d = data as Raw
  const out: NasdaqIpoRow[] = []
  for (const r of sectionRows(d.upcoming)) {
    const row = toRow(r, nasdaqDateToIso(r.expectedPriceDate), 'expected')
    if (row) out.push(row)
  }
  for (const r of sectionRows(d.priced)) {
    const row = toRow(r, nasdaqDateToIso(r.pricedDate), 'priced')
    if (row) out.push(row)
  }
  for (const r of sectionRows(d.filed)) {
    const row = toRow(r, nasdaqDateToIso(r.filedDate), 'filed')
    if (row) out.push(row)
  }
  return out
}

/**
 * Merge rows from several months: upcoming (soonest first, today or later), then
 * recently priced (newest first), then filings (newest first). De-duplicated.
 */
export function mergeIpoPipeline(rows: NasdaqIpoRow[], todayIso: string, limit = 40): NasdaqIpoRow[] {
  const seen = new Set<string>()
  const uniq = rows.filter((r) => {
    const key = `${(r.symbol || r.name).toUpperCase()}|${r.status}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  const expected = uniq
    .filter((r) => r.status === 'expected' && (!r.date || r.date >= todayIso))
    .sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'))
  const desc = (a: NasdaqIpoRow, b: NasdaqIpoRow) => b.date.localeCompare(a.date)
  const priced = uniq.filter((r) => r.status === 'priced').sort(desc)
  const filed = uniq.filter((r) => r.status === 'filed').sort(desc)
  return [...expected, ...priced, ...filed].slice(0, limit)
}

/** YYYY-MM keys for previous, current and next month. */
export function ipoMonthKeys(today: Date): string[] {
  return [-1, 0, 1].map((offset) => {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + offset, 1))
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
  })
}

/** Server-side fetch; never throws. Next's fetch cache keeps upstream calls to one per 30 min. */
export async function fetchNasdaqIpoPipeline(today = new Date(), limit = 40): Promise<NasdaqIpoRow[]> {
  const results = await Promise.all(
    ipoMonthKeys(today).map(async (key) => {
      try {
        const res = await fetch(`${NASDAQ_IPO_URL}?date=${key}`, {
          headers: NASDAQ_HEADERS,
          next: { revalidate: 1800 },
        } as RequestInit)
        if (!res.ok) return []
        return parseNasdaqIpoCalendar(await res.json())
      } catch {
        return []
      }
    })
  )
  return mergeIpoPipeline(results.flat(), today.toISOString().slice(0, 10), limit)
}

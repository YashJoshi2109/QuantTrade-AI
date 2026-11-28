/**
 * URL <-> ticker mapping for the indexable /stocks/{SLUG} pages.
 *
 * Tickers are uppercase. US share classes use a dot internally (BRK.B, BF.B,
 * same as the backend and /research?symbol=BRK.B) but a dash in the URL
 * (/stocks/BRK-B), because a dot in the last path segment reads like a file
 * extension to caches and crawlers. Anything that is not a plain US ticker
 * (indices, futures, FX, crypto pairs, exchange suffixes) has no stock page.
 *
 * Client-safe: no server-only imports, so the Research header can link here.
 */

export const SITE_URL = 'https://www.quanttrade.us'

const TICKER_RE = /^[A-Z]{1,5}(?:\.[A-Z])?$/
const SLUG_RE = /^[A-Z]{1,5}(?:-[A-Z])?$/

/** BRK.B -> BRK-B, NVDA -> NVDA. Null when the ticker has no stock page. */
export function symbolToSlug(symbol: string | null | undefined): string | null {
  const s = (symbol ?? '').trim().toUpperCase()
  if (!TICKER_RE.test(s)) return null
  return s.replace('.', '-')
}

export interface ParsedSlug {
  /** internal ticker (BRK.B) */
  symbol: string
  /** canonical URL slug (BRK-B) */
  slug: string
  /** true when the requested slug differs from the canonical one (case, dot form) */
  needsRedirect: boolean
}

/**
 * Parse a raw `[symbol]` route param. Accepts nvda, BRK-B, BRK.B, brk-b and
 * URL-encoded forms; returns null for anything that is not a plain ticker.
 */
export function parseStockSlug(raw: string | null | undefined): ParsedSlug | null {
  let decoded = raw ?? ''
  try {
    decoded = decodeURIComponent(decoded)
  } catch {
    return null
  }
  const upper = decoded.trim().toUpperCase()
  const symbol = upper.replace('-', '.')
  const slug = symbolToSlug(symbol)
  if (!slug || !SLUG_RE.test(slug)) return null
  return { symbol, slug, needsRedirect: slug !== decoded }
}

export function stockPath(symbol: string): string | null {
  const slug = symbolToSlug(symbol)
  return slug ? `/stocks/${slug}` : null
}

export function stockUrl(symbol: string): string | null {
  const path = stockPath(symbol)
  return path ? `${SITE_URL}${path}` : null
}

export function researchHref(symbol: string): string {
  return `/research?symbol=${encodeURIComponent(symbol.toUpperCase())}`
}

/**
 * Global symbol search: pure helpers shared by the /api/search route (server)
 * and the search UI (desktop dropdown + mobile sheet).
 *
 * The browser makes ONE request per settled query (/api/search?q=). The route
 * merges our own symbol DB (/api/v1/symbols/search, ranked, has market cap)
 * with Yahoo's global search and returns a flat, deduped, ranked list; the UI
 * groups it by asset kind.
 */

export type SearchKind = 'stock' | 'etf' | 'index' | 'crypto' | 'fund' | 'other'

export interface SearchHit {
  symbol: string
  name: string
  /** Display exchange, e.g. "NASDAQ", "NYSE", "LSE". */
  exchange: string
  kind: SearchKind
  country: string
  market_cap: number | null
  /** 'db' = our symbol master; 'global' = Yahoo. */
  source: 'db' | 'global'
}

export interface SearchResponse {
  query: string
  results: SearchHit[]
}

/** Row shape of backend /api/v1/symbols/search. */
export interface DbSearchRow {
  symbol: string
  name: string | null
  exchange: string | null
  asset_type: string | null
  country: string | null
  market_cap?: number | null
}

/** Row shape of the Yahoo helper (app/api/search/yahooSearch). */
export interface GlobalSearchRow {
  symbol: string
  name: string
  exchange_display: string
  type: string
  quote_type?: string
  country: string
}

export const KIND_ORDER: readonly SearchKind[] = ['stock', 'etf', 'index', 'crypto', 'fund', 'other']

export const KIND_LABEL: Record<SearchKind, string> = {
  stock: 'Stocks',
  etf: 'ETFs',
  index: 'Indices',
  crypto: 'Crypto',
  fund: 'Funds',
  other: 'Other',
}

/** Map an asset-type label ("Equity", "ETF", "INDEX", "CRYPTOCURRENCY", ...) to a kind. */
export function classifyKind(assetType: string | null | undefined, symbol = ''): SearchKind {
  const t = (assetType ?? '').trim().toLowerCase()
  if (symbol.startsWith('^')) return 'index'
  if (/-usd$/i.test(symbol) && (!t || t.includes('crypto'))) return 'crypto'
  if (!t) return 'stock'
  if (t.includes('etf') || t.includes('exchange traded')) return 'etf'
  if (t.includes('index')) return 'index'
  if (t.includes('crypto')) return 'crypto'
  if (t.includes('fund') || t.includes('mutual')) return 'fund'
  if (t.includes('equity') || t.includes('stock') || t.includes('common') || t.includes('adr')) return 'stock'
  return 'other'
}

function dbToHit(r: DbSearchRow): SearchHit {
  return {
    symbol: r.symbol.toUpperCase(),
    name: r.name || r.symbol,
    exchange: r.exchange ?? '',
    kind: classifyKind(r.asset_type, r.symbol),
    country: r.country ?? '',
    market_cap: typeof r.market_cap === 'number' && Number.isFinite(r.market_cap) && r.market_cap > 0 ? r.market_cap : null,
    source: 'db',
  }
}

function globalToHit(r: GlobalSearchRow): SearchHit {
  return {
    symbol: r.symbol.toUpperCase(),
    name: r.name || r.symbol,
    exchange: r.exchange_display ?? '',
    kind: classifyKind(r.quote_type || r.type, r.symbol),
    country: r.country ?? '',
    market_cap: null,
    source: 'global',
  }
}

/** 0 exact ticker, 1 ticker prefix, 2 name prefix/word, 3 contains, 4 other. */
export function matchRank(hit: Pick<SearchHit, 'symbol' | 'name'>, query: string): number {
  const q = query.trim().toUpperCase()
  if (!q) return 4
  const sym = hit.symbol.toUpperCase()
  const name = hit.name.toUpperCase()
  if (sym === q) return 0
  if (sym.startsWith(q)) return 1
  if (name.startsWith(q) || name.includes(` ${q}`)) return 2
  if (sym.includes(q) || name.includes(q)) return 3
  return 4
}

/**
 * Merge DB + Yahoo rows: dedupe by ticker (DB row wins, Yahoo fills a missing
 * exchange), stable-sort by match rank, cap at `limit`.
 */
export function mergeSearchResults(
  db: DbSearchRow[],
  global: GlobalSearchRow[],
  query: string,
  limit = 12,
): SearchHit[] {
  const bySymbol = new Map<string, SearchHit>()
  for (const r of db) {
    if (!r?.symbol) continue
    const h = dbToHit(r)
    if (!bySymbol.has(h.symbol)) bySymbol.set(h.symbol, h)
  }
  for (const r of global) {
    if (!r?.symbol) continue
    const h = globalToHit(r)
    const existing = bySymbol.get(h.symbol)
    if (existing) {
      if (!existing.exchange && h.exchange) existing.exchange = h.exchange
      continue
    }
    bySymbol.set(h.symbol, h)
  }
  return Array.from(bySymbol.values())
    .map((h, i) => ({ h, i, r: matchRank(h, query) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.h)
}

export interface SearchGroup {
  kind: SearchKind
  label: string
  hits: SearchHit[]
}

/** Group hits by kind in KIND_ORDER, keeping rank order inside each group. */
export function groupSearchResults(hits: SearchHit[]): SearchGroup[] {
  return KIND_ORDER.map((kind) => ({ kind, label: KIND_LABEL[kind], hits: hits.filter((h) => h.kind === kind) })).filter(
    (g) => g.hits.length > 0,
  )
}

/** Flat list in display (grouped) order, for keyboard navigation indices. */
export function flattenGroups(groups: SearchGroup[]): SearchHit[] {
  return groups.flatMap((g) => g.hits)
}

export interface HighlightPart {
  text: string
  match: boolean
}

/** Split `text` around the first case-insensitive occurrence of `query`. */
export function highlightParts(text: string, query: string): HighlightPart[] {
  const q = query.trim()
  if (!text) return []
  if (!q) return [{ text, match: false }]
  const i = text.toLowerCase().indexOf(q.toLowerCase())
  if (i < 0) return [{ text, match: false }]
  const parts: HighlightPart[] = []
  if (i > 0) parts.push({ text: text.slice(0, i), match: false })
  parts.push({ text: text.slice(i, i + q.length), match: true })
  if (i + q.length < text.length) parts.push({ text: text.slice(i + q.length), match: false })
  return parts
}

/**
 * Symbols worth one batched quote lookup: US-listed stocks/ETFs (our quote
 * service covers those), at most `max`, sorted so the cache key is stable.
 */
export function quoteSymbolsFor(hits: SearchHit[], max = 8): string[] {
  const out: string[] = []
  for (const h of hits) {
    if (out.length >= max) break
    if (h.kind !== 'stock' && h.kind !== 'etf') continue
    if (h.symbol.includes('.') || h.symbol.includes('^')) continue
    if (h.country && h.country !== 'US' && h.country !== 'United States') continue
    out.push(h.symbol)
  }
  return Array.from(new Set(out)).sort()
}

// ── Recent searches ──────────────────────────────────────────────────────────

export interface RecentSearch {
  symbol: string
  name: string
  kind: SearchKind
}

export const MAX_RECENT = 8

/** Put `item` first, drop older copies of the same ticker, cap at `max`. */
export function pushRecent(list: RecentSearch[], item: RecentSearch, max = MAX_RECENT): RecentSearch[] {
  const sym = item.symbol.toUpperCase()
  return [{ ...item, symbol: sym }, ...list.filter((r) => r.symbol.toUpperCase() !== sym)].slice(0, max)
}

/** Validate a persisted recent-search list (corrupt entries are dropped). */
export function parseRecent(value: unknown): RecentSearch[] | undefined {
  if (!Array.isArray(value)) return undefined
  const out: RecentSearch[] = []
  for (const v of value) {
    if (!v || typeof v !== 'object') continue
    const { symbol, name, kind } = v as Record<string, unknown>
    if (typeof symbol !== 'string' || !/^[A-Za-z0-9.^=\-]{1,15}$/.test(symbol)) continue
    out.push({
      symbol: symbol.toUpperCase(),
      name: typeof name === 'string' ? name : symbol,
      kind: KIND_ORDER.includes(kind as SearchKind) ? (kind as SearchKind) : 'stock',
    })
  }
  return out.slice(0, MAX_RECENT)
}

/** Normalise free-typed input into a ticker for "Enter with no selection". */
export function typedTicker(query: string): string | null {
  const t = query.trim().toUpperCase()
  return /^[A-Z0-9.^=\-]{1,15}$/.test(t) ? t : null
}

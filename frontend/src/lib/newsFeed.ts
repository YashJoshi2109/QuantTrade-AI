/**
 * Unified news feed client.
 *
 * One model-classified feed (`GET /api/v1/news/feed`) + one push channel
 * (`/api/v1/ws/news`) replaces the per-page keyword filtering and the
 * per-endpoint sentiment that made the same article read "bullish" on one page
 * and "neutral" on another.
 *
 * Until the backend ships, `fetchNewsFeedWithFallback` maps the legacy
 * breaking/realtime endpoints into the same item shape (sentiment taken from
 * the old field, category "other") so the UI never breaks.
 */
import {
  fetchBreakingMarketNews,
  fetchRealtimeNews,
  type NewsArticle,
} from '@/lib/api'

const API_URL = process.env.NEXT_PUBLIC_API_URL || ''

/* ───────────────────────── Types ───────────────────────── */

export type NewsSentimentLabel = 'bullish' | 'bearish' | 'neutral'
export type NewsDirection = NewsSentimentLabel | 'mixed'
export type NewsHorizon = 'intraday' | 'days' | 'weeks'
export type NewsSort = 'latest' | 'impact' | 'bullish' | 'bearish'

export const NEWS_CATEGORY_KEYS = [
  'earnings',
  'guidance',
  'mna',
  'analyst',
  'macro_fed',
  'economic_data',
  'regulatory_legal',
  'ipo_offering',
  'capital_return',
  'product_business',
  'energy_commodities',
  'crypto',
  'geopolitics',
  'market_moves',
  'other',
] as const

export type NewsCategoryKey = (typeof NEWS_CATEGORY_KEYS)[number]

export interface NewsSentiment {
  label: NewsSentimentLabel
  /** -1 (very bearish) .. 1 (very bullish) */
  score: number
  /** 0..1 */
  confidence: number
}

export interface NewsAiInsight {
  why_it_matters: string
  direction: NewsDirection
  horizon: NewsHorizon
  affected_tickers: string[]
}

export interface NewsFeedItem {
  id: string
  cluster_id: string
  title: string
  summary: string | null
  url: string | null
  source: string | null
  sources_count: number
  sources: string[]
  published_at: string
  ingested_at: string | null
  tickers: string[]
  categories: string[]
  primary_category: string
  sentiment: NewsSentiment
  /** 0..100 */
  impact: number
  ai: NewsAiInsight | null
  image_url: string | null
  /** Client-only: item was mapped from a legacy endpoint (no model impact / categories). */
  legacy?: boolean
}

export interface NewsFeedResponse {
  items: NewsFeedItem[]
  category_counts: Record<string, number>
  as_of: string
  /** Oldest stored item (ISO): how far back an empty result actually looked. */
  coverage_since?: string | null
}

export interface NewsFeedResult extends NewsFeedResponse {
  /** `live` = unified feed endpoint; `legacy` = mapped from old endpoints. */
  mode: 'live' | 'legacy'
}

export interface NewsCategory {
  key: string
  label: string
  description: string
}

export interface NewsFeedParams {
  category?: string | null
  ticker?: string | null
  sentiment?: NewsSentimentLabel | null
  sort?: NewsSort
  since?: string | null
  limit?: number
}

export type NewsSocketMessage = { type: 'news'; item: NewsFeedItem }

/* ───────────────────── Category metadata ───────────────────── */

export interface CategoryMeta {
  label: string
  short: string
  /** Tailwind classes for the chip */
  chip: string
  description: string
}

export const NEWS_CATEGORY_META: Record<NewsCategoryKey, CategoryMeta> = {
  earnings: {
    label: 'Earnings',
    short: 'Earnings',
    chip: 'bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/25',
    description: 'Quarterly results, EPS and revenue prints',
  },
  guidance: {
    label: 'Guidance',
    short: 'Guidance',
    chip: 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-500/25',
    description: 'Forward outlook raised, cut or reaffirmed',
  },
  mna: {
    label: 'M&A',
    short: 'M&A',
    chip: 'bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/25',
    description: 'Mergers, acquisitions, divestitures',
  },
  analyst: {
    label: 'Analyst',
    short: 'Analyst',
    chip: 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 border-cyan-500/25',
    description: 'Upgrades, downgrades, price targets',
  },
  macro_fed: {
    label: 'Macro / Fed',
    short: 'Macro',
    chip: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/25',
    description: 'Central banks, rates, monetary policy',
  },
  economic_data: {
    label: 'Economic Data',
    short: 'Data',
    chip: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-300 border-yellow-500/25',
    description: 'CPI, jobs, GDP and other releases',
  },
  regulatory_legal: {
    label: 'Regulatory / Legal',
    short: 'Legal',
    chip: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/25',
    description: 'Regulators, lawsuits, antitrust',
  },
  ipo_offering: {
    label: 'IPO / Offering',
    short: 'IPO',
    chip: 'bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300 border-fuchsia-500/25',
    description: 'IPOs, secondary offerings, listings',
  },
  capital_return: {
    label: 'Buybacks / Dividends',
    short: 'Capital',
    chip: 'bg-teal-500/10 text-teal-700 dark:text-teal-300 border-teal-500/25',
    description: 'Buybacks, dividends, splits',
  },
  product_business: {
    label: 'Product / Business',
    short: 'Business',
    chip: 'bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/25',
    description: 'Launches, contracts, partnerships',
  },
  energy_commodities: {
    label: 'Energy / Commodities',
    short: 'Commod.',
    chip: 'bg-orange-500/10 text-orange-700 dark:text-orange-300 border-orange-500/25',
    description: 'Oil, gas, metals, agriculture',
  },
  crypto: {
    label: 'Crypto',
    short: 'Crypto',
    chip: 'bg-lime-500/10 text-lime-700 dark:text-lime-300 border-lime-500/25',
    description: 'Digital assets and exchanges',
  },
  market_moves: {
    label: 'Market Moves',
    short: 'Moves',
    chip: 'bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/25',
    description: 'Index and stock moves, market wraps',
  },
  geopolitics: {
    label: 'Geopolitics',
    short: 'Geo',
    chip: 'bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/25',
    description: 'Conflict, sanctions, trade policy',
  },
  other: {
    label: 'Other',
    short: 'Other',
    chip: 'bg-surface-raised text-fg-secondary border-line-subtle',
    description: 'Everything else',
  },
}

/** Tabs always offered first (when they have items); the rest go under "More". */
export const PRIMARY_CATEGORY_TABS: NewsCategoryKey[] = ['earnings', 'macro_fed', 'mna', 'analyst']

export const DEFAULT_NEWS_CATEGORIES: NewsCategory[] = NEWS_CATEGORY_KEYS.map((key) => ({
  key,
  label: NEWS_CATEGORY_META[key].label,
  description: NEWS_CATEGORY_META[key].description,
}))

export function categoryMeta(key: string | null | undefined): CategoryMeta {
  if (key && key in NEWS_CATEGORY_META) return NEWS_CATEGORY_META[key as NewsCategoryKey]
  return {
    ...NEWS_CATEGORY_META.other,
    label: key ? key.replace(/_/g, ' ') : 'Other',
    short: key ? key.replace(/_/g, ' ') : 'Other',
  }
}

export const NEWS_SORT_OPTIONS: { key: NewsSort; label: string }[] = [
  { key: 'latest', label: 'Latest' },
  { key: 'impact', label: 'Most impactful' },
  { key: 'bullish', label: 'Most bullish' },
  { key: 'bearish', label: 'Most bearish' },
]

/* ───────────────────────── Helpers ───────────────────────── */

const SOURCE_DOMAINS: Record<string, string> = {
  reuters: 'reuters.com',
  bloomberg: 'bloomberg.com',
  cnbc: 'cnbc.com',
  marketwatch: 'marketwatch.com',
  wsj: 'wsj.com',
  'the wall street journal': 'wsj.com',
  'financial times': 'ft.com',
  'yahoo finance': 'finance.yahoo.com',
  yfinance: 'finance.yahoo.com',
  "barron's": 'barrons.com',
  barrons: 'barrons.com',
  'seeking alpha': 'seekingalpha.com',
  benzinga: 'benzinga.com',
  coindesk: 'coindesk.com',
  'the block': 'theblock.co',
  'the verge': 'theverge.com',
  techcrunch: 'techcrunch.com',
  'google news': 'news.google.com',
  google: 'news.google.com',
  newsapi: 'newsapi.org',
}

/** Publisher favicon (used as the image fallback when a story has no picture). */
export function sourceFaviconUrl(url: string | null | undefined, source: string | null | undefined): string {
  let domain: string | null = null
  if (source) domain = SOURCE_DOMAINS[source.toLowerCase().trim()] ?? null
  if (!domain && url) {
    try {
      const host = new URL(url).hostname
      if (host && host !== 'example.com') domain = host
    } catch {
      /* ignore */
    }
  }
  if (!domain && source) domain = `${source.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain || 'news.google.com')}&sz=64`
}


export function formatRelativeTime(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return ''
  const ts = Date.parse(iso)
  if (!Number.isFinite(ts)) return ''
  const diffSec = Math.max(0, Math.floor((now - ts) / 1000))
  if (diffSec < 45) return 'just now'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 7) return `${diffDay}d ago`
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export interface SentimentTone {
  label: string
  text: string
  bg: string
  border: string
  dot: string
  bar: string
}

export function sentimentTone(label: NewsSentimentLabel | NewsDirection | string | null | undefined): SentimentTone {
  switch ((label || '').toLowerCase()) {
    case 'bullish':
      return {
        label: 'Bullish',
        text: 'text-emerald-400',
        bg: 'bg-emerald-500/10',
        border: 'border-emerald-500/25',
        dot: 'bg-emerald-400',
        bar: 'bg-emerald-500/70',
      }
    case 'bearish':
      return {
        label: 'Bearish',
        text: 'text-red-400',
        bg: 'bg-red-500/10',
        border: 'border-red-500/25',
        dot: 'bg-red-400',
        bar: 'bg-red-500/70',
      }
    case 'mixed':
      return {
        label: 'Mixed',
        text: 'text-amber-300',
        bg: 'bg-amber-500/10',
        border: 'border-amber-500/25',
        dot: 'bg-amber-300',
        bar: 'bg-amber-500/70',
      }
    default:
      return {
        label: 'Neutral',
        text: 'text-fg-secondary',
        bg: 'bg-surface-raised',
        border: 'border-line-subtle',
        dot: 'bg-fg-muted',
        bar: 'bg-fg-muted/50',
      }
  }
}

/** Signed score like "+0.62" / "−0.40" / "0.00". */
export function formatSentimentScore(score: number | null | undefined): string {
  if (score == null || !Number.isFinite(score)) return '0.00'
  const clamped = Math.max(-1, Math.min(1, score))
  if (Math.abs(clamped) < 0.005) return '0.00'
  return `${clamped > 0 ? '+' : '−'}${Math.abs(clamped).toFixed(2)}`
}

export interface ImpactBadge {
  level: 'high' | 'medium' | 'low'
  label: string
  text: string
  bar: string
}

export function impactBadge(impact: number | null | undefined): ImpactBadge {
  const v = Number.isFinite(impact) ? (impact as number) : 0
  if (v >= 70) return { level: 'high', label: 'High impact', text: 'text-rose-300', bar: 'bg-rose-400' }
  if (v >= 40) return { level: 'medium', label: 'Medium impact', text: 'text-amber-300', bar: 'bg-amber-400' }
  // bg-fg-muted/70 generated no class (opacity modifier on a CSS-var colour), so
  // every low-impact bar (<40) rendered with no fill.
  return { level: 'low', label: 'Low impact', text: 'text-fg-muted', bar: 'bg-slate-400 dark:bg-slate-500' }
}

export function horizonLabel(h: NewsHorizon | string | null | undefined): string {
  switch (h) {
    case 'intraday':
      return 'Intraday'
    case 'days':
      return 'Days'
    case 'weeks':
      return 'Weeks'
    default:
      return ''
  }
}

/** Normalized, stable params (undefined/empty dropped) — also the React Query key payload. */
export function normalizeFeedParams(p: NewsFeedParams = {}): Required<Pick<NewsFeedParams, 'sort' | 'limit'>> &
  Omit<NewsFeedParams, 'sort' | 'limit'> {
  const out: Required<Pick<NewsFeedParams, 'sort' | 'limit'>> & Omit<NewsFeedParams, 'sort' | 'limit'> = {
    sort: p.sort ?? 'latest',
    limit: Math.max(1, Math.min(200, p.limit ?? 50)),
  }
  if (p.category && p.category !== 'all') out.category = p.category
  if (p.ticker) out.ticker = p.ticker.trim().toUpperCase()
  if (p.sentiment) out.sentiment = p.sentiment
  if (p.since) out.since = p.since
  return out
}

export function newsFeedQueryKey(p: NewsFeedParams = {}) {
  return ['news-feed', normalizeFeedParams(p)] as const
}

function itemTime(i: NewsFeedItem): number {
  const t = Date.parse(i.published_at)
  return Number.isFinite(t) ? t : 0
}

export function compareFeedItems(sort: NewsSort): (a: NewsFeedItem, b: NewsFeedItem) => number {
  const byTime = (a: NewsFeedItem, b: NewsFeedItem) => itemTime(b) - itemTime(a)
  switch (sort) {
    case 'impact':
      return (a, b) => (b.impact ?? 0) - (a.impact ?? 0) || byTime(a, b)
    case 'bullish':
      return (a, b) => (b.sentiment?.score ?? 0) - (a.sentiment?.score ?? 0) || byTime(a, b)
    case 'bearish':
      return (a, b) => (a.sentiment?.score ?? 0) - (b.sentiment?.score ?? 0) || byTime(a, b)
    case 'latest':
    default:
      return byTime
  }
}

export function sortFeedItems(items: NewsFeedItem[], sort: NewsSort = 'latest'): NewsFeedItem[] {
  return [...items].sort(compareFeedItems(sort))
}

/** Does a pushed item belong in a list fetched with `params`? (socket broadcasts everything) */
export function matchesFeedParams(item: NewsFeedItem, params: NewsFeedParams = {}): boolean {
  const p = normalizeFeedParams(params)
  if (p.category) {
    if (item.primary_category !== p.category && !(item.categories ?? []).includes(p.category)) return false
  }
  if (p.ticker) {
    const t = p.ticker
    const tickers = [...(item.tickers ?? []), ...(item.ai?.affected_tickers ?? [])].map((x) => x.toUpperCase())
    if (!tickers.includes(t)) return false
  }
  if (p.sentiment && item.sentiment?.label !== p.sentiment) return false
  if (p.since) {
    const since = Date.parse(p.since)
    if (Number.isFinite(since) && itemTime(item) < since) return false
  }
  return true
}

export interface MergeResult {
  items: NewsFeedItem[]
  /** cluster_ids that were not present before */
  added: string[]
  /** cluster_ids that were replaced in place */
  updated: string[]
}

/**
 * Merge pushed items into a list: dedupe by cluster_id (update in place),
 * drop updates that no longer match the filter, keep sort order, cap length.
 */
export function mergeFeedItems(
  existing: NewsFeedItem[],
  incoming: NewsFeedItem[],
  opts: { sort?: NewsSort; limit?: number; params?: NewsFeedParams } = {}
): MergeResult {
  const sort = opts.sort ?? opts.params?.sort ?? 'latest'
  const limit = opts.limit ?? opts.params?.limit ?? 50
  const byCluster = new Map<string, NewsFeedItem>()
  for (const it of existing) {
    const k = it.cluster_id || it.id
    if (!byCluster.has(k)) byCluster.set(k, it)
  }
  const added: string[] = []
  const updated: string[] = []
  for (const it of incoming) {
    const k = it.cluster_id || it.id
    const matches = opts.params ? matchesFeedParams(it, opts.params) : true
    if (byCluster.has(k)) {
      if (matches) {
        byCluster.set(k, it)
        updated.push(k)
      } else {
        byCluster.delete(k)
      }
    } else if (matches) {
      byCluster.set(k, it)
      added.push(k)
    }
  }
  const items = sortFeedItems(Array.from(byCluster.values()), sort).slice(0, limit)
  const kept = new Set(items.map((i) => i.cluster_id || i.id))
  return { items, added: added.filter((k) => kept.has(k)), updated: updated.filter((k) => kept.has(k)) }
}

/** Bump per-category counts for clusters that are new to the list. */
export function bumpCategoryCounts(
  counts: Record<string, number>,
  addedItems: NewsFeedItem[]
): Record<string, number> {
  if (addedItems.length === 0) return counts
  const next = { ...counts }
  for (const it of addedItems) {
    const cats = new Set([it.primary_category, ...(it.categories ?? [])].filter(Boolean))
    cats.forEach((c) => {
      next[c] = (next[c] ?? 0) + 1
    })
    if ('all' in next) next.all = (next.all ?? 0) + 1
  }
  return next
}

/** ws(s)://host/api/v1/ws/news derived from the API base (or the page origin when same-origin). */
export function newsSocketUrl(apiBase: string = API_URL): string | null {
  let base = apiBase
  if (!base) {
    if (typeof window === 'undefined') return null
    base = window.location.origin
  }
  try {
    const u = new URL('/api/v1/ws/news', base)
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'
    return u.toString()
  } catch {
    return null
  }
}

/* ───────────────────── Legacy fallback mapping ───────────────────── */

function legacySentiment(raw: string | null | undefined): NewsSentiment {
  const l = (raw || '').toLowerCase()
  if (l === 'bullish' || l === 'positive') return { label: 'bullish', score: 0.5, confidence: 0 }
  if (l === 'bearish' || l === 'negative') return { label: 'bearish', score: -0.5, confidence: 0 }
  return { label: 'neutral', score: 0, confidence: 0 }
}

function hashKey(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  return `legacy-${(h >>> 0).toString(36)}`
}

/** Map an old `/enhanced/news/*` article to the unified item shape. */
export function legacyArticleToFeedItem(a: NewsArticle, fallbackTicker?: string | null): NewsFeedItem {
  const key = hashKey(`${a.url ?? ''}|${(a.title ?? '').slice(0, 200)}`)
  const tickers = Array.from(
    new Set([...(a.related_tickers ?? []), ...(fallbackTicker ? [fallbackTicker.toUpperCase()] : [])])
  )
  const raw = a as NewsArticle & { summary?: string | null }
  return {
    id: a.id != null ? String(a.id) : key,
    cluster_id: key,
    title: a.title ?? '',
    summary: raw.summary ?? a.content ?? null,
    url: a.url ?? null,
    source: a.source ?? null,
    sources_count: 1,
    sources: a.source ? [a.source] : [],
    published_at: a.published_at,
    ingested_at: null,
    tickers,
    categories: ['other'],
    primary_category: 'other',
    sentiment: legacySentiment(a.sentiment),
    impact: 0,
    ai: null,
    image_url: a.thumbnail ?? null,
    legacy: true,
  }
}

/**
 * Bridge back to the old `NewsArticle` shape for panels that still take it
 * (dashboard wire/global news). Sentiment comes from the model label so every
 * surface shows the same call.
 */
export function feedItemToNewsArticle(i: NewsFeedItem): NewsArticle {
  const tone = sentimentTone(i.sentiment?.label)
  return {
    id: Number.parseInt(i.id, 10) || 0,
    title: i.title,
    content: i.summary,
    source: i.source,
    url: i.url,
    published_at: i.published_at,
    sentiment: tone.label,
    thumbnail: i.image_url,
    related_tickers: i.tickers,
  }
}

/* ───────────────────────── Fetch client ───────────────────────── */

export class NewsFeedUnavailableError extends Error {
  constructor(public status: number) {
    super(`News feed unavailable (${status})`)
    this.name = 'NewsFeedUnavailableError'
  }
}

function buildFeedUrl(params: NewsFeedParams): string {
  const p = normalizeFeedParams(params)
  const qs = new URLSearchParams()
  if (p.category) qs.set('category', p.category)
  if (p.ticker) qs.set('ticker', p.ticker)
  if (p.sentiment) qs.set('sentiment', p.sentiment)
  qs.set('sort', p.sort)
  if (p.since) qs.set('since', p.since)
  qs.set('limit', String(p.limit))
  return `${API_URL}/api/v1/news/feed?${qs.toString()}`
}

function normalizeItem(raw: Partial<NewsFeedItem>): NewsFeedItem {
  const s = raw.sentiment
  return {
    id: String(raw.id ?? raw.cluster_id ?? ''),
    cluster_id: String(raw.cluster_id ?? raw.id ?? ''),
    title: raw.title ?? '',
    summary: raw.summary ?? null,
    url: raw.url ?? null,
    source: raw.source ?? null,
    sources_count: raw.sources_count ?? (raw.sources?.length || 1),
    sources: raw.sources ?? [],
    published_at: raw.published_at ?? new Date().toISOString(),
    ingested_at: raw.ingested_at ?? null,
    tickers: raw.tickers ?? [],
    categories: raw.categories ?? [],
    primary_category: raw.primary_category ?? raw.categories?.[0] ?? 'other',
    sentiment: {
      label: s?.label ?? 'neutral',
      score: Number.isFinite(s?.score) ? (s!.score as number) : 0,
      confidence: Number.isFinite(s?.confidence) ? (s!.confidence as number) : 0,
    },
    impact: Number.isFinite(raw.impact) ? (raw.impact as number) : 0,
    ai: raw.ai ?? null,
    image_url: raw.image_url ?? null,
  }
}

export function normalizeFeedResponse(raw: unknown): NewsFeedResponse {
  const r = (raw ?? {}) as Partial<NewsFeedResponse>
  return {
    items: Array.isArray(r.items) ? r.items.map((i) => normalizeItem(i)) : [],
    category_counts: r.category_counts && typeof r.category_counts === 'object' ? r.category_counts : {},
    as_of: r.as_of ?? new Date().toISOString(),
    coverage_since: typeof r.coverage_since === 'string' ? r.coverage_since : null,
  }
}

/**
 * Whole days of coverage behind an empty result ("last 3 days"), from the
 * feed's `coverage_since`. Null when unknown; at least 1.
 */
export function coverageDays(coverageSince: string | null | undefined, now: number = Date.now()): number | null {
  if (!coverageSince) return null
  const t = Date.parse(coverageSince)
  if (!Number.isFinite(t) || t > now) return null
  return Math.max(1, Math.round((now - t) / 86_400_000))
}

/** Honest empty-state line for a ticker feed: says what window was searched. */
export function emptyTickerMessage(symbol: string, coverageSince: string | null | undefined, now: number = Date.now()): string {
  const days = coverageDays(coverageSince, now)
  if (days == null) return `No ${symbol} stories in recent coverage.`
  return `No ${symbol} stories in the last ${days} ${days === 1 ? 'day' : 'days'}.`
}

export interface SecFiling {
  form_type: string
  filing_date: string
  url: string
  description?: string | null
}

/**
 * The company's latest SEC filings (EDGAR, via the research API). Fallback
 * content for a quiet ticker news card, so it returns [] on any error.
 */
export async function fetchRecentFilings(symbol: string, limit = 4, signal?: AbortSignal): Promise<SecFiling[]> {
  try {
    const qs = new URLSearchParams({ form_types: '10-K,10-Q,8-K', limit: String(limit) })
    const res = await fetch(`${API_URL}/api/v1/research/${encodeURIComponent(symbol)}/filings?${qs.toString()}`, {
      signal,
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return []
    const body = (await res.json().catch(() => null)) as { filings?: unknown } | null
    if (!body || !Array.isArray(body.filings)) return []
    return (body.filings as SecFiling[]).filter((f) => f && f.url && f.form_type).slice(0, limit)
  } catch {
    return []
  }
}

export async function fetchNewsFeed(params: NewsFeedParams = {}, signal?: AbortSignal): Promise<NewsFeedResponse> {
  const res = await fetch(buildFeedUrl(params), { signal, headers: { Accept: 'application/json' } })
  // Pre-feed backends route `/news/feed` into the legacy `/news/{symbol}` handler,
  // which answers 404 ("Symbol not found") or 422 — both mean "not deployed yet".
  if ([404, 405, 422, 501].includes(res.status)) throw new NewsFeedUnavailableError(res.status)
  if (!res.ok) throw new Error(`News feed request failed (${res.status})`)
  const body = (await res.json().catch(() => null)) as unknown
  if (!body || typeof body !== 'object' || !Array.isArray((body as { items?: unknown }).items)) {
    throw new NewsFeedUnavailableError(res.status)
  }
  return normalizeFeedResponse(body)
}

/** Old endpoints mapped to the new shape; sentiment filter / sort emulated client-side. */
export async function fetchLegacyNewsFeed(params: NewsFeedParams = {}): Promise<NewsFeedResult> {
  const p = normalizeFeedParams(params)
  const articles = p.ticker
    ? await fetchRealtimeNews(p.ticker, p.limit)
    : await fetchBreakingMarketNews(p.limit)
  const seen = new Set<string>()
  let items: NewsFeedItem[] = []
  for (const a of articles ?? []) {
    if (!a?.title) continue
    const it = legacyArticleToFeedItem(a, p.ticker)
    if (seen.has(it.cluster_id)) continue
    seen.add(it.cluster_id)
    items.push(it)
  }
  const total = items.length
  // Legacy items carry no model category, so any specific category is empty.
  if (p.category && p.category !== 'other') items = []
  if (p.sentiment) items = items.filter((i) => i.sentiment.label === p.sentiment)
  items = sortFeedItems(items, p.sort).slice(0, p.limit)
  return {
    items,
    category_counts: { all: total },
    as_of: new Date().toISOString(),
    mode: 'legacy',
  }
}

const LEGACY_RETRY_MS = 5 * 60_000
let unifiedUnavailableUntil = 0

/** Test hook: forget a previously observed 404. */
export function resetNewsFeedAvailability() {
  unifiedUnavailableUntil = 0
}

export async function fetchNewsFeedWithFallback(
  params: NewsFeedParams = {},
  signal?: AbortSignal
): Promise<NewsFeedResult> {
  if (Date.now() >= unifiedUnavailableUntil) {
    try {
      const data = await fetchNewsFeed(params, signal)
      return { ...data, mode: 'live' }
    } catch (err) {
      if (!(err instanceof NewsFeedUnavailableError)) throw err
      unifiedUnavailableUntil = Date.now() + LEGACY_RETRY_MS
    }
  }
  return fetchLegacyNewsFeed(params)
}

export async function fetchNewsCategories(): Promise<NewsCategory[]> {
  try {
    const res = await fetch(`${API_URL}/api/v1/news/categories`, { headers: { Accept: 'application/json' } })
    if (!res.ok) return DEFAULT_NEWS_CATEGORIES
    const data = (await res.json()) as unknown
    if (!Array.isArray(data) || data.length === 0) return DEFAULT_NEWS_CATEGORIES
    return (data as NewsCategory[]).filter((c) => c && typeof c.key === 'string')
  } catch {
    return DEFAULT_NEWS_CATEGORIES
  }
}

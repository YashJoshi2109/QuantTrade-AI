import type { Continent } from '@/lib/world-exchanges'
import type { ContinentNewsArticle, ContinentNewsData } from '@/lib/monitor-extended-api'
import type { NewsArticle } from '@/lib/api'

export type DashboardNewsItem = {
  key: string
  title: string
  source: string
  url?: string | null
  sentiment?: string | null
  tickers: string[]
  time: string
  /** Hero / card image when the source provides one */
  imageUrl?: string | null
}

/** Normalize Guardian `thumbnail` (URL string, HTML snippet, or rare object shapes). */
export function parseNewsThumbnailField(raw: unknown): string | null {
  if (raw == null) return null
  if (typeof raw === 'string') {
    const t = raw.trim()
    if (!t) return null
    if (/^https?:\/\//i.test(t)) return t.split(/\s/)[0] ?? t
    if (t.startsWith('//')) return `https:${t}`
    const m = t.match(/https?:\/\/[^\s"'<>]+/)
    return m ? m[0].replace(/&amp;/g, '&') : null
  }
  if (typeof raw === 'object' && raw !== null && 'url' in raw) {
    const u = (raw as { url?: unknown }).url
    return typeof u === 'string' ? parseNewsThumbnailField(u) : null
  }
  return null
}

export function dashboardRelativeTime(iso?: string | null): string {
  if (!iso) return 'now'
  const ts = Date.parse(iso)
  if (!Number.isFinite(ts)) return 'now'
  const diffMin = Math.max(0, Math.floor((Date.now() - ts) / 60000))
  if (diffMin < 1) return 'now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  return `${Math.floor(diffHr / 24)}d ago`
}

/** Guardian / GDELT feed keys from `GET /monitor/continent-news` */
export function continentGuardianFeedKeys(continent: Continent): string[] {
  switch (continent) {
    case 'americas':
      return ['United States', 'Latin America']
    case 'europe':
      return ['Europe']
    case 'asia':
      return ['Asia-Pacific']
    case 'africa':
      return ['Africa', 'Middle East']
    case 'oceania':
      return ['Asia-Pacific', 'World News']
    default:
      return []
  }
}

export function continentArticleToDashboardItem(
  n: ContinentNewsArticle,
  feedTag: string
): DashboardNewsItem {
  const key = n.url || n.title
  return {
    key,
    title: n.title,
    source: n.source || feedTag,
    url: n.url,
    sentiment: null,
    tickers: n.tickers?.slice(0, 5) ?? [],
    time: n.time_ago || 'now',
    imageUrl: parseNewsThumbnailField(n.image_url),
  }
}

export function collectRegionalDashboardNews(
  continent: Continent,
  data: ContinentNewsData | undefined
): DashboardNewsItem[] {
  if (continent === 'global') return []
  const keys = continentGuardianFeedKeys(continent)
  const feeds = data?.feeds ?? []
  const out: DashboardNewsItem[] = []
  const seen = new Set<string>()
  for (const feedKey of keys) {
    const feed = feeds.find((f) => f.continent === feedKey)
    for (const a of feed?.articles ?? []) {
      const item = continentArticleToDashboardItem(a, feedKey)
      if (seen.has(item.key)) continue
      seen.add(item.key)
      out.push(item)
    }
  }
  return out
}

export function liveArticleToDashboardItem(n: NewsArticle): DashboardNewsItem {
  const key = n.url || n.title
  return {
    key,
    title: n.title,
    source: n.source || 'News',
    url: n.url,
    sentiment: n.sentiment,
    tickers: n.related_tickers ?? [],
    time: dashboardRelativeTime(n.published_at),
    imageUrl: parseNewsThumbnailField(n.thumbnail),
  }
}

/** Live headlines excluding anything already shown in the regional column */
export function buildWireNewsItems(
  liveNews: NewsArticle[],
  regional: DashboardNewsItem[],
  limit = 28
): DashboardNewsItem[] {
  const regionalKeys = new Set(regional.map((r) => r.key))
  const map = new Map<string, DashboardNewsItem>()
  for (const n of liveNews) {
    const item = liveArticleToDashboardItem(n)
    if (!item.key || regionalKeys.has(item.key) || map.has(item.key)) continue
    map.set(item.key, item)
  }
  return Array.from(map.values()).slice(0, limit)
}

export function mergeGlobalDashboardNews(
  liveNews: NewsArticle[],
  limit = 20
): DashboardNewsItem[] {
  const map = new Map<string, DashboardNewsItem>()
  for (const n of liveNews) {
    const item = liveArticleToDashboardItem(n)
    if (!item.key || map.has(item.key)) continue
    map.set(item.key, item)
  }
  return Array.from(map.values()).slice(0, limit)
}

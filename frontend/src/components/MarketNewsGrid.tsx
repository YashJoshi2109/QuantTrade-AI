'use client'

import { useId, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Activity, Minus, RefreshCw, Sparkles, TrendingDown, TrendingUp } from 'lucide-react'
import { useNewsFeed } from '@/hooks/useNewsFeed'
import {
  categoryMeta,
  DEFAULT_NEWS_CATEGORIES,
  fetchNewsCategories,
  NEWS_SORT_OPTIONS,
  type NewsCategory,
  type NewsFeedItem,
  type NewsSentimentLabel,
  type NewsSort,
} from '@/lib/newsFeed'
import NewsFeedCard from '@/components/news/NewsFeedCard'
import NewsCategoryTabs from '@/components/news/NewsCategoryTabs'
import { NewsLiveRegion, NewsLiveStatus } from '@/components/news/NewsLiveStatus'

type SentimentFilter = 'all' | NewsSentimentLabel

const SENTIMENT_FILTERS: { key: SentimentFilter; label: string }[] = [
  { key: 'all', label: 'Any' },
  { key: 'bullish', label: 'Bullish' },
  { key: 'bearish', label: 'Bearish' },
  { key: 'neutral', label: 'Neutral' },
]

/** "No bearish Earnings stories right now." — names exactly which filter is empty. */
export function emptyStateMessage(category: string, sentiment: SentimentFilter, categories: NewsCategory[]): string {
  const catLabel =
    category === 'all' ? '' : (categories.find((c) => c.key === category)?.label ?? categoryMeta(category).label)
  const sentLabel = sentiment === 'all' ? '' : sentiment
  const parts = [sentLabel, catLabel].filter(Boolean).join(' ')
  return parts ? `No ${parts} stories right now.` : 'No stories right now.'
}

function NewsGridSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 motion-safe:animate-pulse lg:grid-cols-12" aria-hidden>
      <div className="h-72 rounded-xl bg-surface-raised lg:col-span-6" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:col-span-6">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-32 rounded-xl bg-surface-raised" />
        ))}
      </div>
    </div>
  )
}

function SentimentSummary({ items }: { items: NewsFeedItem[] }) {
  const counts = { bullish: 0, bearish: 0, neutral: 0 }
  items.forEach((i) => {
    counts[i.sentiment?.label ?? 'neutral'] += 1
  })
  const total = Math.max(1, items.length)
  return (
    <div className="flex items-center gap-3 text-[10px]" aria-label="Sentiment mix of shown stories">
      <div className="flex h-1.5 w-24 overflow-hidden rounded-full bg-surface-overlay sm:w-32" aria-hidden>
        <span className="h-full bg-emerald-500/70" style={{ width: `${(counts.bullish / total) * 100}%` }} />
        <span className="h-full bg-fg-muted/50" style={{ width: `${(counts.neutral / total) * 100}%` }} />
        <span className="h-full bg-red-500/70" style={{ width: `${(counts.bearish / total) * 100}%` }} />
      </div>
      <span className="inline-flex items-center gap-1 text-emerald-400">
        <TrendingUp className="h-3 w-3" aria-hidden />
        {counts.bullish}
        <span className="sr-only">bullish</span>
      </span>
      <span className="inline-flex items-center gap-1 text-fg-muted">
        <Minus className="h-3 w-3" aria-hidden />
        {counts.neutral}
        <span className="sr-only">neutral</span>
      </span>
      <span className="inline-flex items-center gap-1 text-red-400">
        <TrendingDown className="h-3 w-3" aria-hidden />
        {counts.bearish}
        <span className="sr-only">bearish</span>
      </span>
    </div>
  )
}

export default function MarketNewsGrid({ ticker }: { ticker?: string } = {}) {
  const [category, setCategory] = useState<string>('all')
  const [sentiment, setSentiment] = useState<SentimentFilter>('all')
  const [sort, setSort] = useState<NewsSort>('latest')
  const [expanded, setExpanded] = useState(false)
  const uid = useId().replace(/:/g, '')
  const panelId = `news-panel-${uid}`
  const sortId = `news-sort-${uid}`

  const { data: categories = DEFAULT_NEWS_CATEGORIES } = useQuery<NewsCategory[]>({
    queryKey: ['news-categories'],
    queryFn: fetchNewsCategories,
    staleTime: 60 * 60_000,
    gcTime: 2 * 60 * 60_000,
  })

  const feed = useNewsFeed({
    category,
    ticker,
    sentiment: sentiment === 'all' ? null : sentiment,
    sort,
    limit: 50,
    announce: true,
  })

  // Counts from the unfiltered view stay as the baseline so tabs don't vanish when one is selected.
  const baselineCounts = useRef<Record<string, number>>({})
  const baselineTotal = useRef(0)
  if (category === 'all' && sentiment === 'all' && !feed.isLoading) {
    baselineCounts.current = feed.categoryCounts
    baselineTotal.current = feed.totalCount
  }
  const counts = useMemo(
    () => ({ ...baselineCounts.current, ...feed.categoryCounts }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [feed.categoryCounts, category, sentiment]
  )
  const total = category === 'all' && sentiment === 'all' ? feed.totalCount : Math.max(baselineTotal.current, feed.totalCount)

  const items = feed.items
  const hero = items[0] ?? null
  const side = items.slice(1, 5)
  const rest = items.slice(5, expanded ? items.length : 11)
  const hasMore = !expanded && items.length > 11

  const resetFilters = () => {
    setCategory('all')
    setSentiment('all')
  }

  return (
    <section className="hud-panel p-4 sm:p-6" aria-labelledby={`${panelId}-title`}>
      <NewsLiveRegion message={feed.announcement} />

      {/* Header */}
      <div className="mb-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <Sparkles className="h-4 w-4 text-blue-400" aria-hidden />
              <h2 id={`${panelId}-title`} className="text-sm font-bold tracking-wide text-fg-primary">
                Market Intelligence &amp; News
              </h2>
              <NewsLiveStatus feed={feed} />
            </div>
            <p className="text-[11px] text-fg-muted">
              Model-classified stories, deduplicated across sources
              {feed.totalCount > 0 && <span className="ml-1 font-mono">&middot; {feed.totalCount} stories</span>}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {items.length > 0 && <SentimentSummary items={items} />}
            <button
              type="button"
              onClick={feed.refetch}
              disabled={feed.isFetching}
              aria-label="Refresh news"
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-line-subtle bg-surface-raised text-fg-muted transition-colors hover:text-fg-primary disabled:opacity-40"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${feed.isFetching ? 'motion-safe:animate-spin' : ''}`} aria-hidden />
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <NewsCategoryTabs
            categories={categories}
            counts={counts}
            total={total}
            value={category}
            onChange={(k) => {
              setCategory(k)
              setExpanded(false)
            }}
            idPrefix={`news-cat-${uid}`}
            panelId={panelId}
          />
          <div className="flex flex-wrap items-center gap-2">
            <div role="group" aria-label="Sentiment filter" className="flex gap-0.5 rounded-lg border border-line-subtle bg-surface-raised p-0.5">
              {SENTIMENT_FILTERS.map((s) => {
                const active = sentiment === s.key
                const activeCls =
                  s.key === 'bullish'
                    ? 'bg-emerald-500/15 text-emerald-300'
                    : s.key === 'bearish'
                      ? 'bg-red-500/15 text-red-300'
                      : 'bg-blue-500/15 text-blue-300'
                return (
                  <button
                    key={s.key}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setSentiment(s.key)}
                    className={`rounded-md px-2 py-1 text-[10px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60 ${
                      active ? activeCls : 'text-fg-muted hover:text-fg-primary'
                    }`}
                  >
                    {s.label}
                  </button>
                )
              })}
            </div>
            <label htmlFor={sortId} className="sr-only">
              Sort stories
            </label>
            <select
              id={sortId}
              value={sort}
              onChange={(e) => setSort(e.target.value as NewsSort)}
              className="rounded-lg border border-line-subtle bg-surface-raised px-2 py-1.5 text-[10px] text-fg-secondary focus:outline-none focus:ring-1 focus:ring-blue-500/40"
            >
              {NEWS_SORT_OPTIONS.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Body */}
      <div id={panelId} role="tabpanel" aria-labelledby={`news-cat-${uid}-${category}`} aria-busy={feed.isLoading}>
        {feed.isLoading ? (
          <NewsGridSkeleton />
        ) : items.length === 0 ? (
          <div className="py-14 text-center">
            <Activity className="mx-auto mb-3 h-9 w-9 text-fg-muted" aria-hidden />
            <p className="text-sm text-fg-secondary">
              {feed.isError ? 'News is temporarily unavailable.' : emptyStateMessage(category, sentiment, categories)}
            </p>
            {category !== 'all' || sentiment !== 'all' ? (
              <button
                type="button"
                onClick={resetFilters}
                className="mt-2 text-[11px] font-medium text-blue-400 transition-colors hover:text-white"
              >
                Show all stories &rarr;
              </button>
            ) : (
              <button
                type="button"
                onClick={feed.refetch}
                className="mt-2 text-[11px] font-medium text-blue-400 transition-colors hover:text-white"
              >
                Refresh &rarr;
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
              {hero && (
                <div className="lg:col-span-6">
                  <NewsFeedCard item={hero} variant="hero" isNew={feed.newIds.has(hero.cluster_id)} />
                </div>
              )}
              {side.length > 0 && (
                <div className="grid grid-cols-1 content-start gap-3 sm:grid-cols-2 lg:col-span-6">
                  {side.map((it) => (
                    <NewsFeedCard key={it.cluster_id} item={it} isNew={feed.newIds.has(it.cluster_id)} />
                  ))}
                </div>
              )}
            </div>
            {rest.length > 0 && (
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {rest.map((it) => (
                  <NewsFeedCard key={it.cluster_id} item={it} isNew={feed.newIds.has(it.cluster_id)} />
                ))}
              </div>
            )}
            {hasMore && (
              <div className="mt-4 text-center">
                <button
                  type="button"
                  onClick={() => setExpanded(true)}
                  className="rounded-lg border border-line-subtle bg-surface-raised px-3 py-1.5 text-[11px] font-medium text-fg-secondary transition-colors hover:text-fg-primary"
                >
                  Show {items.length - 11} more
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}

'use client'

import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  TrendingUp,
  TrendingDown,
  Activity,
  Sparkles,
  Clock,
  Cpu,
} from 'lucide-react'
import { fetchBreakingMarketNews, NewsArticle } from '@/lib/api'

/* ────────────────── Types ────────────────── */

type FilterTab = 'all' | 'macro' | 'earnings' | 'ai'
type SortMode = 'impactful' | 'bullish' | 'bearish' | 'latest'

/* ────────────────── Helpers ────────────────── */

/**
 * Extract a favicon URL from an article URL or source name.
 * Uses Google's favicon service for reliable, high-quality favicons.
 */
function getFaviconUrl(articleUrl: string | null, source: string | null): string {
  // Try to extract domain from article URL first
  if (articleUrl) {
    try {
      const domain = new URL(articleUrl).hostname
      return `https://www.google.com/s2/favicons?domain=${domain}&sz=128`
    } catch {
      // URL parsing failed, fall through
    }
  }

  // Map common source names to domains
  const SOURCE_DOMAINS: Record<string, string> = {
    'yahoo finance': 'finance.yahoo.com',
    'reuters': 'reuters.com',
    'bloomberg': 'bloomberg.com',
    'cnbc': 'cnbc.com',
    'marketwatch': 'marketwatch.com',
    'the wall street journal': 'wsj.com',
    'wsj': 'wsj.com',
    'seeking alpha': 'seekingalpha.com',
    'barrons': 'barrons.com',
    "barron's": 'barrons.com',
    'investopedia': 'investopedia.com',
    'the motley fool': 'fool.com',
    'motley fool': 'fool.com',
    'financial times': 'ft.com',
    'ft': 'ft.com',
    'cnn': 'cnn.com',
    'bbc': 'bbc.com',
    'nbc': 'nbcnews.com',
    'abc news': 'abcnews.go.com',
    'fox business': 'foxbusiness.com',
    'forbes': 'forbes.com',
    'business insider': 'businessinsider.com',
    'insider': 'businessinsider.com',
    'techcrunch': 'techcrunch.com',
    'the verge': 'theverge.com',
    'google news': 'news.google.com',
    'newsapi': 'newsapi.org',
    'benzinga': 'benzinga.com',
    'tipranks': 'tipranks.com',
    'zacks': 'zacks.com',
    'thestreet': 'thestreet.com',
  }

  if (source) {
    const key = source.toLowerCase().trim()
    const domain = SOURCE_DOMAINS[key]
    if (domain) {
      return `https://www.google.com/s2/favicons?domain=${domain}&sz=128`
    }
    // Try using source name as domain guess
    const guess = key.replace(/\s+/g, '').replace(/[^a-z0-9]/g, '')
    return `https://www.google.com/s2/favicons?domain=${guess}.com&sz=128`
  }

  return `https://www.google.com/s2/favicons?domain=news.google.com&sz=128`
}

/**
 * SourceFavicon: small inline favicon with source name
 */
function SourceFavicon({ url, source }: { url: string | null; source: string | null }) {
  const faviconSrc = getFaviconUrl(url, source)
  return (
    <img
      src={faviconSrc}
      alt=""
      className="w-4 h-4 rounded-sm flex-shrink-0"
      loading="lazy"
      onError={(e) => {
        // Hide broken favicon images
        ;(e.target as HTMLImageElement).style.display = 'none'
      }}
    />
  )
}

function timeAgo(dateStr: string): string {
  const now = new Date()
  const date = new Date(dateStr)
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return 'Just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  return `${diffDay}d ago`
}

function estimateReadTime(content: string | null): string {
  if (!content) return '2 min read'
  const words = content.split(/\s+/).length
  const mins = Math.max(1, Math.ceil(words / 200))
  return `${mins} min read`
}

function getSentimentColor(sentiment: string | null) {
  switch (sentiment?.toLowerCase()) {
    case 'bullish':
      return {
        bg: 'bg-emerald-500/10',
        text: 'text-emerald-400',
        border: 'border-emerald-500/20',
        icon: <TrendingUp className="w-3 h-3" />,
      }
    case 'bearish':
      return {
        bg: 'bg-red-500/10',
        text: 'text-red-400',
        border: 'border-red-500/20',
        icon: <TrendingDown className="w-3 h-3" />,
      }
    default:
      return {
        bg: 'bg-slate-500/10',
        text: 'text-slate-400',
        border: 'border-slate-500/20',
        icon: <Activity className="w-3 h-3" />,
      }
  }
}

/* ────────────────── Skeleton Loader ────────────────── */

function NewsGridSkeleton() {
  return (
    <div className="grid grid-cols-12 gap-5 animate-pulse">
      <div className="col-span-3 space-y-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="space-y-2 pb-4 border-b border-white/5">
            <div className="h-4 bg-[#1F2630] rounded w-full" />
            <div className="h-3 bg-[#1F2630] rounded w-3/4" />
            <div className="h-2 bg-[#1F2630] rounded w-1/2" />
          </div>
        ))}
      </div>
      <div className="col-span-6 space-y-4">
        <div className="h-48 bg-[#1F2630] rounded-xl" />
        <div className="h-6 bg-[#1F2630] rounded w-3/4" />
        <div className="h-4 bg-[#1F2630] rounded w-full" />
        <div className="h-3 bg-[#1F2630] rounded w-1/2" />
      </div>
      <div className="col-span-3 space-y-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex gap-3">
            <div className="w-20 h-16 bg-[#1F2630] rounded-lg flex-shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-3 bg-[#1F2630] rounded w-full" />
              <div className="h-3 bg-[#1F2630] rounded w-2/3" />
              <div className="h-2 bg-[#1F2630] rounded w-1/3" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ────────────────── Left Column: Stacked Headlines ────────────────── */

function LeftColumnItem({ article }: { article: NewsArticle }) {
  const inner = (
    <div className="py-3.5 border-b border-white/[0.04] group hover:bg-white/[0.02] -mx-2 px-2 rounded-lg transition-all">
      <h4 className="text-[13px] font-semibold text-slate-200 leading-snug group-hover:text-white transition-colors line-clamp-2">
        {article.title}
      </h4>
      {article.content && (
        <p className="text-[11px] text-slate-500 mt-1 line-clamp-1">
          {article.content}
        </p>
      )}
      <div className="flex items-center gap-2 mt-1.5">
        <SourceFavicon url={article.url} source={article.source} />
        <span className="text-[10px] text-slate-600">{article.source}</span>
        <span className="text-[10px] text-slate-700">&middot;</span>
        <span className="text-[10px] text-slate-600">
          {estimateReadTime(article.content)}
        </span>
        {article.related_tickers && article.related_tickers.length > 0 && (
          <>
            <span className="text-[10px] text-slate-700">&middot;</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
              {article.related_tickers[0]}
            </span>
          </>
        )}
      </div>
    </div>
  )

  return article.url ? (
    <a href={article.url} target="_blank" rel="noopener noreferrer">
      {inner}
    </a>
  ) : (
    inner
  )
}

/* ────────────────── Center Column: Hero Story ────────────────── */

function HeroStory({ article }: { article: NewsArticle }) {
  const sc = getSentimentColor(article.sentiment)

  return (
    <a
      href={article.url || '#'}
      target="_blank"
      rel="noopener noreferrer"
      className="block group"
    >
      {/* Hero image */}
      <div className="relative w-full h-52 rounded-xl overflow-hidden bg-gradient-to-br from-[#1A2332] to-[#0d1321] border border-white/[0.06] mb-4">
        {article.thumbnail ? (
          <img
            src={article.thumbnail}
            alt=""
            className="w-full h-full object-cover opacity-80 group-hover:opacity-100 group-hover:scale-105 transition-all duration-500"
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <img
              src={getFaviconUrl(article.url, article.source)}
              alt=""
              className="w-14 h-14 rounded-2xl opacity-60 mb-2"
              loading="lazy"
              onError={(e) => {
                ;(e.target as HTMLImageElement).style.display = 'none'
              }}
            />
            <span className="text-[11px] text-slate-500 font-medium">
              {article.source || 'FEATURED STORY'}
            </span>
          </div>
        )}
        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-[#0A0E1A]/80 to-transparent" />
        {/* Sentiment badge */}
        <div className="absolute top-3 left-3">
          <span
            className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold border backdrop-blur-sm ${sc.bg} ${sc.text} ${sc.border}`}
          >
            {sc.icon}
            {article.sentiment || 'Neutral'}
          </span>
        </div>
      </div>

      {/* Headline */}
      <h2 className="text-xl font-bold text-white leading-tight group-hover:text-blue-400 transition-colors line-clamp-3 mb-2">
        {article.title}
      </h2>

      {/* Summary */}
      {article.content && (
        <p className="text-[13px] text-slate-400 leading-relaxed line-clamp-2 mb-3">
          {article.content}
        </p>
      )}

      {/* Meta row */}
      <div className="flex items-center gap-3 text-[10px]">
        <span className="flex items-center gap-1.5 text-slate-500 font-medium">
          <SourceFavicon url={article.url} source={article.source} />
          {article.source}
        </span>
        <span className="text-slate-700">&middot;</span>
        <span className="flex items-center gap-1 text-slate-500">
          <Clock className="w-3 h-3" />
          {timeAgo(article.published_at)}
        </span>
        <span className="text-slate-700">&middot;</span>
        <span className="text-slate-500">
          {estimateReadTime(article.content)}
        </span>
        {article.related_tickers && article.related_tickers.length > 0 && (
          <div className="flex gap-1 ml-auto">
            {article.related_tickers.slice(0, 3).map((t) => (
              <span
                key={t}
                className="px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 text-[9px] font-mono"
              >
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
    </a>
  )
}

/* ────────────────── Right Column: Compact Cards ────────────────── */

function RightColumnCard({ article }: { article: NewsArticle }) {
  const sc = getSentimentColor(article.sentiment)

  const inner = (
    <div className="flex gap-3 py-3 border-b border-white/[0.04] group hover:bg-white/[0.02] -mx-2 px-2 rounded-lg transition-all">
      {/* Thumbnail */}
      <div className="w-20 h-16 rounded-lg overflow-hidden bg-[#1A2332] border border-white/[0.06] flex-shrink-0">
        {article.thumbnail ? (
          <img
            src={article.thumbnail}
            alt=""
            className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-1">
            <img
              src={getFaviconUrl(article.url, article.source)}
              alt=""
              className="w-7 h-7 rounded opacity-70"
              loading="lazy"
              onError={(e) => {
                const img = e.target as HTMLImageElement
                img.style.display = 'none'
              }}
            />
            <span className="text-[7px] text-slate-600 font-medium text-center leading-none truncate w-full px-1">
              {article.source}
            </span>
          </div>
        )}
      </div>
      {/* Content */}
      <div className="flex-1 min-w-0">
        <h4 className="text-[12px] font-semibold text-slate-200 leading-snug group-hover:text-white transition-colors line-clamp-2">
          {article.title}
        </h4>
        <div className="flex items-center gap-1.5 mt-1">
          <SourceFavicon url={article.url} source={article.source} />
          <span className="text-[9px] text-slate-600">{article.source}</span>
          <span className="text-[9px] text-slate-700">&middot;</span>
          <span className="text-[9px] text-slate-600">
            {timeAgo(article.published_at)}
          </span>
        </div>
      </div>
    </div>
  )

  return article.url ? (
    <a href={article.url} target="_blank" rel="noopener noreferrer">
      {inner}
    </a>
  ) : (
    inner
  )
}

/* ────────────────── AI Quick Take Box ────────────────── */

function AIQuickTake({ articles }: { articles: NewsArticle[] }) {
  const bullishCount = articles.filter(
    (a) => a.sentiment?.toLowerCase() === 'bullish',
  ).length
  const bearishCount = articles.filter(
    (a) => a.sentiment?.toLowerCase() === 'bearish',
  ).length
  const total = articles.length
  const dominantSentiment =
    bullishCount > bearishCount
      ? 'Bullish'
      : bearishCount > bullishCount
        ? 'Bearish'
        : 'Mixed'

  return (
    <div className="mt-4 rounded-xl bg-gradient-to-br from-blue-500/[0.08] to-cyan-500/[0.04] border border-blue-500/10 p-3.5">
      <div className="flex items-center gap-2 mb-2">
        <Cpu className="w-3.5 h-3.5 text-cyan-400" />
        <span className="text-[11px] font-bold text-white">
          AI Quick Take
        </span>
        <span className="ml-auto px-1.5 py-0.5 text-[9px] rounded bg-cyan-500/15 text-cyan-400 border border-cyan-500/20 font-mono">
          BETA
        </span>
      </div>
      <p className="text-[11px] text-slate-400 leading-relaxed">
        Sentiment across {total} stories is{' '}
        <span
          className={
            dominantSentiment === 'Bullish'
              ? 'text-emerald-400 font-bold'
              : dominantSentiment === 'Bearish'
                ? 'text-red-400 font-bold'
                : 'text-amber-400 font-bold'
          }
        >
          {dominantSentiment}
        </span>
        . {bullishCount} bullish, {bearishCount} bearish,{' '}
        {total - bullishCount - bearishCount} neutral signals detected.
      </p>
    </div>
  )
}

/* ────────────────── Main Component ────────────────── */

export default function MarketNewsGrid() {
  const [filter, setFilter] = useState<FilterTab>('all')
  const [sort, setSort] = useState<SortMode>('latest')

  const { data: articles = [], isLoading, dataUpdatedAt } = useQuery<NewsArticle[]>({
    queryKey: ['newsGrid'],
    queryFn: () => fetchBreakingMarketNews(30),
    refetchInterval: 60000,   // Refresh every 60s for live daily news
    staleTime: 30000,         // Consider stale after 30s
    gcTime: 120000,           // Keep in cache for 2 minutes
    retry: 2,
  })

  const lastUpdatedLabel = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null

  const filtered = useMemo(() => {
    let result = [...articles]

    // Filter
    if (filter === 'macro') {
      result = result.filter(
        (a) =>
          !a.related_tickers ||
          a.related_tickers.length === 0 ||
          a.title.toLowerCase().includes('fed') ||
          a.title.toLowerCase().includes('inflation') ||
          a.title.toLowerCase().includes('gdp') ||
          a.title.toLowerCase().includes('rate'),
      )
    } else if (filter === 'earnings') {
      result = result.filter(
        (a) =>
          a.title.toLowerCase().includes('earnings') ||
          a.title.toLowerCase().includes('revenue') ||
          a.title.toLowerCase().includes('profit') ||
          a.title.toLowerCase().includes('eps'),
      )
    } else if (filter === 'ai') {
      result = result.filter(
        (a) => a.sentiment === 'Bullish' || a.sentiment === 'Bearish',
      )
    }

    // Sort
    switch (sort) {
      case 'bullish':
        result.sort((a, b) => {
          const sa = a.sentiment === 'Bullish' ? 2 : a.sentiment === 'Bearish' ? 0 : 1
          const sb = b.sentiment === 'Bullish' ? 2 : b.sentiment === 'Bearish' ? 0 : 1
          return sb - sa
        })
        break
      case 'bearish':
        result.sort((a, b) => {
          const sa = a.sentiment === 'Bearish' ? 2 : a.sentiment === 'Bullish' ? 0 : 1
          const sb = b.sentiment === 'Bearish' ? 2 : b.sentiment === 'Bullish' ? 0 : 1
          return sb - sa
        })
        break
      case 'impactful':
        result.sort((a, b) => {
          const ta = a.related_tickers?.length ?? 0
          const tb = b.related_tickers?.length ?? 0
          return tb - ta
        })
        break
      case 'latest':
      default:
        result.sort(
          (a, b) =>
            new Date(b.published_at).getTime() -
            new Date(a.published_at).getTime(),
        )
    }

    return result
  }, [articles, filter, sort])

  // Distribute articles into columns
  const hero = filtered[0] || null
  const leftItems = filtered.slice(1, 5)
  const rightItems = filtered.slice(5, 9)

  const FILTER_TABS: { key: FilterTab; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'macro', label: 'Macro' },
    { key: 'earnings', label: 'Earnings' },
    { key: 'ai', label: 'AI Curated' },
  ]

  const SORT_OPTIONS: { key: SortMode; label: string }[] = [
    { key: 'latest', label: 'Latest' },
    { key: 'impactful', label: 'Most Impactful' },
    { key: 'bullish', label: 'Most Bullish' },
    { key: 'bearish', label: 'Most Bearish' },
  ]

  return (
    <div className="hud-panel p-5 sm:p-6">
      {/* Section Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Sparkles className="w-4 h-4 text-blue-400" />
            <h2 className="text-sm font-bold text-white tracking-wide">
              Market Intelligence &amp; News
            </h2>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[9px] font-bold text-white bg-gradient-to-r from-red-500 to-rose-500 rounded-lg uppercase tracking-wider shadow-lg shadow-red-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
              Live
            </span>
          </div>
          <p className="text-[11px] text-slate-500">
            Curated macro, earnings, and company updates
            {lastUpdatedLabel && (
              <span className="ml-2 text-slate-600 font-mono">
                &middot; Updated {lastUpdatedLabel}
              </span>
            )}
            {articles.length > 0 && (
              <span className="ml-2 text-slate-600 font-mono">
                &middot; {articles.length} stories
              </span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Filter Tabs */}
          <div className="flex gap-1 rounded-lg bg-[#0A0E1A]/60 p-0.5 border border-white/[0.04]">
            {FILTER_TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setFilter(tab.key)}
                className={`px-2.5 py-1 rounded-md text-[10px] font-medium transition-all ${
                  filter === tab.key
                    ? 'bg-blue-500/15 text-blue-400'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Sort dropdown */}
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortMode)}
            className="text-[10px] bg-[#0A0E1A]/60 border border-white/[0.06] text-slate-400 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500/40"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.key} value={opt.key}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Grid Layout */}
      {isLoading ? (
        <NewsGridSkeleton />
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center">
          <Activity className="w-10 h-10 text-slate-600 mx-auto mb-3" />
          <p className="text-sm text-slate-400">No news articles match your filter.</p>
          <button
            type="button"
            onClick={() => setFilter('all')}
            className="mt-2 text-[11px] text-blue-400 hover:text-white transition-colors"
          >
            Show all stories &rarr;
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-12 gap-5">
          {/* Left Column: Stacked text headlines */}
          <div className="col-span-12 lg:col-span-3 order-2 lg:order-1">
            <div className="border-b lg:border-b-0 lg:border-r border-white/[0.04] lg:pr-4 pb-4 lg:pb-0">
              {leftItems.map((article, i) => (
                <LeftColumnItem key={article.id ?? i} article={article} />
              ))}
              {leftItems.length === 0 && (
                <p className="text-[11px] text-slate-600 py-4">
                  No additional stories
                </p>
              )}
            </div>
          </div>

          {/* Center Column: Hero Story */}
          <div className="col-span-12 lg:col-span-6 order-1 lg:order-2">
            {hero ? (
              <HeroStory article={hero} />
            ) : (
              <div className="h-64 flex items-center justify-center text-slate-600 text-sm">
                No featured story available
              </div>
            )}
          </div>

          {/* Right Column: Compact image + headline cards */}
          <div className="col-span-12 lg:col-span-3 order-3">
            <div className="lg:border-l border-white/[0.04] lg:pl-4">
              {rightItems.map((article, i) => (
                <RightColumnCard key={article.id ?? i} article={article} />
              ))}
              {rightItems.length === 0 && (
                <p className="text-[11px] text-slate-600 py-4">
                  No stories
                </p>
              )}

              {/* AI Quick Take */}
              {filtered.length >= 3 && <AIQuickTake articles={filtered} />}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

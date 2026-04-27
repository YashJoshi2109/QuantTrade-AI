'use client'

import { useState, useMemo, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Radio,
  CircleDot,
  TrendingUp,
  TrendingDown,
  Minus,
  Clock,
  RefreshCw,
  Image as ImageIcon,
  ExternalLink,
  Filter,
  ChevronDown,
} from 'lucide-react'
import { fetchLiveMarketHeadlines, type NewsArticle } from '@/lib/api'
import { useBreakingNews } from '@/hooks/useRealtimeNews'
import type { Continent } from '@/lib/world-exchanges'
import Link from 'next/link'

type SentimentFilter = 'all' | 'Bullish' | 'Bearish' | 'Neutral'

function formatTimeAgo(dateString: string): string {
  if (!dateString) return ''
  const date = new Date(dateString)
  if (Number.isNaN(date.getTime())) return ''
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)
  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  return `${diffDays}d ago`
}

const SENTIMENT_CONFIG = {
  Bullish: {
    icon: TrendingUp,
    text: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/25',
    dot: 'bg-emerald-400',
  },
  Bearish: {
    icon: TrendingDown,
    text: 'text-red-400',
    bg: 'bg-red-500/10',
    border: 'border-red-500/25',
    dot: 'bg-red-400',
  },
  Neutral: {
    icon: Minus,
    text: 'text-fg-muted',
    bg: 'bg-slate-500/10',
    border: 'border-slate-600/25',
    dot: 'bg-slate-500',
  },
} as const

const SOURCE_COLORS: Record<string, string> = {
  yfinance: 'text-violet-400',
  google: 'text-blue-400',
  newsapi: 'text-orange-400',
  marketwatch: 'text-emerald-400',
  reuters: 'text-amber-400',
  bloomberg: 'text-cyan-400',
}

function SentimentPill({ sentiment }: { sentiment: string | null }) {
  if (!sentiment) return null
  const cfg = SENTIMENT_CONFIG[sentiment as keyof typeof SENTIMENT_CONFIG] || SENTIMENT_CONFIG.Neutral
  const Icon = cfg.icon
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${cfg.bg} ${cfg.text} border ${cfg.border}`}>
      <Icon className="w-3 h-3" />
      {sentiment}
    </span>
  )
}

function NewsCardItem({ item, index }: { item: NewsArticle; index: number }) {
  const [imgFailed, setImgFailed] = useState(false)
  const hasImage = Boolean(item.thumbnail) && !imgFailed
  const sourceColor = SOURCE_COLORS[(item.source || '').toLowerCase()] || 'text-fg-muted'

  const inner = (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: index * 0.04 }}
      className="group flex gap-3 p-3 rounded-lg hover:bg-slate-800/40 transition-all cursor-pointer border border-transparent hover:border-slate-700/40"
    >
      {/* Thumbnail — only show when image exists */}
      {hasImage ? (
        <div className="shrink-0 w-[64px] h-[64px] rounded-lg overflow-hidden bg-slate-800/60 border border-slate-700/30 relative">
          <img
            src={item.thumbnail || ''}
            alt=""
            className="w-full h-full object-cover transition-transform group-hover:scale-105"
            onError={() => setImgFailed(true)}
            loading="lazy"
          />
          {item.sentiment && (
            <span
              className={`absolute top-1 right-1 w-2 h-2 rounded-full ring-1 ring-black/50 ${
                SENTIMENT_CONFIG[item.sentiment as keyof typeof SENTIMENT_CONFIG]?.dot || 'bg-slate-500'
              }`}
            />
          )}
        </div>
      ) : (
        <div className="shrink-0 w-1 rounded-full self-stretch" style={{
          background: item.sentiment
            ? SENTIMENT_CONFIG[item.sentiment as keyof typeof SENTIMENT_CONFIG]?.dot === 'bg-emerald-400' ? '#34d399'
            : SENTIMENT_CONFIG[item.sentiment as keyof typeof SENTIMENT_CONFIG]?.dot === 'bg-red-400' ? '#f87171'
            : '#64748b'
            : '#1e293b',
        }} />
      )}

      {/* Content */}
      <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
        {/* Title */}
        <h4 className="text-[12px] font-medium text-slate-200 leading-[1.4] line-clamp-2 group-hover:text-cyan-300 transition-colors">
          {item.title}
        </h4>

        {/* Meta row: source, time, sentiment, tickers */}
        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
          {/* Source */}
          {item.source && (
            <span className={`text-[10px] font-semibold uppercase tracking-wide ${sourceColor}`}>
              {item.source === 'yfinance' ? 'Yahoo' : item.source}
            </span>
          )}

          {/* Separator */}
          <span className="w-px h-3 bg-slate-700/60" />

          {/* Time */}
          <span className="text-[10px] text-fg-muted flex items-center gap-0.5">
            <Clock className="w-3 h-3" />
            {formatTimeAgo(item.published_at)}
          </span>

          {/* Sentiment pill */}
          <SentimentPill sentiment={item.sentiment} />
        </div>

        {/* Tickers row */}
        {item.related_tickers && item.related_tickers.length > 0 && (
          <div className="flex gap-1 mt-1.5 flex-wrap">
            {item.related_tickers.slice(0, 4).map((ticker) => (
              <Link
                key={ticker}
                href={`/research?symbol=${ticker}`}
                onClick={(e) => e.stopPropagation()}
                className="text-[10px] px-1.5 py-px rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 hover:bg-cyan-500/20 hover:border-cyan-500/35 transition-colors font-mono font-medium"
              >
                ${ticker}
              </Link>
            ))}
            {item.related_tickers.length > 4 && (
              <span className="text-[10px] px-1.5 py-px text-fg-muted">
                +{item.related_tickers.length - 4}
              </span>
            )}
          </div>
        )}
      </div>

      {/* External link icon */}
      {item.url && (
        <div className="shrink-0 self-start mt-0.5">
          <ExternalLink className="w-3.5 h-3.5 text-slate-700 group-hover:text-cyan-400/60 transition-colors" />
        </div>
      )}
    </motion.div>
  )

  if (!item.url) return inner

  return (
    <a href={item.url} target="_blank" rel="noopener noreferrer" className="block">
      {inner}
    </a>
  )
}

function normalizeNewsData(data: unknown): NewsArticle[] {
  if (Array.isArray(data)) return data as NewsArticle[]
  if (data && typeof data === 'object' && Array.isArray((data as { articles?: unknown }).articles)) {
    return (data as { articles: NewsArticle[] }).articles
  }
  return []
}

export default function LiveNewsChannelPanel({ continent }: { continent?: Continent }) {
  const [sentimentFilter, setSentimentFilter] = useState<SentimentFilter>('all')
  const [filterOpen, setFilterOpen] = useState(false)

  const headlineContext = useMemo(
    () => (continent ? { continent } : undefined),
    [continent]
  )

  const { data, isLoading, isFetching, refetch } = useBreakingNews(25, 45_000, headlineContext)

  const news = useMemo(() => normalizeNewsData(data), [data])

  const filteredNews = useMemo(() => {
    if (sentimentFilter === 'all') return news
    return news.filter((n) => n.sentiment === sentimentFilter)
  }, [news, sentimentFilter])

  // Sentiment counts for filter badges
  const sentimentCounts = useMemo(() => {
    const counts = { Bullish: 0, Bearish: 0, Neutral: 0 }
    news.forEach((n) => {
      if (n.sentiment && n.sentiment in counts) {
        counts[n.sentiment as keyof typeof counts]++
      }
    })
    return counts
  }, [news])

  const filters: { id: SentimentFilter; label: string; count?: number }[] = [
    { id: 'all', label: 'All', count: news.length },
    { id: 'Bullish', label: 'Bullish', count: sentimentCounts.Bullish },
    { id: 'Bearish', label: 'Bearish', count: sentimentCounts.Bearish },
    { id: 'Neutral', label: 'Neutral', count: sentimentCounts.Neutral },
  ]

  return (
    <div className="hud-panel p-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800/60 bg-gradient-to-r from-[#050814] via-[#070b16] to-[#050814] px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-500/20 border border-red-500/50 shadow-[0_0_15px_rgba(248,113,113,0.4)]">
            <Radio className="h-4 w-4 text-red-400" />
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-200">
                Live News
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold text-red-300 border border-red-500/40">
                <CircleDot className="h-3 w-3 text-red-400 animate-pulse" />
                Live
              </span>
              {isFetching && (
                <RefreshCw className="h-3 w-3 text-cyan-400 animate-spin" />
              )}
            </div>
            <span className="mt-0.5 text-[10px] text-fg-muted">
              {continent && continent !== 'global'
                ? `${continent.charAt(0).toUpperCase() + continent.slice(1)} market news`
                : 'Global breaking market news'}{' '}
              · {news.length} articles · auto-refresh 45s
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Sentiment filter toggle */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setFilterOpen((v) => !v)}
              className={`inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border text-[10px] font-medium transition-all ${
                sentimentFilter !== 'all'
                  ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300'
                  : 'border-slate-700/70 bg-slate-900/60 text-fg-muted hover:text-fg-primary hover:border-slate-500'
              }`}
            >
              <Filter className="h-3.5 w-3.5" />
              {sentimentFilter === 'all' ? 'Filter' : sentimentFilter}
              <ChevronDown className={`h-3 w-3 transition-transform ${filterOpen ? 'rotate-180' : ''}`} />
            </button>
            {filterOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setFilterOpen(false)} />
                <div className="absolute right-0 top-full mt-1 w-40 rounded-lg border border-slate-700/70 bg-slate-900/98 shadow-xl z-50 py-1">
                  {filters.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => {
                        setSentimentFilter(f.id)
                        setFilterOpen(false)
                      }}
                      className={`w-full flex items-center justify-between px-3 py-1.5 text-[11px] transition-colors ${
                        sentimentFilter === f.id
                          ? 'text-cyan-300 bg-cyan-500/10'
                          : 'text-fg-muted hover:text-fg-primary hover:bg-slate-800/50'
                      }`}
                    >
                      <span className="flex items-center gap-1.5">
                        {f.id !== 'all' && (
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              SENTIMENT_CONFIG[f.id as keyof typeof SENTIMENT_CONFIG]?.dot || ''
                            }`}
                          />
                        )}
                        {f.label}
                      </span>
                      {f.count != null && f.count > 0 && (
                        <span className="text-[9px] text-fg-muted">{f.count}</span>
                      )}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Refresh */}
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700/70 bg-slate-900/60 text-fg-muted hover:text-fg-primary hover:border-slate-500 transition-colors disabled:opacity-40"
            aria-label="Refresh news"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Sentiment summary bar */}
      {news.length > 0 && (
        <div className="flex items-center gap-3 px-4 py-2 border-b border-slate-800/40 bg-[#050816]/60">
          <span className="text-[10px] text-fg-muted uppercase tracking-wider font-medium">Sentiment</span>
          <div className="flex-1 flex items-center gap-1.5 h-1.5 rounded-full overflow-hidden bg-slate-800/60">
            {sentimentCounts.Bullish > 0 && (
              <div
                className="h-full bg-emerald-500/70 rounded-l-full transition-all"
                style={{ width: `${(sentimentCounts.Bullish / Math.max(news.length, 1)) * 100}%` }}
              />
            )}
            {sentimentCounts.Neutral > 0 && (
              <div
                className="h-full bg-slate-500/50 transition-all"
                style={{ width: `${(sentimentCounts.Neutral / Math.max(news.length, 1)) * 100}%` }}
              />
            )}
            {sentimentCounts.Bearish > 0 && (
              <div
                className="h-full bg-red-500/70 rounded-r-full transition-all"
                style={{ width: `${(sentimentCounts.Bearish / Math.max(news.length, 1)) * 100}%` }}
              />
            )}
          </div>
          <div className="flex items-center gap-3 text-[10px] shrink-0">
            <span className="flex items-center gap-1 text-emerald-400">
              <TrendingUp className="w-3 h-3" />
              {sentimentCounts.Bullish}
            </span>
            <span className="flex items-center gap-1 text-fg-muted">
              <Minus className="w-3 h-3" />
              {sentimentCounts.Neutral}
            </span>
            <span className="flex items-center gap-1 text-red-400">
              <TrendingDown className="w-3 h-3" />
              {sentimentCounts.Bearish}
            </span>
          </div>
        </div>
      )}

      {/* News feed */}
      <div className="max-h-[520px] overflow-y-auto overscroll-contain divide-y divide-slate-800/30 bg-gradient-to-b from-[#060a12] to-[#050810]">
        {isLoading ? (
          <div className="space-y-1 p-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex gap-3 p-3 animate-pulse">
                <div className="w-[72px] h-[72px] rounded-lg bg-slate-800/60" />
                <div className="flex-1 space-y-2 py-1">
                  <div className="h-3.5 bg-slate-800/60 rounded w-4/5" />
                  <div className="h-3 bg-slate-800/40 rounded w-3/5" />
                  <div className="flex gap-2 mt-2">
                    <div className="h-4 w-14 bg-slate-800/40 rounded" />
                    <div className="h-4 w-12 bg-slate-800/40 rounded" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : filteredNews.length > 0 ? (
          <AnimatePresence mode="popLayout">
            {filteredNews.map((item, i) => {
              const key = item.id ?? item.url ?? `${item.title}-${i}`
              return <NewsCardItem key={key} item={item} index={i} />
            })}
          </AnimatePresence>
        ) : (
          <div className="py-16 text-center">
            <Radio className="w-10 h-10 text-slate-700 mx-auto mb-3" />
            <p className="text-sm text-fg-muted font-medium">
              {sentimentFilter !== 'all'
                ? `No ${sentimentFilter.toLowerCase()} news right now`
                : 'No news available'}
            </p>
            <p className="text-[11px] text-fg-muted mt-1">
              Auto-refresh in 45s or click refresh
            </p>
          </div>
        )}
      </div>

      {/* Footer — marquee ticker */}
      <div className="border-t border-slate-800/60 bg-gradient-to-r from-[#050816] via-[#040715] to-[#050816] px-3 py-2">
        <div className="flex items-center gap-2 text-[11px] text-fg-secondary">
          <span className="shrink-0 rounded bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] text-emerald-400 border border-emerald-500/30">
            Macro Tape
          </span>
          <div className="flex-1 min-w-0 overflow-hidden">
            <div
              className="flex gap-8 whitespace-nowrap animate-marquee"
              style={{ width: 'max-content' }}
            >
              {(news.length > 0
                ? news.map((n) => n.title).filter(Boolean)
                : ['Market data loading\u2026']
              )
                .concat(news.map((n) => n.title).filter(Boolean))
                .map((h, idx) => (
                  <span key={idx} className="text-fg-muted inline">
                    {idx > 0 && (
                      <span className="mx-3 text-fg-muted select-none" aria-hidden>
                        ·
                      </span>
                    )}
                    {h}
                  </span>
                ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

'use client'

import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Newspaper, ExternalLink } from 'lucide-react'
import { fetchContinentNews, type ContinentNewsData, type ContinentNewsFeed as FeedType, type ContinentNewsArticle } from '@/lib/monitor-extended-api'

function TagBadge({ tag }: { tag: string }) {
  const colors: Record<string, string> = {
    ALERT: 'bg-red-500/20 text-red-400 border-red-500/30',
    CONFLICT: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
    MILITARY: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    CAUTION: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    DIPLOMATIC: 'bg-sky-500/20 text-sky-400 border-sky-500/30',
    INFRASTRUCTURE: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
    TRADE: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  }
  return (
    <span className={`px-1.5 py-0.5 rounded text-[7px] font-bold uppercase tracking-wider border ${colors[tag] || 'bg-surface-raised text-fg-secondary border-line-default'}`}>
      {tag}
    </span>
  )
}

function NewsCard({ article, featured = false }: { article: ContinentNewsArticle; featured?: boolean }) {
  const Wrapper = article.url ? 'a' : 'div'
  const linkProps = article.url
    ? { href: article.url, target: '_blank' as const, rel: 'noopener noreferrer' }
    : {}
  const hasImage = !!article.image_url

  return (
    <Wrapper
      {...linkProps}
      className={`group block rounded-xl overflow-hidden border border-line-subtle bg-surface-raised/50 hover:border-sky-500/30 hover:bg-surface-hover transition-all duration-200 h-full`}
    >
      {hasImage && (
        <div className={`relative overflow-hidden bg-surface-hover ${featured ? 'h-40' : 'h-28'}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={article.image_url!}
            alt=""
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            loading="lazy"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
          {(article.threat_level === 'critical' || article.threat_level === 'high') && (
            <span className="absolute top-2 right-2 w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse shadow-lg shadow-red-500/50" />
          )}
        </div>
      )}

      <div className={`p-3 flex flex-col h-full ${!hasImage && (article.threat_level === 'critical' || article.threat_level === 'high') ? 'border-l-2 border-red-500/60' : ''}`}>
        {!hasImage && (article.threat_level === 'critical' || article.threat_level === 'high') && (
          <span className="inline-block w-2 h-2 rounded-full bg-red-500 animate-pulse mb-1.5" />
        )}

        <h3 className={`font-semibold text-fg-primary leading-snug group-hover:text-sky-300 transition-colors ${featured ? 'text-[13px] line-clamp-3' : 'text-[11px] line-clamp-2'}`}>
          {article.title}
        </h3>

        {article.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {article.tags.slice(0, 2).map(tag => <TagBadge key={tag} tag={tag} />)}
          </div>
        )}

        {article.tickers && article.tickers.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {article.tickers.slice(0, 5).map(t => (
              <span key={t} className="inline-flex items-center px-1.5 py-0.5 rounded bg-sky-500/10 border border-sky-500/25 text-[8px] font-bold font-mono text-sky-400 tracking-wide">
                ${t}
              </span>
            ))}
          </div>
        )}

        <div className="mt-auto flex items-center justify-between mt-2 pt-1.5 border-t border-line-subtle">
          <span className="text-[9px] text-fg-muted font-mono truncate max-w-[60%]">{article.source}</span>
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] text-fg-muted">{article.time_ago}</span>
            {article.url && <ExternalLink className="w-2.5 h-2.5 text-fg-muted group-hover:text-sky-500 transition-colors" />}
          </div>
        </div>
      </div>
    </Wrapper>
  )
}

function GridFeed({ feed }: { feed: FeedType }) {
  const [visible, setVisible] = useState(24)
  const items = useMemo(() => (feed.articles || []).slice(0, visible), [feed.articles, visible])

  if (feed.articles.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
        <Newspaper className="w-10 h-10 text-fg-muted" aria-hidden />
        <p className="text-[11px] text-fg-muted leading-relaxed max-w-xs">
          No headlines for {feed.continent} right now. Sources rotate between The Guardian and GDELT — try refresh in a minute.
        </p>
      </div>
    )
  }

  return (
    <div className="p-3">
      {/* Grid layout ensures the last row aligns */} 
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 auto-rows-fr">
        {items.map((article, i) => (
          <NewsCard key={`${article.url || article.title}-${i}`} article={article} featured={i === 0} />
        ))}
      </div>
      {visible < (feed.articles?.length || 0) && (
        <div className="pt-3 flex justify-center">
          <button
            onClick={() => setVisible(v => Math.min(v + 12, feed.articles.length))}
            className="mac-btn mac-btn-pill text-[10px] px-3 py-1.5"
          >
            Load more
          </button>
        </div>
      )}
    </div>
  )
}

export default function ContinentNewsFeedGrid() {
  const [activeTab, setActiveTab] = useState(0)

  const { data, isLoading } = useQuery<ContinentNewsData>({
    queryKey: ['continent-news'],
    queryFn: fetchContinentNews,
    refetchInterval: 120_000,
    staleTime: 60_000,
  })

  if (isLoading) {
    return (
      <div className="p-3 space-y-3">
        <div className="flex gap-2 overflow-x-auto no-scrollbar">
          {[...Array(7)].map((_, i) => (
            <div key={i} className="h-7 w-24 bg-surface-hover rounded-lg animate-pulse shrink-0" />
          ))}
        </div>
        <div className="grid grid-cols-4 gap-3">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="bg-surface-hover rounded-xl animate-pulse" style={{ height: `${120 + (i % 3) * 40}px` }} />
          ))}
        </div>
      </div>
    )
  }

  const feeds = data?.feeds ?? []
  const activeFeed = feeds[activeTab]

  return (
    <div className="flex flex-col h-full">
      {/* Continent Tabs */}
      <div className="px-3 pt-2 pb-0 flex items-center gap-0.5 overflow-x-auto no-scrollbar border-b border-line-subtle shrink-0">
        {feeds.map((feed, i) => (
          <button
            key={feed.continent}
            onClick={() => setActiveTab(i)}
            className={`shrink-0 flex items-center gap-1.5 px-3 py-2 text-[10px] font-bold uppercase tracking-wider transition-all border-b-2 ${
              activeTab === i
                ? 'text-sky-400 border-sky-500'
                : 'text-fg-muted border-transparent hover:text-fg-secondary hover:border-line-default'
            }`}
          >
            {feed.continent}
            {feed.live && (
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
              </span>
            )}
            <span className="text-[9px] font-mono text-fg-muted ml-0.5">{feed.count}</span>
            {activeTab === i && <ChevronRight className="w-2.5 h-2.5 text-sky-500" />}
          </button>
        ))}
      </div>

      {/* Masonry feed content */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {activeFeed && <GridFeed feed={activeFeed} />}
      </div>
    </div>
  )
}

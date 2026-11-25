'use client'

import { Newspaper, RefreshCw } from 'lucide-react'
import { useNewsFeed } from '@/hooks/useNewsFeed'
import NewsFeedCard from '@/components/news/NewsFeedCard'
import { NewsLiveStatus } from '@/components/news/NewsLiveStatus'

interface LiveNewsProps {
  symbol?: string
  limit?: number
  showTitle?: boolean
  className?: string
}

/**
 * Symbol (or market-wide) news from the unified feed. Same items, sentiment and
 * categories as the home page — one source of truth on desktop and mobile.
 */
export default function LiveNews({ symbol, limit = 20, showTitle = true, className = '' }: LiveNewsProps) {
  const feed = useNewsFeed({ ticker: symbol || null, limit })
  const { items, isLoading, isError, isFetching, refetch, newIds } = feed

  return (
    <div className={`overflow-hidden ${showTitle ? 'glass rounded-xl' : ''} ${className}`}>
      {showTitle && (
        <div className="flex items-center justify-between border-b border-line-subtle p-4">
          <div className="flex items-center gap-2">
            <Newspaper className="h-5 w-5 text-blue-400" aria-hidden />
            <h3 className="font-semibold text-fg-primary">{symbol ? `${symbol} News` : 'Breaking Market News'}</h3>
          </div>
          <button
            type="button"
            onClick={refetch}
            disabled={isFetching}
            className="rounded-lg p-2 transition-colors hover:bg-surface-overlay/50"
            aria-label="Refresh news"
          >
            <RefreshCw className={`h-4 w-4 text-fg-muted ${isFetching ? 'motion-safe:animate-spin' : ''}`} aria-hidden />
          </button>
        </div>
      )}

      <div className="mb-2 flex items-center justify-between gap-2">
        <NewsLiveStatus feed={feed} />
        {items.length > 0 && <span className="font-mono text-[10px] text-fg-muted">{items.length} stories</span>}
      </div>

      {isLoading ? (
        <div className="space-y-2" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-24 rounded-xl bg-surface-raised motion-safe:animate-pulse" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="p-6 text-center text-fg-muted">
          <Newspaper className="mx-auto mb-2 h-10 w-10 opacity-50" aria-hidden />
          <p className="text-sm font-medium">
            {isError ? 'News is temporarily unavailable.' : symbol ? `No ${symbol} stories right now.` : 'No stories right now.'}
          </p>
          <button type="button" onClick={refetch} className="mt-2 text-xs text-blue-400 hover:text-blue-300">
            Refresh
          </button>
        </div>
      ) : (
        <div className="max-h-[600px] space-y-2 overflow-y-auto overscroll-contain pr-0.5">
          {items.map((item) => (
            <NewsFeedCard key={item.cluster_id} item={item} variant="row" isNew={newIds.has(item.cluster_id)} />
          ))}
        </div>
      )}
    </div>
  )
}

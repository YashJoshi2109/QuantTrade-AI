'use client'

import { FileText, Newspaper, RefreshCw } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useNewsFeed } from '@/hooks/useNewsFeed'
import NewsFeedCard from '@/components/news/NewsFeedCard'
import { NewsLiveStatus } from '@/components/news/NewsLiveStatus'
import { emptyTickerMessage, fetchRecentFilings, formatRelativeTime } from '@/lib/newsFeed'

const FALLBACK_MARKET_LIMIT = 5
const FALLBACK_FILINGS_LIMIT = 4

/**
 * Shown when a ticker has no tagged stories: says which window was searched,
 * then offers the company's latest SEC filings and broader market news
 * instead of a blank card. Shared by desktop and mobile Research.
 */
function QuietTickerFallback({ symbol, coverageSince, onRefresh }: {
  symbol: string
  coverageSince: string | null
  onRefresh: () => void
}) {
  const market = useNewsFeed({ limit: FALLBACK_MARKET_LIMIT, live: false })
  const filings = useQuery({
    queryKey: ['news-fallback-filings', symbol],
    queryFn: ({ signal }) => fetchRecentFilings(symbol, FALLBACK_FILINGS_LIMIT, signal),
    staleTime: 3_600_000,
    retry: false,
  })
  const filingItems = filings.data ?? []

  return (
    <div className="space-y-3" data-testid="news-quiet-fallback">
      <div className="rounded-xl border border-line-subtle p-4 text-center text-fg-muted">
        <Newspaper className="mx-auto mb-2 h-8 w-8 opacity-50" aria-hidden />
        <p className="text-sm font-medium text-fg-primary">{emptyTickerMessage(symbol, coverageSince)}</p>
        <p className="mt-1 text-xs">
          A story shows here once a headline names {symbol}. Below: its latest SEC filings and broader market news.
        </p>
        <button type="button" onClick={onRefresh} className="mt-2 text-xs text-blue-400 hover:text-blue-300">
          Refresh
        </button>
      </div>

      {filingItems.length > 0 && (
        <section aria-label={`Recent ${symbol} SEC filings`}>
          <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-fg-muted">
            Recent {symbol} SEC filings
          </h4>
          <ul className="space-y-1.5">
            {filingItems.map((f) => (
              <li key={f.url}>
                <a
                  href={f.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 rounded-lg border border-line-subtle px-3 py-2 text-xs hover:bg-surface-overlay/50"
                >
                  <FileText className="h-3.5 w-3.5 shrink-0 text-amber-400" aria-hidden />
                  <span className="font-mono font-semibold text-fg-primary">{f.form_type}</span>
                  <span className="text-fg-muted">filed {f.filing_date}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {market.items.length > 0 && (
        <section aria-label="Market news">
          <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-fg-muted">
            Market news
            {market.items[0]?.published_at && (
              <span className="ml-1 font-normal normal-case">· latest {formatRelativeTime(market.items[0].published_at)}</span>
            )}
          </h4>
          <div className="space-y-2">
            {market.items.map((item) => (
              <NewsFeedCard key={item.cluster_id} item={item} variant="row" />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

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
  const { items, isLoading, isError, isFetching, refetch, newIds, coverageSince } = feed

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
      ) : items.length === 0 && symbol && !isError ? (
        <QuietTickerFallback symbol={symbol} coverageSince={coverageSince} onRefresh={refetch} />
      ) : items.length === 0 ? (
        <div className="p-6 text-center text-fg-muted">
          <Newspaper className="mx-auto mb-2 h-10 w-10 opacity-50" aria-hidden />
          <p className="text-sm font-medium">
            {isError ? 'News is temporarily unavailable.' : 'No stories right now.'}
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

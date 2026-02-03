'use client'

import { useMemo, useState } from 'react'
import { NewsArticle } from '@/lib/api'
import { useRealtimeNews, useBreakingNews } from '@/hooks/useRealtimeNews'
import { 
  Newspaper, 
  TrendingUp, 
  TrendingDown, 
  Minus, 
  ExternalLink,
  RefreshCw,
  Clock,
  Image as ImageIcon,
  Zap
} from 'lucide-react'

interface LiveNewsProps {
  symbol?: string
  limit?: number
  showTitle?: boolean
  className?: string
  sources?: string // 'yfinance', 'google', 'newsapi', 'marketwatch' or 'all'
}

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

function SentimentBadge({ sentiment }: { sentiment: string | null }) {
  if (!sentiment) return null
  
  const config = {
    Bullish: { icon: TrendingUp, color: 'text-green-400', bg: 'bg-green-500/20', border: 'border-green-500/30' },
    Bearish: { icon: TrendingDown, color: 'text-red-400', bg: 'bg-red-500/20', border: 'border-red-500/30' },
    Neutral: { icon: Minus, color: 'text-gray-400', bg: 'bg-gray-500/20', border: 'border-gray-500/30' },
  }
  
  const { icon: Icon, color, bg, border } = config[sentiment as keyof typeof config] || config.Neutral
  
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${bg} ${color} border ${border}`}>
      <Icon className="w-3 h-3" />
      {sentiment}
    </span>
  )
}

function SourceBadge({ source }: { source: string | null }) {
  if (!source) {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs bg-gray-500/20 text-gray-400">
        <Zap className="w-3 h-3" />
        Unknown
      </span>
    )
  }
  const sourceConfig: Record<string, { color: string; bg: string; label: string }> = {
    yfinance: { color: 'text-purple-400', bg: 'bg-purple-500/20', label: 'Yahoo' },
    google: { color: 'text-blue-400', bg: 'bg-blue-500/20', label: 'Google' },
    newsapi: { color: 'text-orange-400', bg: 'bg-orange-500/20', label: 'NewsAPI' },
    marketwatch: { color: 'text-emerald-400', bg: 'bg-emerald-500/20', label: 'MW' },
  }
  
  const config = sourceConfig[source.toLowerCase()] || { 
    color: 'text-gray-400', 
    bg: 'bg-gray-500/20', 
    label: source 
  }
  
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs ${config.bg} ${config.color}`}>
      <Zap className="w-3 h-3" />
      {config.label}
    </span>
  )
}

function NewsCard({ item }: { item: NewsArticle }) {
  const [imgFailed, setImgFailed] = useState(false)
  const showImage = Boolean(item.thumbnail) && !imgFailed

  const content = (
      <div className="flex items-start gap-3">
        <div className="shrink-0 w-20 h-20 rounded-lg overflow-hidden bg-slate-700/50 flex items-center justify-center">
          {showImage ? (
            <img 
              src={item.thumbnail || ''} 
              alt="" 
              className="w-full h-full object-cover"
              onError={() => setImgFailed(true)}
            />
          ) : (
            <ImageIcon className="w-6 h-6 text-gray-600" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="font-medium text-sm text-white group-hover:text-blue-400 transition-colors line-clamp-2">
            {item.title}
          </h4>
          {item.summary && (
            <p className="text-xs text-gray-400 mt-1 line-clamp-2">
              {item.summary}
            </p>
          )}
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <SourceBadge source={item.source} />
            <span className="text-xs text-gray-600 flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {formatTimeAgo(item.published_at)}
            </span>
            {item.sentiment && <SentimentBadge sentiment={item.sentiment} />}
          </div>
          {item.related_tickers && item.related_tickers.length > 0 && (
            <div className="flex gap-1 mt-2 flex-wrap">
              {item.related_tickers.slice(0, 5).map((ticker) => (
                <span key={ticker} className="text-xs px-1.5 py-0.5 bg-blue-500/20 text-blue-400 rounded">
                  ${ticker}
                </span>
              ))}
            </div>
          )}
        </div>
        {item.url && (
          <ExternalLink className="w-4 h-4 text-gray-600 group-hover:text-blue-400 transition-colors shrink-0" />
        )}
      </div>
  )

  if (!item.url) {
    return (
      <div className="block p-4 glass rounded-lg">
        {content}
      </div>
    )
  }

  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block p-4 glass rounded-lg hover:bg-slate-700/50 transition-all group"
    >
      {content}
    </a>
  )
}

export default function LiveNews({ 
  symbol, 
  limit = 20, 
  showTitle = true, 
  className = '',
  sources = 'all' 
}: LiveNewsProps) {
  // Use breaking news if no symbol provided, otherwise use symbol news
  const symbolNewsQuery = useRealtimeNews({ 
    symbol, 
    enabled: !!symbol,
    refetchInterval: 30000, // 30 seconds
    limit,
    sources: sources === 'all' ? undefined : sources
  })
  
  const breakingNewsQuery = useBreakingNews(limit, 60000) // 1 minute
  
  // Choose the appropriate query based on whether symbol is provided
  const { data, isLoading, error, refetch, isFetching } = symbol ? symbolNewsQuery : breakingNewsQuery
  
  const news = useMemo(() => normalizeNewsData(data), [data])

  if (isLoading) {
    return (
      <div className={`glass rounded-xl p-4 ${className}`}>
        {showTitle && (
          <div className="flex items-center gap-2 mb-4">
            <Newspaper className="w-5 h-5 text-blue-400" />
            <h3 className="font-semibold">Live News</h3>
          </div>
        )}
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="animate-pulse">
              <div className="h-4 bg-slate-700 rounded w-3/4 mb-2"></div>
              <div className="h-3 bg-slate-700 rounded w-full"></div>
              <div className="h-3 bg-slate-700 rounded w-1/2 mt-2"></div>
            </div>
          ))}
        </div>
      </div>
    )
  }
  
  if (error) {
    return (
      <div className={`glass rounded-xl p-4 ${className}`}>
        {showTitle && (
          <div className="flex items-center gap-2 mb-4">
            <Newspaper className="w-5 h-5 text-blue-400" />
            <h3 className="font-semibold">Live News</h3>
          </div>
        )}
        <p className="text-red-400 text-sm">
          {error instanceof Error ? error.message : 'Failed to load real-time news'}
        </p>
        <button 
          onClick={() => refetch()}
          className="mt-2 text-sm text-blue-400 hover:text-blue-300"
        >
          Try again
        </button>
      </div>
    )
  }
  
  return (
    <div className={`glass rounded-xl overflow-hidden ${className}`}>
      {showTitle && (
        <div className="flex items-center justify-between p-4 border-b border-slate-700/50">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-blue-500/20 rounded-lg relative">
              <Newspaper className="w-5 h-5 text-blue-400" />
              {isFetching && (
                <span className="absolute -top-1 -right-1 w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
              )}
            </div>
            <div>
              <h3 className="font-semibold text-white flex items-center gap-2">
                {symbol ? `${symbol} News` : 'Breaking Market News'}
                <span className="text-xs text-green-400 flex items-center gap-1">
                  <Zap className="w-3 h-3" />
                  LIVE
                </span>
              </h3>
              <p className="text-xs text-gray-400">
                {news.length} articles • Updates every {symbol ? '30s' : '60s'}
              </p>
            </div>
          </div>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="p-2 hover:bg-slate-700/50 rounded-lg transition-colors"
            title="Refresh news"
          >
            <RefreshCw className={`w-4 h-4 text-gray-400 ${isFetching ? 'animate-spin' : ''}`} />
          </button>
        </div>
      )}
      
      <div className="divide-y divide-slate-700/30 max-h-[600px] overflow-y-auto">
        {news.length > 0 ? (
          news.map((item, index) => {
            const key = item.id ?? item.url ?? `${item.title}-${index}`
            return <NewsCard key={key} item={item} />
          })
        ) : (
          <div className="p-8 text-center text-gray-400">
            <Newspaper className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p className="font-medium">No news available</p>
            <p className="text-xs mt-1">Try refreshing or check back later</p>
          </div>
        )}
      </div>
    </div>
  )
}

function normalizeNewsData(data: unknown): NewsArticle[] {
  if (Array.isArray(data)) return data as NewsArticle[]
  if (data && typeof data === 'object' && Array.isArray((data as { articles?: unknown }).articles)) {
    return (data as { articles: NewsArticle[] }).articles
  }
  return []
}

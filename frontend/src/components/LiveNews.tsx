'use client'

import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchLiveMarketNews, fetchLiveSymbolNews, LiveNewsItem } from '@/lib/api'
import { 
  Newspaper, 
  TrendingUp, 
  TrendingDown, 
  Minus, 
  ExternalLink,
  RefreshCw,
  Clock
} from 'lucide-react'

interface LiveNewsProps {
  symbol?: string
  limit?: number
  showTitle?: boolean
  className?: string
}

function formatTimeAgo(dateString: string): string {
  if (!dateString) return ''
  
  // Parse Alpha Vantage date format (YYYYMMDDTHHmmss)
  let date: Date
  if (dateString.includes('T') && !dateString.includes('-')) {
    const year = dateString.slice(0, 4)
    const month = dateString.slice(4, 6)
    const day = dateString.slice(6, 8)
    const hour = dateString.slice(9, 11)
    const minute = dateString.slice(11, 13)
    date = new Date(`${year}-${month}-${day}T${hour}:${minute}:00`)
  } else {
    date = new Date(dateString)
  }
  
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)
  
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  return `${diffDays}d ago`
}

function SentimentBadge({ sentiment }: { sentiment: string }) {
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

function NewsCard({ item }: { item: LiveNewsItem }) {
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block p-4 glass rounded-lg hover:bg-slate-700/50 transition-all group"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h4 className="font-medium text-sm text-white group-hover:text-blue-400 transition-colors line-clamp-2">
            {item.title}
          </h4>
          <p className="text-xs text-gray-400 mt-1 line-clamp-2">
            {item.summary}
          </p>
          <div className="flex items-center gap-3 mt-2">
            <span className="text-xs text-gray-500">{item.source}</span>
            <span className="text-xs text-gray-600 flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {formatTimeAgo(item.published_at)}
            </span>
            <SentimentBadge sentiment={item.sentiment} />
          </div>
          {item.tickers && item.tickers.length > 0 && (
            <div className="flex gap-1 mt-2 flex-wrap">
              {item.tickers.slice(0, 4).map((ticker) => (
                <span key={ticker} className="text-xs px-1.5 py-0.5 bg-blue-500/20 text-blue-400 rounded">
                  ${ticker}
                </span>
              ))}
            </div>
          )}
        </div>
        <ExternalLink className="w-4 h-4 text-gray-600 group-hover:text-blue-400 transition-colors shrink-0" />
      </div>
    </a>
  )
}

export default function LiveNews({ symbol, limit = 10, showTitle = true, className = '' }: LiveNewsProps) {
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['liveNews', symbol, limit],
    queryFn: () => symbol 
      ? fetchLiveSymbolNews(symbol, limit)
      : fetchLiveMarketNews('technology,earnings,finance', limit),
    refetchInterval: 60000, // Refetch every minute
    staleTime: 30000, // Consider data stale after 30 seconds
  })
  
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
        <p className="text-red-400 text-sm">Failed to load news. API rate limit may be reached.</p>
        <button 
          onClick={() => refetch()}
          className="mt-2 text-sm text-blue-400 hover:text-blue-300"
        >
          Try again
        </button>
      </div>
    )
  }
  
  const news = data?.news || []
  
  return (
    <div className={`glass rounded-xl overflow-hidden ${className}`}>
      {showTitle && (
        <div className="flex items-center justify-between p-4 border-b border-slate-700/50">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-blue-500/20 rounded-lg">
              <Newspaper className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <h3 className="font-semibold text-white">
                {symbol ? `${symbol} News` : 'Live Market News'}
              </h3>
              <p className="text-xs text-gray-400">{news.length} articles</p>
            </div>
          </div>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="p-2 hover:bg-slate-700/50 rounded-lg transition-colors"
          >
            <RefreshCw className={`w-4 h-4 text-gray-400 ${isFetching ? 'animate-spin' : ''}`} />
          </button>
        </div>
      )}
      
      <div className="divide-y divide-slate-700/30 max-h-[600px] overflow-y-auto">
        {news.length > 0 ? (
          news.map((item, index) => (
            <NewsCard key={`${item.url}-${index}`} item={item} />
          ))
        ) : (
          <div className="p-4 text-center text-gray-400">
            <p>No news available</p>
            <p className="text-xs mt-1">API rate limit may have been reached</p>
          </div>
        )}
      </div>
    </div>
  )
}

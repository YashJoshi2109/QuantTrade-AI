'use client'

import { useState, useEffect } from 'react'
import { fetchNews, NewsArticle } from '@/lib/api'

interface NewsItem {
  id: string
  source: string
  title: string
  description: string
  timeAgo: string
  sentiment: 'Bullish' | 'Bearish' | 'Neutral'
}

interface NewsPanelProps {
  symbol?: string
  news?: NewsItem[]
}

export default function NewsPanel({ symbol, news: propNews = [] }: NewsPanelProps) {
  const [activeTab, setActiveTab] = useState<'news' | 'filings' | 'earnings'>('news')
  const [news, setNews] = useState<NewsArticle[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (symbol && activeTab === 'news') {
      loadNews()
    }
  }, [symbol, activeTab])

  const loadNews = async () => {
    if (!symbol) return
    setLoading(true)
    try {
      const articles = await fetchNews(symbol, 10)
      setNews(articles)
    } catch (error) {
      console.error('Error loading news:', error)
    } finally {
      setLoading(false)
    }
  }

  // Convert API news to display format
  const displayNews: NewsItem[] = news.length > 0 ? news.map(article => ({
    id: article.id.toString(),
    source: article.source || 'Unknown',
    title: article.title,
    description: article.content?.substring(0, 150) || '',
    timeAgo: getTimeAgo(article.published_at),
    sentiment: (article.sentiment || 'Neutral') as 'Bullish' | 'Bearish' | 'Neutral'
  })) : propNews.length > 0 ? propNews : []

  const getTimeAgo = (dateString: string): string => {
    const date = new Date(dateString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)
    
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    return `${diffDays}d ago`
  }

  const getSentimentColor = (sentiment: string) => {
    switch (sentiment) {
      case 'Bullish':
        return 'bg-green-500/20 text-green-400 border-green-500/30'
      case 'Bearish':
        return 'bg-red-500/20 text-red-400 border-red-500/30'
      default:
        return 'bg-gray-500/20 text-gray-400 border-gray-500/30'
    }
  }

  return (
    <div className="bg-[#1e222d] border border-gray-700 rounded-lg p-4">
      {/* Tabs */}
      <div className="flex gap-2 mb-4 border-b border-gray-700">
        {(['news', 'filings', 'earnings'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium transition-colors capitalize ${
              activeTab === tab
                ? 'text-blue-400 border-b-2 border-blue-400'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="space-y-4 max-h-96 overflow-y-auto">
        {activeTab === 'news' && (
          <>
            {loading ? (
              <div className="text-center text-gray-400 py-8">
                <p className="text-sm">Loading news...</p>
              </div>
            ) : displayNews.length > 0 ? (
              displayNews.map((item) => (
                <div
                  key={item.id}
                  className="border-b border-gray-700 pb-4 last:border-b-0 last:pb-0"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400">{item.source}</span>
                      <span className="text-xs text-gray-500">•</span>
                      <span className="text-xs text-gray-400">{item.timeAgo}</span>
                    </div>
                    <span
                      className={`px-2 py-0.5 text-xs rounded border ${getSentimentColor(
                        item.sentiment
                      )}`}
                    >
                      {item.sentiment.toUpperCase()}
                    </span>
                  </div>
                  <h4 className="text-sm font-semibold text-white mb-1">
                    {item.title}
                  </h4>
                  <p className="text-xs text-gray-400 line-clamp-2">
                    {item.description}
                  </p>
                </div>
              ))
            ) : (
              <div className="text-center text-gray-400 py-8">
                <p className="text-sm">No news available</p>
                <p className="text-xs mt-1">News integration coming in Phase 2</p>
              </div>
            )}
          </>
        )}
        {activeTab === 'filings' && (
          <div className="text-center text-gray-400 py-8">
            <p className="text-sm">Filings coming in Phase 2</p>
          </div>
        )}
        {activeTab === 'earnings' && (
          <div className="text-center text-gray-400 py-8">
            <p className="text-sm">Earnings data coming in Phase 2</p>
          </div>
        )}
      </div>
    </div>
  )
}

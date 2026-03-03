'use client'

import { useQuery } from '@tanstack/react-query'
import { Activity, ExternalLink, AlertTriangle } from 'lucide-react'
import { fetchContinentNews, type ContinentNewsData, type ContinentNewsFeed as FeedType } from '@/lib/monitor-extended-api'

function TagBadge({ tag }: { tag: string }) {
  const colors: Record<string, string> = {
    ALERT: 'bg-red-500/20 text-red-400 border-red-500/30',
    CONFLICT: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
    MILITARY: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    CAUTION: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    DIPLOMATIC: 'bg-sky-500/20 text-sky-400 border-sky-500/30',
    INFRASTRUCTURE: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  }
  return (
    <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider border ${colors[tag] || 'bg-slate-500/20 text-slate-400 border-slate-500/30'}`}>
      {tag}
    </span>
  )
}

function NewsFeedCard({ feed }: { feed: FeedType }) {
  return (
    <div className="bg-slate-950/95 border border-slate-800/70 rounded-xl overflow-hidden flex flex-col">
      {/* Feed Header */}
      <div className="px-3 py-2 border-b border-slate-800/50 flex items-center justify-between bg-gradient-to-r from-slate-950 via-slate-900/60 to-slate-950">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-[0.15em] text-slate-200 font-mono">
            {feed.continent}
          </span>
          {feed.live && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
              </span>
              <span className="text-[8px] text-emerald-400 font-bold">LIVE</span>
            </span>
          )}
        </div>
        <span className="text-[10px] text-slate-600 font-mono">{feed.count}</span>
      </div>

      {/* Articles */}
      <div className="flex-1 min-h-0 overflow-y-auto max-h-64 divide-y divide-slate-800/30">
        {feed.articles.length === 0 ? (
          <div className="flex items-center justify-center p-6 text-[10px] text-slate-600">
            No recent articles
          </div>
        ) : feed.articles.map((article, i) => (
          <div key={i} className="px-3 py-2.5 hover:bg-slate-800/20 transition-colors group">
            <div className="flex items-start gap-2">
              {article.threat_level === 'critical' || article.threat_level === 'high' ? (
                <span className="mt-0.5 w-2 h-2 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
              ) : (
                <span className="mt-0.5 w-2 h-2 rounded-full bg-emerald-500/60 flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap mb-1">
                  <span className="text-[9px] text-slate-500 font-mono uppercase">{article.source}</span>
                  {article.tags.map(tag => (
                    <TagBadge key={tag} tag={tag} />
                  ))}
                </div>
                {article.url ? (
                  <a
                    href={article.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] font-medium text-slate-300 leading-snug line-clamp-2 group-hover:text-sky-400 transition-colors"
                  >
                    {article.title}
                  </a>
                ) : (
                  <p className="text-[11px] font-medium text-slate-300 leading-snug line-clamp-2">
                    {article.title}
                  </p>
                )}
                <span className="text-[9px] text-slate-600 mt-0.5 block">{article.time_ago}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function ContinentNewsFeedGrid() {
  const { data, isLoading } = useQuery<ContinentNewsData>({
    queryKey: ['continent-news'],
    queryFn: fetchContinentNews,
    refetchInterval: 120_000,
    staleTime: 60_000,
  })

  if (isLoading) {
    return (
      <div className="grid grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
        {[...Array(9)].map((_, i) => (
          <div key={i} className="h-48 bg-slate-800/50 rounded-xl animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
      {data?.feeds.map((feed) => (
        <NewsFeedCard key={feed.continent} feed={feed} />
      ))}
    </div>
  )
}

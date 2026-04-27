/**
 * Ticker Impact Drawer
 * Shows stocks and ETFs potentially impacted by a global event
 * Integrates with existing watchlist and markets data
 */
'use client'

import { useQuery } from '@tanstack/react-query'
import { X, TrendingUp, TrendingDown, Minus, AlertTriangle, Star, Plus } from 'lucide-react'
import Link from 'next/link'
import { fetchTickerImpact, GlobalEvent, TickerImpact } from '@/lib/global-monitor-api'
import { addToWatchlist, syncSymbol } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { useState } from 'react'
import { formatPercent } from '@/lib/format'

interface Props {
  event: GlobalEvent
  onClose: () => void
}

export default function TickerImpactDrawer({ event, onClose }: Props) {
  const { isAuthenticated } = useAuth()
  const [addingToWatchlist, setAddingToWatchlist] = useState<string | null>(null)

  const { data: impacts, isLoading } = useQuery<TickerImpact[]>({
    queryKey: ['ticker-impact', event.event_id],
    queryFn: () => fetchTickerImpact(event.event_id, 20),
    enabled: !!event.event_id
  })

  const handleAddToWatchlist = async (ticker: string) => {
    if (!isAuthenticated) return
    
    setAddingToWatchlist(ticker)
    try {
      await syncSymbol(ticker)
      await addToWatchlist({ symbol: ticker, source: 'global_monitor' })
      // Could show success toast here
    } catch (error) {
      console.error('Failed to add to watchlist:', error)
      // Could show error toast here
    } finally {
      setAddingToWatchlist(null)
    }
  }

  return (
    <div className="fixed inset-y-0 right-0 w-[480px] bg-surface-raised border-l border-line-default shadow-theme-lg z-50 flex flex-col">
      {/* Header */}
      <div className="p-6 border-b border-line-default">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <span className={`px-2 py-1 rounded text-xs font-medium ${getThreatBadgeClass(event.threat_level)}`}>
                {event.threat_level.toUpperCase()}
              </span>
              <span className="text-xs text-slate-500">
                {event.category}
              </span>
            </div>
            <h2 className="text-lg font-bold text-slate-50 line-clamp-2">
              {event.title}
            </h2>
            <p className="text-sm text-fg-secondary mt-1">
              {event.location_name || event.country_code}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-surface-hover rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-slate-400" />
          </button>
        </div>

        {/* Event Description */}
        {event.description && (
          <p className="text-sm text-slate-300 mt-3 line-clamp-3">
            {event.description}
          </p>
        )}
      </div>

      {/* Impacts List */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-32">
            <div className="text-sm text-fg-secondary">Analyzing market impact...</div>
          </div>
        ) : impacts && impacts.length > 0 ? (
          <div className="p-6 space-y-3">
            <div className="text-sm font-medium text-fg-secondary mb-4">
              Potentially Impacted Securities ({impacts.length})
            </div>

            {impacts.map((impact, idx) => (
              <div
                key={`${impact.ticker}-${idx}`}
                className="bg-surface-raised/50 rounded-xl p-4 border border-line-default hover:border-line-strong transition-colors"
              >
                {/* Ticker Header */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <Link
                      href={`/research?symbol=${impact.ticker}`}
                      className="text-base font-bold text-slate-50 hover:text-sky-400 transition-colors"
                    >
                      {impact.ticker}
                    </Link>
                    {impact.company_name && (
                      <div className="text-xs text-fg-secondary mt-0.5">
                        {impact.company_name}
                      </div>
                    )}
                  </div>
                  
                  {/* Add to Watchlist */}
                  {isAuthenticated && (
                    <button
                      onClick={() => handleAddToWatchlist(impact.ticker)}
                      disabled={addingToWatchlist === impact.ticker}
                      className="p-2 hover:bg-surface-hover rounded-lg transition-colors disabled:opacity-50"
                      title="Add to watchlist"
                    >
                      {addingToWatchlist === impact.ticker ? (
                        <div className="w-4 h-4 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <Plus className="w-4 h-4 text-fg-secondary" />
                      )}
                    </button>
                  )}
                </div>

                {/* Impact Metrics */}
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <div className="text-xs text-fg-muted">Impact Score</div>
                    <div className="text-lg font-bold text-fg-primary mt-0.5">
                      {impact.impact_score.toFixed(1)}
                      <span className="text-xs text-fg-secondary ml-1">/100</span>
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-fg-muted">Confidence</div>
                    <div className="text-lg font-bold text-fg-primary mt-0.5">
                      {formatPercent(impact.confidence * 100)}
                    </div>
                  </div>
                </div>

                {/* Direction & Volatility */}
                <div className="flex items-center gap-4 mb-3">
                  {impact.expected_direction && (
                    <div className="flex items-center gap-1.5">
                      {impact.expected_direction === 'positive' ? (
                        <TrendingUp className="w-4 h-4 text-green-500" />
                      ) : impact.expected_direction === 'negative' ? (
                        <TrendingDown className="w-4 h-4 text-red-500" />
                      ) : (
                        <Minus className="w-4 h-4 text-slate-400" />
                      )}
                      <span className={`text-xs font-medium ${
                        impact.expected_direction === 'positive' ? 'text-green-400' :
                        impact.expected_direction === 'negative' ? 'text-red-400' :
                        'text-fg-secondary'
                      }`}>
                        {impact.expected_direction}
                      </span>
                    </div>
                  )}
                  {impact.volatility_increase && (
                    <div className="text-xs text-orange-400">
                      +{impact.volatility_increase}% volatility
                    </div>
                  )}
                </div>

                {/* Reason */}
                {impact.impact_reason && (
                  <p className="text-xs text-fg-secondary mb-3">
                    {impact.impact_reason}
                  </p>
                )}

                {/* Sector & Type */}
                <div className="flex items-center gap-2 flex-wrap">
                  {impact.sector && (
                    <span className="px-2 py-1 bg-surface-raised rounded text-xs text-fg-secondary">
                      {impact.sector}
                    </span>
                  )}
                  <span className="px-2 py-1 bg-surface-raised rounded text-xs text-fg-secondary">
                    {impact.correlation_type}
                  </span>
                </div>

                {/* Related ETFs */}
                {impact.related_etfs && impact.related_etfs.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-line-subtle">
                    <div className="text-xs text-fg-muted mb-1.5">Related ETFs</div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {impact.related_etfs.map(etf => (
                        <Link
                          key={etf}
                          href={`/research?symbol=${etf}`}
                          className="px-2 py-1 bg-surface-raised/50 rounded text-xs text-sky-400 hover:bg-surface-raised transition-colors"
                        >
                          {etf}
                        </Link>
                      ))}
                    </div>
                  </div>
                )}

                {/* Peer Tickers */}
                {impact.peer_tickers && impact.peer_tickers.length > 0 && (
                  <div className="mt-2">
                    <div className="text-xs text-fg-muted mb-1.5">Peer Stocks</div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {impact.peer_tickers.slice(0, 5).map(peer => (
                        <Link
                          key={peer}
                          href={`/research?symbol=${peer}`}
                          className="px-2 py-1 bg-surface-raised/50 rounded text-xs text-fg-secondary hover:text-fg-primary hover:bg-surface-raised transition-colors"
                        >
                          {peer}
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-64 text-center px-6">
            <AlertTriangle className="w-12 h-12 text-fg-muted mb-3" />
            <p className="text-sm text-fg-secondary">
              No significant market impact detected for this event
            </p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-line-default bg-surface-raised/50">
        <div className="text-xs text-fg-muted text-center">
          Impact analysis powered by AI correlation engine
        </div>
      </div>
    </div>
  )
}

function getThreatBadgeClass(level: string): string {
  const classes = {
    critical: 'bg-red-500/20 text-red-400 border border-red-500/50',
    high: 'bg-orange-500/20 text-orange-400 border border-orange-500/50',
    medium: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/50',
    low: 'bg-blue-500/20 text-blue-400 border border-blue-500/50',
    unknown: 'bg-gray-500/20 text-gray-400 border border-gray-500/50'
  }
  return classes[level as keyof typeof classes] || classes.unknown
}

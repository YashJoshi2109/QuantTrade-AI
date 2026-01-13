'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import AppLayout from '@/components/AppLayout'
import { TrendingUp, TrendingDown, Plus, Trash2, Star, Loader2, RefreshCw, X } from 'lucide-react'
import { getWatchlist, addToWatchlist, removeFromWatchlist, fetchPrices, syncSymbol } from '@/lib/api'

interface WatchlistItem {
  id: number
  symbol: string
  name: string | null
  added_at: string
  price?: number
  change?: number
  percent?: number
  volume?: string
  marketCap?: string
  starred?: boolean
}

export default function WatchlistPage() {
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [newSymbol, setNewSymbol] = useState('')
  const [showAddModal, setShowAddModal] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadWatchlist()
  }, [])

  const loadWatchlist = async () => {
    setLoading(true)
    setError(null)
    try {
      const items = await getWatchlist()
      
      // Fetch latest prices for each item
      const itemsWithPrices = await Promise.all(
        items.map(async (item: WatchlistItem) => {
          try {
            const prices = await fetchPrices(item.symbol)
            if (prices.length >= 2) {
              const latest = prices[prices.length - 1]
              const previous = prices[prices.length - 2]
              const change = latest.close - previous.close
              const percent = (change / previous.close) * 100
              return {
                ...item,
                price: latest.close,
                change,
                percent,
                volume: `${(latest.volume / 1e6).toFixed(1)}M`,
                starred: false
              }
            }
          } catch (e) {
            console.error(`Error fetching prices for ${item.symbol}:`, e)
          }
          return { ...item, starred: false }
        })
      )
      
      setWatchlist(itemsWithPrices)
    } catch (err) {
      console.error('Error loading watchlist:', err)
      setError('Failed to load watchlist')
    } finally {
      setLoading(false)
    }
  }

  const handleAddSymbol = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newSymbol.trim()) return
    
    setAdding(true)
    setError(null)
    
    try {
      // First sync the symbol to make sure it exists
      await syncSymbol(newSymbol.toUpperCase())
      // Then add to watchlist
      await addToWatchlist(newSymbol.toUpperCase())
      setNewSymbol('')
      setShowAddModal(false)
      // Reload watchlist
      await loadWatchlist()
    } catch (err: any) {
      console.error('Error adding symbol:', err)
      setError(err.message || 'Failed to add symbol')
    } finally {
      setAdding(false)
    }
  }

  const handleRemoveSymbol = async (symbol: string) => {
    try {
      await removeFromWatchlist(symbol)
      setWatchlist(watchlist.filter(item => item.symbol !== symbol))
    } catch (err) {
      console.error('Error removing symbol:', err)
      setError('Failed to remove symbol')
    }
  }

  const toggleStar = (symbol: string) => {
    setWatchlist(watchlist.map(item => 
      item.symbol === symbol ? { ...item, starred: !item.starred } : item
    ))
  }

  // Calculate stats
  const totalGainers = watchlist.filter(item => (item.percent || 0) > 0).length
  const totalLosers = watchlist.filter(item => (item.percent || 0) < 0).length
  const topGainer = watchlist.reduce((max, item) => 
    (item.percent || 0) > (max?.percent || -Infinity) ? item : max, watchlist[0])
  const topLoser = watchlist.reduce((min, item) => 
    (item.percent || 0) < (min?.percent || Infinity) ? item : min, watchlist[0])
  const avgChange = watchlist.length > 0 
    ? watchlist.reduce((sum, item) => sum + (item.percent || 0), 0) / watchlist.length 
    : 0

  return (
    <AppLayout>
      <div className="p-6">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold text-white">Your Watchlist</h1>
              <p className="text-sm text-gray-400 mt-1">
                {watchlist.length} symbols tracked • {totalGainers} up • {totalLosers} down
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button 
                onClick={loadWatchlist}
                disabled={loading}
                className="flex items-center gap-2 px-3 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-medium text-sm transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
              <button 
                onClick={() => setShowAddModal(true)}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium text-sm transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add Symbol
              </button>
            </div>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* Watchlist Table */}
          <div className="bg-[#1e293b] border border-slate-700 rounded-lg overflow-hidden">
            {loading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="w-8 h-8 text-blue-400 animate-spin" />
              </div>
            ) : watchlist.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                <p className="text-lg mb-2">Your watchlist is empty</p>
                <p className="text-sm mb-4">Add symbols to start tracking them</p>
                <button 
                  onClick={() => setShowAddModal(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium text-sm transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Add Your First Symbol
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-700 bg-slate-800/50">
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider w-8"></th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Symbol</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider">Price</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider">Change</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider">%</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider">Volume</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider w-20">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700">
                    {watchlist.map((item) => (
                      <tr key={item.id} className="hover:bg-slate-800/50 transition-colors">
                        <td className="px-4 py-4">
                          <button
                            onClick={() => toggleStar(item.symbol)}
                            className={`${item.starred ? 'text-yellow-400' : 'text-gray-500 hover:text-yellow-400'} transition-colors`}
                          >
                            <Star className={`w-4 h-4 ${item.starred ? 'fill-current' : ''}`} />
                          </button>
                        </td>
                        <td className="px-4 py-4">
                          <Link href={`/research?symbol=${item.symbol}`} className="hover:text-blue-400 transition-colors">
                            <div className="font-semibold text-white">{item.symbol}</div>
                            <div className="text-xs text-gray-400">{item.name || 'Unknown'}</div>
                          </Link>
                        </td>
                        <td className="px-4 py-4 text-right font-mono text-white">
                          {item.price ? `$${item.price.toFixed(2)}` : 'N/A'}
                        </td>
                        <td className={`px-4 py-4 text-right font-mono ${
                          (item.change || 0) >= 0 ? 'text-green-500' : 'text-red-500'
                        }`}>
                          {item.change !== undefined 
                            ? `${item.change >= 0 ? '+' : ''}${item.change.toFixed(2)}`
                            : 'N/A'
                          }
                        </td>
                        <td className="px-4 py-4 text-right">
                          {item.percent !== undefined ? (
                            <span className={`inline-flex items-center gap-1 font-mono ${
                              item.percent >= 0 ? 'text-green-500' : 'text-red-500'
                            }`}>
                              {item.percent >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                              {item.percent >= 0 ? '+' : ''}{item.percent.toFixed(2)}%
                            </span>
                          ) : 'N/A'}
                        </td>
                        <td className="px-4 py-4 text-right font-mono text-gray-300">
                          {item.volume || 'N/A'}
                        </td>
                        <td className="px-4 py-4 text-right">
                          <button
                            onClick={() => handleRemoveSymbol(item.symbol)}
                            className="text-gray-400 hover:text-red-400 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Quick Stats */}
          {watchlist.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-6">
              <div className="bg-[#1e293b] border border-slate-700 rounded-lg p-4">
                <p className="text-sm text-gray-400 mb-1">Total Symbols</p>
                <p className="text-2xl font-bold text-white">{watchlist.length}</p>
                <p className="text-xs text-gray-400 mt-1">{totalGainers} gainers, {totalLosers} losers</p>
              </div>
              <div className="bg-[#1e293b] border border-slate-700 rounded-lg p-4">
                <p className="text-sm text-gray-400 mb-1">Top Gainer</p>
                <p className="text-2xl font-bold text-green-400">{topGainer?.symbol || 'N/A'}</p>
                <p className="text-xs text-green-400 mt-1">
                  {topGainer?.percent ? `+${topGainer.percent.toFixed(2)}%` : 'N/A'}
                </p>
              </div>
              <div className="bg-[#1e293b] border border-slate-700 rounded-lg p-4">
                <p className="text-sm text-gray-400 mb-1">Top Loser</p>
                <p className="text-2xl font-bold text-red-400">{topLoser?.symbol || 'N/A'}</p>
                <p className="text-xs text-red-400 mt-1">
                  {topLoser?.percent ? `${topLoser.percent.toFixed(2)}%` : 'N/A'}
                </p>
              </div>
              <div className="bg-[#1e293b] border border-slate-700 rounded-lg p-4">
                <p className="text-sm text-gray-400 mb-1">Avg Change</p>
                <p className={`text-2xl font-bold ${avgChange >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {avgChange >= 0 ? '+' : ''}{avgChange.toFixed(2)}%
                </p>
                <p className="text-xs text-gray-400 mt-1">Across {watchlist.length} symbols</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Add Symbol Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-[#1e293b] border border-slate-700 rounded-lg p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-white">Add Symbol to Watchlist</h2>
              <button 
                onClick={() => setShowAddModal(false)}
                className="text-gray-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleAddSymbol}>
              <input
                type="text"
                value={newSymbol}
                onChange={(e) => setNewSymbol(e.target.value.toUpperCase())}
                placeholder="Enter symbol (e.g., AAPL)"
                className="w-full px-4 py-3 bg-[#131722] border border-slate-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500 mb-4"
                autoFocus
              />
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={adding || !newSymbol.trim()}
                  className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  {adding ? 'Adding...' : 'Add'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AppLayout>
  )
}

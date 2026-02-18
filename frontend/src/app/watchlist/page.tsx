'use client'

/**
 * Watchlist Page - Production-grade implementation
 * 
 * Implementation Notes:
 * - Uses React Query for data fetching with optimistic updates
 * - Optimistic UI: Changes appear immediately, rollback on error
 * - Universal symbol search with ranked results
 * - KPI cards at top showing Total, Top Gainer, Top Loser, Avg Change
 * - Debounced search with keyboard navigation (↑/↓/Enter/Escape)
 * - Toast notifications for all actions
 * 
 * API Contract:
 * - GET /api/v1/watchlist → List items
 * - POST /api/v1/watchlist → Add { symbol, note? }
 * - DELETE /api/v1/watchlist/{symbol} → Remove
 * - PUT /api/v1/watchlist/{symbol} → Update { note }
 * - GET /api/v1/symbols/search?q=...&limit=... → Universal search
 */

import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import Link from 'next/link'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import AppLayout from '@/components/AppLayout'
import MobileLayout from '@/components/layout/MobileLayout'
import MobileWatchlist from '@/components/layout/MobileWatchlist'
import { 
  TrendingUp, TrendingDown, Plus, Trash2, Star, Loader2,
  RefreshCw, X, LogIn, Edit2, Check, AlertCircle, Search, 
  Building2, Globe, Briefcase, Link2, Unlink, Filter,
  Sparkles, PieChart, BarChart3, Layers, AlertTriangle
} from 'lucide-react'
import { 
  getWatchlist, addToWatchlist, removeFromWatchlist, 
  updateWatchlistNote, fetchPrices, syncSymbol,
  searchSymbols, SearchResult,
  WatchlistItem
} from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/components/Toast'
import { SkeletonWatchlistTable, SkeletonText } from '@/components/Skeleton'

interface WatchlistItemWithPrice extends WatchlistItem {
  price?: number
  change?: number
  percent?: number
  volume?: string
  starred?: boolean
}

type ActiveTab = 'watchlist' | 'portfolio'

interface BrokerConnection {
  id: string
  name: string
  icon: string
  connected: boolean
  accountCount: number
  totalValue: number
}

interface PortfolioHolding {
  symbol: string
  name: string
  shares: number
  avgCost: number
  currentPrice: number
  marketValue: number
  pnl: number
  pnlPercent: number
  sector: string
  broker: string
  weight: number
}

const SUPPORTED_BROKERS: Omit<BrokerConnection, 'connected' | 'accountCount' | 'totalValue'>[] = [
  { id: 'robinhood', name: 'Robinhood', icon: '🪶' },
  { id: 'fidelity', name: 'Fidelity', icon: '🏛️' },
  { id: 'schwab', name: 'Charles Schwab', icon: '💼' },
  { id: 'etrade', name: 'E*TRADE', icon: '📊' },
  { id: 'td_ameritrade', name: 'TD Ameritrade', icon: '🟢' },
  { id: 'webull', name: 'Webull', icon: '🐂' },
  { id: 'interactive_brokers', name: 'Interactive Brokers', icon: '🔴' },
  { id: 'vanguard', name: 'Vanguard', icon: '⛵' },
]

// Query key for cache management
const WATCHLIST_QUERY_KEY = ['watchlist']

function DesktopWatchlistPage() {
  const { isAuthenticated, isLoading: authLoading } = useAuth()
  const queryClient = useQueryClient()
  const toast = useToast()
  
  // Form state
  const [showAddModal, setShowAddModal] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const [editingNote, setEditingNote] = useState<string | null>(null)
  const [noteText, setNoteText] = useState('')
  
  // Portfolio state
  const [activeTab, setActiveTab] = useState<ActiveTab>('watchlist')
  const [showBrokerConnect, setShowBrokerConnect] = useState(false)
  const [brokers, setBrokers] = useState<BrokerConnection[]>(
    SUPPORTED_BROKERS.map(b => ({ ...b, connected: false, accountCount: 0, totalValue: 0 }))
  )
  const [holdings, setHoldings] = useState<PortfolioHolding[]>([])
  const [selectedBrokerFilter, setSelectedBrokerFilter] = useState<string | null>(null)
  const [selectedSectorFilter, setSelectedSectorFilter] = useState<string | null>(null)
  const [sortByPerformance, setSortByPerformance] = useState(false)
  const [showOptimizer, setShowOptimizer] = useState(false)
  const [optimizing, setOptimizing] = useState(false)
  const [optimizeResult, setOptimizeResult] = useState<null | { score: number; suggestions: string[] }>(null)

  // Refs
  const isAddingRef = useRef(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)
  const searchDebounceRef = useRef<NodeJS.Timeout | null>(null)

  // Debounced search
  useEffect(() => {
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current)
    }
    
    if (!searchQuery.trim()) {
      setSearchResults([])
      setSelectedIndex(-1)
      setIsSearching(false)
      return
    }
    
    setIsSearching(true)
    searchDebounceRef.current = setTimeout(async () => {
      try {
        const results = await searchSymbols(searchQuery, 10)
        setSearchResults(results)
        setSelectedIndex(-1)
      } catch (error) {
        console.error('Search failed:', error)
        setSearchResults([])
      } finally {
        setIsSearching(false)
      }
    }, 300)
    
    return () => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current)
      }
    }
  }, [searchQuery])

  // Keyboard navigation for search
  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!searchResults.length) return
    
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setSelectedIndex(prev => Math.min(prev + 1, searchResults.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setSelectedIndex(prev => Math.max(prev - 1, 0))
        break
      case 'Enter':
        e.preventDefault()
        if (selectedIndex >= 0 && searchResults[selectedIndex]) {
          handleSelectSearchResult(searchResults[selectedIndex])
        }
        break
      case 'Escape':
        setSearchQuery('')
        setSearchResults([])
        setSelectedIndex(-1)
        break
    }
  }, [searchResults, selectedIndex])

  // Scroll selected result into view
  useEffect(() => {
    if (selectedIndex >= 0 && resultsRef.current) {
      const items = resultsRef.current.querySelectorAll('[data-result]')
      items[selectedIndex]?.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex])

  // Fetch watchlist with React Query
  const { 
    data: watchlistRaw = [], 
    isLoading, 
    error,
    refetch 
  } = useQuery({
    queryKey: WATCHLIST_QUERY_KEY,
    queryFn: getWatchlist,
    enabled: isAuthenticated,
    staleTime: 30000, // Consider data fresh for 30s
    refetchOnWindowFocus: true,
  })

  // Fetch prices for watchlist items
  const { data: watchlist = [] } = useQuery({
    queryKey: ['watchlist-prices', watchlistRaw.map(i => i.symbol).join(',')],
    queryFn: async (): Promise<WatchlistItemWithPrice[]> => {
      if (watchlistRaw.length === 0) return []
      
      const itemsWithPrices = await Promise.all(
        watchlistRaw.map(async (item): Promise<WatchlistItemWithPrice> => {
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
      return itemsWithPrices
    },
    enabled: watchlistRaw.length > 0,
    staleTime: 60000, // Prices fresh for 1 min
  })

  // Add mutation with optimistic update
  const addMutation = useMutation({
    mutationFn: async (symbol: string) => {
      // Sync symbol first to ensure it exists
      await syncSymbol(symbol)
      return addToWatchlist({ symbol })
    },
    onMutate: async (symbol) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: WATCHLIST_QUERY_KEY })
      
      // Snapshot previous value
      const previousWatchlist = queryClient.getQueryData<WatchlistItem[]>(WATCHLIST_QUERY_KEY)
      
      // Optimistically add the item
      const optimisticItem: WatchlistItem = {
        id: Date.now(), // Temporary ID
        symbol: symbol.toUpperCase(),
        name: null,
        note: null,
        source: null,
        added_at: new Date().toISOString(),
        updated_at: null,
      }
      
      queryClient.setQueryData<WatchlistItem[]>(WATCHLIST_QUERY_KEY, (old = []) => [
        optimisticItem,
        ...old
      ])
      
      return { previousWatchlist }
    },
    onError: (err, symbol, context) => {
      // Rollback on error
      if (context?.previousWatchlist) {
        queryClient.setQueryData(WATCHLIST_QUERY_KEY, context.previousWatchlist)
      }
      toast.error(err instanceof Error ? err.message : 'Failed to add symbol')
    },
    onSuccess: (data) => {
      toast.success(`${data.symbol} added to watchlist`)
      setSearchQuery('')
      setSearchResults([])
      setShowAddModal(false)
    },
    onSettled: () => {
      // Refetch to get accurate data
      queryClient.invalidateQueries({ queryKey: WATCHLIST_QUERY_KEY })
      isAddingRef.current = false
    },
  })

  // Remove mutation with optimistic update
  const removeMutation = useMutation({
    mutationFn: removeFromWatchlist,
    onMutate: async (symbol) => {
      await queryClient.cancelQueries({ queryKey: WATCHLIST_QUERY_KEY })
      
      const previousWatchlist = queryClient.getQueryData<WatchlistItem[]>(WATCHLIST_QUERY_KEY)
      
      // Optimistically remove the item
      queryClient.setQueryData<WatchlistItem[]>(WATCHLIST_QUERY_KEY, (old = []) => 
        old.filter(item => item.symbol !== symbol.toUpperCase())
      )
      
      return { previousWatchlist, symbol }
    },
    onError: (err, symbol, context) => {
      // Rollback on error
      if (context?.previousWatchlist) {
        queryClient.setQueryData(WATCHLIST_QUERY_KEY, context.previousWatchlist)
      }
      toast.error(err instanceof Error ? err.message : 'Failed to remove symbol')
    },
    onSuccess: (_, symbol) => {
      toast.success(`${symbol.toUpperCase()} removed from watchlist`)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: WATCHLIST_QUERY_KEY })
    },
  })

  // Update note mutation
  const updateNoteMutation = useMutation({
    mutationFn: ({ symbol, note }: { symbol: string; note: string | null }) => 
      updateWatchlistNote(symbol, note),
    onMutate: async ({ symbol, note }) => {
      await queryClient.cancelQueries({ queryKey: WATCHLIST_QUERY_KEY })
      
      const previousWatchlist = queryClient.getQueryData<WatchlistItem[]>(WATCHLIST_QUERY_KEY)
      
      queryClient.setQueryData<WatchlistItem[]>(WATCHLIST_QUERY_KEY, (old = []) => 
        old.map(item => 
          item.symbol === symbol.toUpperCase() 
            ? { ...item, note, updated_at: new Date().toISOString() }
            : item
        )
      )
      
      return { previousWatchlist }
    },
    onError: (err, _, context) => {
      if (context?.previousWatchlist) {
        queryClient.setQueryData(WATCHLIST_QUERY_KEY, context.previousWatchlist)
      }
      toast.error(err instanceof Error ? err.message : 'Failed to update note')
    },
    onSuccess: (data) => {
      toast.success(`Note updated for ${data.symbol}`)
      setEditingNote(null)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: WATCHLIST_QUERY_KEY })
    },
  })

  // Handlers
  const handleSelectSearchResult = useCallback(async (result: SearchResult) => {
    const symbol = result.symbol.toUpperCase()
    
    // Prevent double-click
    if (isAddingRef.current || addMutation.isPending) return
    isAddingRef.current = true
    
    // Check if already exists
    if (watchlist.some(item => item.symbol === symbol)) {
      toast.warning(`${symbol} is already in your watchlist`)
      isAddingRef.current = false
      return
    }
    
    addMutation.mutate(symbol)
  }, [watchlist, addMutation, toast])

  const handleAddManualSymbol = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    
    const symbol = searchQuery.trim().toUpperCase()
    if (!symbol) return
    
    // Prevent double-click
    if (isAddingRef.current || addMutation.isPending) return
    isAddingRef.current = true
    
    // Validate symbol format
    if (!/^[A-Z0-9.\-]{1,10}$/.test(symbol)) {
      toast.error('Invalid symbol format. Use 1-10 uppercase letters, numbers, dots, or dashes.')
      isAddingRef.current = false
      return
    }
    
    // Check if already exists
    if (watchlist.some(item => item.symbol === symbol)) {
      toast.warning(`${symbol} is already in your watchlist`)
      isAddingRef.current = false
      return
    }
    
    addMutation.mutate(symbol)
  }, [searchQuery, watchlist, addMutation, toast])

  const handleRemove = useCallback((symbol: string) => {
    if (removeMutation.isPending) return
    removeMutation.mutate(symbol)
  }, [removeMutation])

  const handleEditNote = useCallback((symbol: string, currentNote: string | null) => {
    setEditingNote(symbol)
    setNoteText(currentNote || '')
  }, [])

  const handleSaveNote = useCallback((symbol: string) => {
    updateNoteMutation.mutate({ symbol, note: noteText || null })
  }, [noteText, updateNoteMutation])

  const toggleStar = useCallback((symbol: string) => {
    // Local state only - not persisted
    queryClient.setQueryData<WatchlistItemWithPrice[]>(['watchlist-prices', watchlist.map(i => i.symbol).join(',')], (old = []) =>
      old.map(item => 
        item.symbol === symbol ? { ...item, starred: !item.starred } : item
      )
    )
  }, [watchlist, queryClient])

  // Calculate stats
  const stats = useMemo(() => {
    const gainers = watchlist.filter(item => (item.percent || 0) > 0).length
    const losers = watchlist.filter(item => (item.percent || 0) < 0).length
    const topGainer = watchlist.reduce((max, item) => 
      (item.percent || 0) > (max?.percent || -Infinity) ? item : max, watchlist[0])
    const topLoser = watchlist.reduce((min, item) => 
      (item.percent || 0) < (min?.percent || Infinity) ? item : min, watchlist[0])
    const avgChange = watchlist.length > 0 
      ? watchlist.reduce((sum, item) => sum + (item.percent || 0), 0) / watchlist.length 
      : 0
    return { gainers, losers, topGainer, topLoser, avgChange }
  }, [watchlist])

  // Portfolio computed values
  const connectedBrokers = brokers.filter(b => b.connected)
  const hasPortfolio = connectedBrokers.length > 0

  const portfolioSectors = useMemo(() => Array.from(new Set(holdings.map(h => h.sector))), [holdings])
  const portfolioBrokerNames = useMemo(() => Array.from(new Set(holdings.map(h => h.broker))), [holdings])

  const filteredHoldings = useMemo(() => {
    let filtered = holdings
    if (selectedBrokerFilter) filtered = filtered.filter(h => h.broker === selectedBrokerFilter)
    if (selectedSectorFilter) filtered = filtered.filter(h => h.sector === selectedSectorFilter)
    if (sortByPerformance) filtered = [...filtered].sort((a, b) => b.pnlPercent - a.pnlPercent)
    return filtered
  }, [holdings, selectedBrokerFilter, selectedSectorFilter, sortByPerformance])

  const portfolioStats = useMemo(() => {
    const totalValue = filteredHoldings.reduce((s, h) => s + h.marketValue, 0)
    const totalPnl = filteredHoldings.reduce((s, h) => s + h.pnl, 0)
    const totalCost = filteredHoldings.reduce((s, h) => s + (h.avgCost * h.shares), 0)
    const totalPnlPercent = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0
    return { totalValue, totalPnl, totalPnlPercent, holdingCount: filteredHoldings.length }
  }, [filteredHoldings])

  const handleConnectBroker = (brokerId: string) => {
    // TODO: Integrate with real broker OAuth flow (e.g. Plaid)
    // For now, toggle connection state — actual holdings would be fetched from the broker API
    setBrokers(prev => prev.map(b =>
      b.id === brokerId
        ? { ...b, connected: !b.connected, accountCount: b.connected ? 0 : 1, totalValue: 0 }
        : b
    ))
    // When disconnecting, clear holdings from this broker
    const broker = brokers.find(b => b.id === brokerId)
    if (broker?.connected) {
      setHoldings(prev => prev.filter(h => h.broker !== broker.name))
    }
  }

  const handleOptimize = async () => {
    if (holdings.length === 0) return
    setOptimizing(true)
    // TODO: Call real portfolio optimization API endpoint
    // e.g. const result = await fetch('/api/v1/portfolio/optimize', { method: 'POST', body: JSON.stringify({ holdings }) })
    setOptimizing(false)
  }

  // Auth gate
  if (!authLoading && !isAuthenticated) {
    return (
      <AppLayout>
        <div className="p-6 flex items-center justify-center min-h-[80vh]">
          <div className="text-center max-w-md">
            <div className="hud-panel p-8">
              <LogIn className="w-16 h-16 text-blue-400 mx-auto mb-4" aria-hidden="true" />
              <h2 className="text-2xl font-bold text-white mb-2">Sign In Required</h2>
              <p className="text-slate-400 mb-6">
                Create an account to save and track your favorite stocks in your personalized watchlist.
              </p>
              <Link 
                href="/auth"
                className="inline-block px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-lg transition-colors"
              >
                Sign In / Register
              </Link>
            </div>
          </div>
        </div>
      </AppLayout>
    )
  }

  return (
    <AppLayout>
      <div className="p-6">
        <div className="max-w-6xl mx-auto">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold text-white">
                {activeTab === 'watchlist' ? 'Your Watchlist' : 'Portfolio Optimizer'}
              </h1>
              <p className="text-sm text-gray-400 mt-1">
                {activeTab === 'watchlist'
                  ? `${watchlist.length} symbols tracked • ${stats.gainers} up • ${stats.losers} down`
                  : hasPortfolio
                    ? `${portfolioStats.holdingCount} holdings across ${connectedBrokers.length} broker${connectedBrokers.length > 1 ? 's' : ''}`
                    : 'Connect your brokerage to get started'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {activeTab === 'watchlist' && (
                <>
                  <button
                    onClick={() => refetch()}
                    disabled={isLoading}
                    className="flex items-center gap-2 px-3 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-medium text-sm transition-colors disabled:opacity-50"
                    aria-label="Refresh watchlist"
                  >
                    <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
                    Refresh
                  </button>
                  <button
                    onClick={() => setShowAddModal(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium text-sm transition-colors"
                    aria-label="Add symbol to watchlist"
                  >
                    <Plus className="w-4 h-4" aria-hidden="true" />
                    Add Symbol
                  </button>
                </>
              )}
              {activeTab === 'portfolio' && (
                <>
                  <button
                    onClick={() => setShowBrokerConnect(true)}
                    className="flex items-center gap-2 px-3 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-medium text-sm transition-colors"
                  >
                    <Link2 className="w-4 h-4" aria-hidden="true" />
                    {hasPortfolio ? 'Manage Brokers' : 'Connect Broker'}
                  </button>
                  {hasPortfolio && (
                    <button
                      onClick={() => { setShowOptimizer(true); setOptimizeResult(null) }}
                      className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white rounded-lg font-medium text-sm transition-colors"
                    >
                      <Sparkles className="w-4 h-4" aria-hidden="true" />
                      Optimize Portfolio
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Tab Switcher */}
          <div className="flex gap-1 bg-[#1e293b] rounded-xl p-1 mb-6 w-fit">
            <button
              onClick={() => setActiveTab('watchlist')}
              className={`px-5 py-2 rounded-lg text-sm font-semibold transition-all ${
                activeTab === 'watchlist'
                  ? 'bg-blue-600 text-white shadow-lg'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              Watchlist
            </button>
            <button
              onClick={() => setActiveTab('portfolio')}
              className={`px-5 py-2 rounded-lg text-sm font-semibold transition-all flex items-center gap-2 ${
                activeTab === 'portfolio'
                  ? 'bg-blue-600 text-white shadow-lg'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              <Briefcase className="w-4 h-4" />
              Portfolio
            </button>
          </div>

          {/* ─── WATCHLIST TAB ─── */}
          {activeTab === 'watchlist' && (
            <>
              {/* KPI Cards */}
              {watchlist.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                  <div className="bg-[#1e293b] border border-slate-700 rounded-lg p-4">
                    <p className="text-sm text-gray-400 mb-1">Total Symbols</p>
                    <p className="text-2xl font-bold text-white">{watchlist.length}</p>
                    <p className="text-xs text-gray-400 mt-1">{stats.gainers} gainers, {stats.losers} losers</p>
                  </div>
                  <div className="bg-[#1e293b] border border-slate-700 rounded-lg p-4">
                    <p className="text-sm text-gray-400 mb-1">Top Gainer</p>
                    <div className="flex items-center gap-2">
                      <TrendingUp className="w-5 h-5 text-green-400" />
                      <p className="text-2xl font-bold text-green-400">{stats.topGainer?.symbol || '—'}</p>
                    </div>
                    <p className="text-xs text-green-400 mt-1">
                      {stats.topGainer?.percent ? `+${stats.topGainer.percent.toFixed(2)}%` : '—'}
                    </p>
                  </div>
                  <div className="bg-[#1e293b] border border-slate-700 rounded-lg p-4">
                    <p className="text-sm text-gray-400 mb-1">Top Loser</p>
                    <div className="flex items-center gap-2">
                      <TrendingDown className="w-5 h-5 text-red-400" />
                      <p className="text-2xl font-bold text-red-400">{stats.topLoser?.symbol || '—'}</p>
                    </div>
                    <p className="text-xs text-red-400 mt-1">
                      {stats.topLoser?.percent ? `${stats.topLoser.percent.toFixed(2)}%` : '—'}
                    </p>
                  </div>
                  <div className="bg-[#1e293b] border border-slate-700 rounded-lg p-4">
                    <p className="text-sm text-gray-400 mb-1">Avg Change</p>
                    <p className={`text-2xl font-bold ${stats.avgChange >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {stats.avgChange >= 0 ? '+' : ''}{stats.avgChange.toFixed(2)}%
                    </p>
                    <p className="text-xs text-gray-400 mt-1">Across {watchlist.length} symbols</p>
                  </div>
                </div>
              )}

              {/* Error state */}
              {error && (
                <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm flex items-center gap-2" role="alert">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
                  {error instanceof Error ? error.message : 'Failed to load watchlist'}
                </div>
              )}

              {/* Watchlist Table */}
              <div className="bg-[#1e293b] border border-slate-700 rounded-lg overflow-hidden">
                {isLoading || authLoading ? (
                  <SkeletonWatchlistTable rows={5} />
                ) : watchlist.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                    <p className="text-lg mb-2">Your watchlist is empty</p>
                    <p className="text-sm mb-4">Add symbols to start tracking them</p>
                    <button
                      onClick={() => setShowAddModal(true)}
                      className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium text-sm transition-colors"
                    >
                      <Plus className="w-4 h-4" aria-hidden="true" />
                      Add Your First Symbol
                    </button>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full" role="table" aria-label="Watchlist">
                      <thead>
                        <tr className="border-b border-slate-700 bg-slate-800/50">
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider w-8" scope="col">
                            <span className="sr-only">Favorite</span>
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider" scope="col">Symbol</th>
                          <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider" scope="col">Price</th>
                          <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider" scope="col">Change</th>
                          <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider" scope="col">%</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider" scope="col">Note</th>
                          <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider w-24" scope="col">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-700">
                        {watchlist.map((item) => (
                          <tr key={item.id} className="hover:bg-slate-800/50 transition-colors">
                            <td className="px-4 py-4">
                              <button
                                onClick={() => toggleStar(item.symbol)}
                                className={`${item.starred ? 'text-yellow-400' : 'text-gray-500 hover:text-yellow-400'} transition-colors`}
                                aria-label={item.starred ? `Remove ${item.symbol} from favorites` : `Add ${item.symbol} to favorites`}
                                aria-pressed={item.starred}
                              >
                                <Star className={`w-4 h-4 ${item.starred ? 'fill-current' : ''}`} aria-hidden="true" />
                              </button>
                            </td>
                            <td className="px-4 py-4">
                              <Link
                                href={`/research?symbol=${item.symbol}`}
                                className="hover:text-blue-400 transition-colors group"
                              >
                                <div className="font-semibold text-white group-hover:text-blue-400">{item.symbol}</div>
                                <div className="text-xs text-gray-400">{item.name || 'Unknown'}</div>
                              </Link>
                            </td>
                            <td className="px-4 py-4 text-right font-mono text-white">
                              {item.price ? `$${item.price.toFixed(2)}` : '—'}
                            </td>
                            <td className={`px-4 py-4 text-right font-mono ${
                              (item.change || 0) >= 0 ? 'text-green-500' : 'text-red-500'
                            }`}>
                              {item.change !== undefined
                                ? `${item.change >= 0 ? '+' : ''}${item.change.toFixed(2)}`
                                : '—'
                              }
                            </td>
                            <td className="px-4 py-4 text-right">
                              {item.percent !== undefined ? (
                                <span className={`inline-flex items-center gap-1 font-mono ${
                                  item.percent >= 0 ? 'text-green-500' : 'text-red-500'
                                }`}>
                                  {item.percent >= 0 ? <TrendingUp className="w-3 h-3" aria-hidden="true" /> : <TrendingDown className="w-3 h-3" aria-hidden="true" />}
                                  {item.percent >= 0 ? '+' : ''}{item.percent.toFixed(2)}%
                                </span>
                              ) : '—'}
                            </td>
                            <td className="px-4 py-4 max-w-[200px]">
                              {editingNote === item.symbol ? (
                                <div className="flex items-center gap-2">
                                  <input
                                    type="text"
                                    value={noteText}
                                    onChange={(e) => setNoteText(e.target.value)}
                                    className="flex-1 px-2 py-1 bg-slate-700 border border-slate-600 rounded text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                    placeholder="Add a note..."
                                    maxLength={500}
                                    autoFocus
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') handleSaveNote(item.symbol)
                                      if (e.key === 'Escape') setEditingNote(null)
                                    }}
                                    aria-label={`Note for ${item.symbol}`}
                                  />
                                  <button
                                    onClick={() => handleSaveNote(item.symbol)}
                                    disabled={updateNoteMutation.isPending}
                                    className="text-green-400 hover:text-green-300 disabled:opacity-50"
                                    aria-label="Save note"
                                  >
                                    <Check className="w-4 h-4" aria-hidden="true" />
                                  </button>
                                  <button
                                    onClick={() => setEditingNote(null)}
                                    className="text-gray-400 hover:text-gray-300"
                                    aria-label="Cancel editing"
                                  >
                                    <X className="w-4 h-4" aria-hidden="true" />
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => handleEditNote(item.symbol, item.note)}
                                  className="text-left text-sm text-gray-400 hover:text-white transition-colors truncate max-w-full flex items-center gap-1 group"
                                  aria-label={item.note ? `Edit note: ${item.note}` : `Add note for ${item.symbol}`}
                                >
                                  {item.note || <span className="text-gray-500 italic">Add note...</span>}
                                  <Edit2 className="w-3 h-3 opacity-0 group-hover:opacity-100 flex-shrink-0" aria-hidden="true" />
                                </button>
                              )}
                            </td>
                            <td className="px-4 py-4 text-right">
                              <button
                                onClick={() => handleRemove(item.symbol)}
                                disabled={removeMutation.isPending}
                                className="text-gray-400 hover:text-red-400 transition-colors disabled:opacity-50"
                                aria-label={`Remove ${item.symbol} from watchlist`}
                              >
                                {removeMutation.isPending && removeMutation.variables === item.symbol ? (
                                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                                ) : (
                                  <Trash2 className="w-4 h-4" aria-hidden="true" />
                                )}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}

          {/* ─── PORTFOLIO TAB ─── */}
          {activeTab === 'portfolio' && (
            <>
              {!hasPortfolio ? (
                <div className="bg-[#1e293b] border border-slate-700 rounded-lg p-12 text-center">
                  <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500/20 to-purple-500/20 flex items-center justify-center mx-auto mb-4">
                    <Link2 className="w-8 h-8 text-blue-400" />
                  </div>
                  <h2 className="text-xl font-bold text-white mb-2">Connect Your Brokerage</h2>
                  <p className="text-gray-400 mb-6 max-w-md mx-auto">
                    Import your portfolio from Robinhood, Fidelity, Schwab, and more to get AI-powered optimization insights and sector analysis.
                  </p>
                  <button
                    onClick={() => setShowBrokerConnect(true)}
                    className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors"
                  >
                    <Link2 className="w-5 h-5" />
                    Connect a Broker
                  </button>
                </div>
              ) : (
                <>
                  {/* Connected Brokers Summary */}
                  <div className="grid grid-cols-4 gap-4 mb-6">
                    <div className="bg-[#1e293b] border border-slate-700 rounded-lg p-4">
                      <p className="text-sm text-gray-400 mb-1">Connected Brokers</p>
                      <p className="text-2xl font-bold text-white">{connectedBrokers.length}</p>
                      <div className="flex gap-1 mt-1">
                        {connectedBrokers.map(b => (
                          <span key={b.id} className="text-base" title={b.name}>{b.icon}</span>
                        ))}
                      </div>
                    </div>
                    <div className="bg-[#1e293b] border border-slate-700 rounded-lg p-4">
                      <p className="text-sm text-gray-400 mb-1">Total Value</p>
                      <p className="text-2xl font-bold text-white">
                        {holdings.length > 0 ? `$${(portfolioStats.totalValue / 1000).toFixed(1)}K` : '—'}
                      </p>
                      <p className="text-xs text-gray-400 mt-1">{portfolioStats.holdingCount} holdings</p>
                    </div>
                    <div className="bg-[#1e293b] border border-slate-700 rounded-lg p-4">
                      <p className="text-sm text-gray-400 mb-1">Total P&L</p>
                      {holdings.length > 0 ? (
                        <>
                          <p className={`text-2xl font-bold ${portfolioStats.totalPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {portfolioStats.totalPnl >= 0 ? '+' : ''}${(portfolioStats.totalPnl / 1000).toFixed(1)}K
                          </p>
                          <p className={`text-xs mt-1 ${portfolioStats.totalPnlPercent >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {portfolioStats.totalPnlPercent >= 0 ? '+' : ''}{portfolioStats.totalPnlPercent.toFixed(2)}%
                          </p>
                        </>
                      ) : (
                        <p className="text-2xl font-bold text-white">—</p>
                      )}
                    </div>
                    <div className="bg-[#1e293b] border border-slate-700 rounded-lg p-4">
                      <p className="text-sm text-gray-400 mb-1">Sectors</p>
                      <p className="text-2xl font-bold text-white">{portfolioSectors.length || '—'}</p>
                      <p className="text-xs text-gray-400 mt-1">Diversification spread</p>
                    </div>
                  </div>

                  {/* Filter Bar — only show when there are holdings */}
                  {holdings.length > 0 && (
                    <div className="flex items-center gap-3 mb-4 flex-wrap">
                      <div className="flex items-center gap-2">
                        <Filter className="w-4 h-4 text-gray-400" />
                        <span className="text-sm text-gray-400">Filter:</span>
                      </div>

                      <div className="flex items-center gap-1">
                        <span className="text-xs text-gray-500 mr-1">Broker:</span>
                        <button
                          onClick={() => setSelectedBrokerFilter(null)}
                          className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                            !selectedBrokerFilter ? 'bg-blue-600 text-white' : 'bg-slate-700 text-gray-400 hover:text-white'
                          }`}
                        >
                          All
                        </button>
                        {portfolioBrokerNames.map(bn => (
                          <button
                            key={bn}
                            onClick={() => setSelectedBrokerFilter(selectedBrokerFilter === bn ? null : bn)}
                            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                              selectedBrokerFilter === bn ? 'bg-blue-600 text-white' : 'bg-slate-700 text-gray-400 hover:text-white'
                            }`}
                          >
                            {bn}
                          </button>
                        ))}
                      </div>

                      <div className="w-px h-5 bg-slate-700" />

                      <div className="flex items-center gap-1">
                        <span className="text-xs text-gray-500 mr-1">Sector:</span>
                        <button
                          onClick={() => setSelectedSectorFilter(null)}
                          className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                            !selectedSectorFilter ? 'bg-blue-600 text-white' : 'bg-slate-700 text-gray-400 hover:text-white'
                          }`}
                        >
                          All
                        </button>
                        {portfolioSectors.map(s => (
                          <button
                            key={s}
                            onClick={() => setSelectedSectorFilter(selectedSectorFilter === s ? null : s)}
                            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                              selectedSectorFilter === s ? 'bg-blue-600 text-white' : 'bg-slate-700 text-gray-400 hover:text-white'
                            }`}
                          >
                            {s}
                          </button>
                        ))}
                      </div>

                      <div className="w-px h-5 bg-slate-700" />

                      <button
                        onClick={() => setSortByPerformance(!sortByPerformance)}
                        className={`px-3 py-1 rounded-full text-xs font-medium transition-colors flex items-center gap-1 ${
                          sortByPerformance ? 'bg-blue-600 text-white' : 'bg-slate-700 text-gray-400 hover:text-white'
                        }`}
                      >
                        <BarChart3 className="w-3 h-3" />
                        Sort by P&L
                      </button>

                      {(selectedBrokerFilter || selectedSectorFilter || sortByPerformance) && (
                        <button
                          onClick={() => { setSelectedBrokerFilter(null); setSelectedSectorFilter(null); setSortByPerformance(false) }}
                          className="px-3 py-1 rounded-full text-xs font-medium text-red-400 hover:text-red-300 bg-red-500/10 flex items-center gap-1"
                        >
                          <X className="w-3 h-3" />
                          Clear
                        </button>
                      )}
                    </div>
                  )}

                  {/* Holdings Table or Empty State */}
                  <div className="bg-[#1e293b] border border-slate-700 rounded-lg overflow-hidden">
                    {holdings.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                        <Briefcase className="w-12 h-12 text-slate-600 mb-4" />
                        <p className="text-lg mb-2">No holdings imported yet</p>
                        <p className="text-sm mb-1 max-w-md text-center">
                          Your connected brokerage accounts will sync holdings here automatically once the broker integration API is live.
                        </p>
                        <p className="text-xs text-slate-500 mt-3">
                          Connected: {connectedBrokers.map(b => b.name).join(', ')}
                        </p>
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full" role="table" aria-label="Portfolio Holdings">
                          <thead>
                            <tr className="border-b border-slate-700 bg-slate-800/50">
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider" scope="col">Symbol</th>
                              <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider" scope="col">Shares</th>
                              <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider" scope="col">Avg Cost</th>
                              <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider" scope="col">Price</th>
                              <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider" scope="col">Mkt Value</th>
                              <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider" scope="col">P&L</th>
                              <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider" scope="col">%</th>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider" scope="col">Sector</th>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider" scope="col">Broker</th>
                              <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider" scope="col">Weight</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-700">
                            {filteredHoldings.map(h => (
                              <tr key={h.symbol} className="hover:bg-slate-800/50 transition-colors">
                                <td className="px-4 py-4">
                                  <Link href={`/research?symbol=${h.symbol}`} className="hover:text-blue-400 transition-colors group">
                                    <div className="font-semibold text-white group-hover:text-blue-400">{h.symbol}</div>
                                    <div className="text-xs text-gray-400">{h.name}</div>
                                  </Link>
                                </td>
                                <td className="px-4 py-4 text-right font-mono text-white">{h.shares}</td>
                                <td className="px-4 py-4 text-right font-mono text-gray-400">${h.avgCost.toFixed(2)}</td>
                                <td className="px-4 py-4 text-right font-mono text-white">${h.currentPrice.toFixed(2)}</td>
                                <td className="px-4 py-4 text-right font-mono text-white">${h.marketValue.toLocaleString()}</td>
                                <td className={`px-4 py-4 text-right font-mono ${h.pnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                  {h.pnl >= 0 ? '+' : ''}${h.pnl.toFixed(0)}
                                </td>
                                <td className="px-4 py-4 text-right">
                                  <span className={`inline-flex items-center gap-1 font-mono ${h.pnlPercent >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                    {h.pnlPercent >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                                    {h.pnlPercent >= 0 ? '+' : ''}{h.pnlPercent.toFixed(2)}%
                                  </span>
                                </td>
                                <td className="px-4 py-4">
                                  <span className="px-2 py-1 text-xs rounded-full bg-slate-700 text-gray-300">{h.sector}</span>
                                </td>
                                <td className="px-4 py-4">
                                  <span className="text-sm text-gray-400">{h.broker}</span>
                                </td>
                                <td className="px-4 py-4 text-right">
                                  <div className="flex items-center justify-end gap-2">
                                    <div className="w-16 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                                      <div className="h-full bg-blue-500 rounded-full" style={{ width: `${Math.min(h.weight, 100)}%` }} />
                                    </div>
                                    <span className="text-xs font-mono text-gray-400">{h.weight.toFixed(1)}%</span>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* ─── BROKER CONNECT MODAL ─── */}
      {showBrokerConnect && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={(e) => { if (e.target === e.currentTarget) setShowBrokerConnect(false) }}
        >
          <div className="bg-[#1e293b] border border-slate-700 rounded-lg p-6 w-full max-w-lg mx-4 max-h-[80vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-bold text-white">Connect Brokerage</h2>
                <p className="text-sm text-gray-400">Link accounts to import portfolio holdings</p>
              </div>
              <button onClick={() => setShowBrokerConnect(false)} className="text-gray-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-2 overflow-y-auto">
              {brokers.map(b => (
                <div key={b.id} className="flex items-center justify-between p-4 rounded-lg bg-[#131722] border border-slate-700">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{b.icon}</span>
                    <div>
                      <p className="font-semibold text-white">{b.name}</p>
                      {b.connected && <p className="text-xs text-green-400">Connected</p>}
                    </div>
                  </div>
                  <button
                    onClick={() => handleConnectBroker(b.id)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
                      b.connected
                        ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20'
                        : 'bg-blue-600 hover:bg-blue-500 text-white'
                    }`}
                  >
                    {b.connected ? <><Unlink className="w-4 h-4" /> Disconnect</> : <><Link2 className="w-4 h-4" /> Connect</>}
                  </button>
                </div>
              ))}
              <div className="p-4 border border-dashed border-slate-700 rounded-lg text-center text-gray-500 text-sm">
                More brokerages coming soon — Merrill Lynch, Ally Invest, SoFi, and more
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── OPTIMIZER MODAL ─── */}
      {showOptimizer && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={(e) => { if (e.target === e.currentTarget) setShowOptimizer(false) }}
        >
          <div className="bg-[#1e293b] border border-slate-700 rounded-lg p-6 w-full max-w-2xl mx-4 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500/20 to-blue-500/20 flex items-center justify-center">
                  <Sparkles className="w-5 h-5 text-purple-400" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white">Portfolio Optimizer</h2>
                  <p className="text-sm text-gray-400">AI-powered portfolio analysis & suggestions</p>
                </div>
              </div>
              <button onClick={() => setShowOptimizer(false)} className="text-gray-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 rounded-lg bg-[#131722] border border-slate-700">
                  <div className="flex items-center gap-2 mb-2">
                    <PieChart className="w-5 h-5 text-blue-400" />
                    <span className="text-sm font-semibold text-white">Sector Analysis</span>
                  </div>
                  <p className="text-xs text-gray-400">Evaluates sector diversification and concentration risk</p>
                </div>
                <div className="p-4 rounded-lg bg-[#131722] border border-slate-700">
                  <div className="flex items-center gap-2 mb-2">
                    <BarChart3 className="w-5 h-5 text-purple-400" />
                    <span className="text-sm font-semibold text-white">Risk Assessment</span>
                  </div>
                  <p className="text-xs text-gray-400">Analyzes risk-adjusted returns and portfolio beta</p>
                </div>
                <div className="p-4 rounded-lg bg-[#131722] border border-slate-700">
                  <div className="flex items-center gap-2 mb-2">
                    <Sparkles className="w-5 h-5 text-amber-400" />
                    <span className="text-sm font-semibold text-white">Rebalancing</span>
                  </div>
                  <p className="text-xs text-gray-400">Suggests optimal position adjustments for better returns</p>
                </div>
                <div className="p-4 rounded-lg bg-[#131722] border border-slate-700">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle className="w-5 h-5 text-green-400" />
                    <span className="text-sm font-semibold text-white">Tax Optimization</span>
                  </div>
                  <p className="text-xs text-gray-400">Identifies tax-loss harvesting opportunities</p>
                </div>
              </div>

              {holdings.length === 0 ? (
                <div className="p-6 rounded-lg bg-[#131722] border border-slate-700 text-center">
                  <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto mb-3" />
                  <p className="text-white font-medium mb-1">No holdings to optimize</p>
                  <p className="text-sm text-gray-400">
                    Connect a brokerage and import your holdings to run portfolio optimization.
                  </p>
                </div>
              ) : (
                <button
                  onClick={handleOptimize}
                  disabled={optimizing}
                  className="w-full py-3 rounded-lg bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                >
                  {optimizing ? (
                    <><Loader2 className="w-5 h-5 animate-spin" /> Analyzing...</>
                  ) : (
                    <><Sparkles className="w-5 h-5" /> Run Optimization Analysis</>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Add Symbol Modal with Universal Search */}
      {showAddModal && (
        <div 
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-symbol-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowAddModal(false)
          }}
        >
          <div className="bg-[#1e293b] border border-slate-700 rounded-lg p-6 w-full max-w-lg mx-4 max-h-[80vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h2 id="add-symbol-title" className="text-lg font-bold text-white">Add Symbol to Watchlist</h2>
              <button 
                onClick={() => setShowAddModal(false)}
                className="text-gray-400 hover:text-white"
                aria-label="Close dialog"
              >
                <X className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>
            
            {/* Search Input */}
            <form onSubmit={handleAddManualSymbol}>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={handleSearchKeyDown}
                  placeholder="Search by ticker or company name..."
                  className="w-full pl-10 pr-10 py-3 bg-[#131722] border border-slate-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  autoFocus
                  autoComplete="off"
                />
                {isSearching && (
                  <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-blue-400 animate-spin" />
                )}
              </div>
            </form>
            
            {/* Search Results Dropdown */}
            {searchResults.length > 0 && (
              <div 
                ref={resultsRef}
                className="mt-2 bg-[#131722] border border-slate-700 rounded-lg max-h-[300px] overflow-y-auto"
              >
                {searchResults.map((result, index) => (
                  <button
                    key={result.symbol}
                    data-result
                    onClick={() => handleSelectSearchResult(result)}
                    disabled={addMutation.isPending}
                    className={`w-full px-4 py-3 text-left hover:bg-slate-800 transition-colors border-b border-slate-700 last:border-0 disabled:opacity-50 ${
                      index === selectedIndex ? 'bg-slate-800' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-white">{result.symbol}</span>
                          {result.match_type === 'exact' && (
                            <span className="px-1.5 py-0.5 text-[10px] font-medium bg-green-500/20 text-green-400 rounded">EXACT</span>
                          )}
                        </div>
                        <p className="text-sm text-gray-400 truncate mt-0.5">{result.name || 'Unknown'}</p>
                        <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                          {result.exchange && (
                            <span className="flex items-center gap-1">
                              <Building2 className="w-3 h-3" />
                              {result.exchange}
                            </span>
                          )}
                          {result.asset_type && (
                            <span>{result.asset_type}</span>
                          )}
                          {result.country && (
                            <span className="flex items-center gap-1">
                              <Globe className="w-3 h-3" />
                              {result.country}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-right text-xs text-gray-500 ml-2">
                        {result.currency || 'USD'}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
            
            {/* Empty state / hints */}
            {searchQuery && !isSearching && searchResults.length === 0 && (
              <div className="mt-4 text-center text-gray-400 py-6">
                <p className="mb-2">No matches found for "{searchQuery}"</p>
                <p className="text-sm text-gray-500">
                  Press Enter to add "{searchQuery.toUpperCase()}" directly
                </p>
              </div>
            )}
            
            {!searchQuery && (
              <div className="mt-4 text-sm text-gray-500">
                <p className="mb-2">💡 <strong>Tips:</strong></p>
                <ul className="list-disc list-inside space-y-1">
                  <li>Type ticker symbol: AAPL, MSFT, GOOGL</li>
                  <li>Search by company name: Apple, Microsoft</li>
                  <li>Use ↑↓ arrows to navigate, Enter to select</li>
                  <li>Press Escape to clear search</li>
                </ul>
              </div>
            )}
            
            {/* Actions */}
            <div className="flex gap-3 mt-6 pt-4 border-t border-slate-700">
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAddManualSymbol}
                disabled={addMutation.isPending || !searchQuery.trim()}
                className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {addMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                    Adding...
                  </>
                ) : (
                  <>
                    <Plus className="w-4 h-4" aria-hidden="true" />
                    Add {searchQuery.toUpperCase() || 'Symbol'}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  )
}

export default function WatchlistPage() {
  return (
    <>
      <div className="hidden md:block">
        <DesktopWatchlistPage />
      </div>
      <div className="md:hidden">
        <MobileLayout>
          <MobileWatchlist />
        </MobileLayout>
      </div>
    </>
  )
}

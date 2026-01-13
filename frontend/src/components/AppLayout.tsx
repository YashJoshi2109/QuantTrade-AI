'use client'

import { useState, useEffect, ReactNode, useMemo } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  LayoutDashboard,
  TrendingUp,
  Bookmark,
  FileText,
  Lightbulb,
  Settings,
  Search,
  Bell,
  HelpCircle,
  Loader2,
  Activity,
  Sparkles,
  Zap,
  LogIn,
  LogOut
} from 'lucide-react'
import CopilotPanel from './CopilotPanel'
import { fetchSymbols, Symbol, syncSymbol } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'

interface AppLayoutProps {
  children: ReactNode
  symbol?: string
}

export default function AppLayout({ children, symbol }: AppLayoutProps) {
  const pathname = usePathname()
  const router = useRouter()
  const { user, isAuthenticated, logout, isLoading: authLoading } = useAuth()
  const [copilotOpen, setCopilotOpen] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Symbol[]>([])
  const [showResults, setShowResults] = useState(false)
  const [searching, setSearching] = useState(false)
  const [selectedTimeframe, setSelectedTimeframe] = useState('1M')
  const timeframes = ['1D', '5D', '1M', '6M', 'YTD', '1Y']

  // Determine page context for copilot
  const pageContext = useMemo(() => {
    if (pathname === '/') return 'Dashboard'
    if (pathname === '/markets') return 'Markets'
    if (pathname === '/research') return 'Research'
    if (pathname === '/watchlist') return 'Watchlist'
    if (pathname === '/backtest') return 'Backtest'
    return 'General'
  }, [pathname])

  const menuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, href: '/' },
    { id: 'markets', label: 'Markets', icon: TrendingUp, href: '/markets' },
    { id: 'watchlist', label: 'Watchlist', icon: Bookmark, href: '/watchlist' },
    { id: 'research', label: 'Research', icon: FileText, href: '/research' },
    { id: 'backtest', label: 'Backtest', icon: Activity, href: '/backtest' },
    { id: 'ideas', label: 'Ideas Lab', icon: Lightbulb, href: '/ideas-lab' },
    { id: 'settings', label: 'Settings', icon: Settings, href: '/settings' },
  ]

  useEffect(() => {
    const delayDebounceFn = setTimeout(async () => {
      if (searchQuery.length >= 1) {
        setSearching(true)
        try {
          const results = await fetchSymbols(searchQuery)
          setSearchResults(results)
          setShowResults(true)
        } catch (error) {
          console.error('Search error:', error)
          setSearchResults([])
        } finally {
          setSearching(false)
        }
      } else {
        setSearchResults([])
        setShowResults(false)
      }
    }, 300)

    return () => clearTimeout(delayDebounceFn)
  }, [searchQuery])

  const handleSymbolSelect = async (sym: Symbol) => {
    setShowResults(false)
    setSearchQuery('')
    try {
      await syncSymbol(sym.symbol)
    } catch (error) {
      console.error('Error syncing symbol:', error)
    }
    router.push(`/research?symbol=${sym.symbol}`)
  }

  const handleSearchSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (searchQuery.trim()) {
      const upperSymbol = searchQuery.trim().toUpperCase()
      setShowResults(false)
      setSearchQuery('')
      try {
        await syncSymbol(upperSymbol)
      } catch (error) {
        console.error('Error syncing symbol:', error)
      }
      router.push(`/research?symbol=${upperSymbol}`)
    }
  }

  const sidebarWidth = 224 // w-56 = 14rem = 224px
  const copilotWidth = copilotOpen ? 320 : 0 // w-80 = 20rem = 320px

  return (
    <div className="min-h-screen bg-[#0a0f1a] text-white overflow-hidden">
      {/* Background Effects */}
      <div className="fixed inset-0 bg-mesh pointer-events-none" />
      <div className="fixed inset-0 data-stream pointer-events-none opacity-30" />
      
      {/* Fixed Header */}
      <header className="fixed top-0 left-0 right-0 h-14 z-50">
        <div className="absolute inset-0 bg-[#0d1321]/80 backdrop-blur-xl border-b border-blue-500/10" />
        <div className="relative h-full flex items-center justify-between px-6">
          {/* Logo */}
          <div className="flex items-center gap-3 w-56">
            <div className="relative">
              <Sparkles className="w-8 h-8 text-blue-400" />
              <div className="absolute inset-0 blur-lg bg-blue-400/30" />
            </div>
            <Link href="/" className="text-xl font-bold">
              <span className="gradient-text">AI Copilot</span>
            </Link>
          </div>
          
          {/* Search */}
          <div className="flex-1 max-w-2xl px-4 relative">
            <form onSubmit={handleSearchSubmit} className="relative">
              <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-blue-500/20 to-cyan-500/20 blur-sm" />
              <div className="relative hud-card overflow-hidden">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-400" />
                {searching && (
                  <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-400 animate-spin" />
                )}
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onFocus={() => searchResults.length > 0 && setShowResults(true)}
                  placeholder="Search Ticker (e.g., NVDA, AAPL)..."
                  className="block w-full pl-12 pr-12 py-2.5 bg-transparent text-sm placeholder-slate-500 focus:outline-none text-white"
                />
              </div>
            </form>
            
            {/* Search Results */}
            {showResults && searchResults.length > 0 && (
              <div className="absolute top-full left-4 right-4 mt-2 hud-panel max-h-80 overflow-y-auto z-50">
                {searchResults.map((sym) => (
                  <button
                    key={sym.id}
                    onClick={() => handleSymbolSelect(sym)}
                    className="w-full px-4 py-3 flex items-center justify-between hover:bg-blue-500/10 transition-all border-b border-slate-700/50 last:border-b-0 group"
                  >
                    <div className="text-left">
                      <div className="font-bold text-white group-hover:text-blue-400 transition-colors">{sym.symbol}</div>
                      <div className="text-xs text-slate-400 truncate max-w-xs">{sym.name}</div>
                    </div>
                    <div className="text-right text-xs">
                      <div className="text-slate-500">{sym.sector || 'N/A'}</div>
                      {sym.market_cap && (
                        <div className="text-blue-400 font-mono">
                          ${(sym.market_cap / 1e9).toFixed(1)}B
                        </div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
          
          {/* Right Controls */}
          <div className="flex items-center gap-4">
            {/* Timeframe Selector */}
            <div className="hud-card flex p-1 gap-1">
              {timeframes.map((tf) => (
                <button
                  key={tf}
                  onClick={() => setSelectedTimeframe(tf)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    selectedTimeframe === tf
                      ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/30'
                      : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
                  }`}
                >
                  {tf}
                </button>
              ))}
            </div>
            
            {/* Notification & Help */}
            <div className="flex gap-2">
              <button className="hud-card p-2.5 text-slate-400 hover:text-blue-400 transition-colors relative group">
                <Bell className="w-5 h-5" />
                <span className="absolute top-1 right-1 w-2 h-2 bg-blue-500 rounded-full" />
              </button>
              <button className="hud-card p-2.5 text-slate-400 hover:text-blue-400 transition-colors">
                <HelpCircle className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Click outside to close search */}
      {showResults && (
        <div className="fixed inset-0 z-40" onClick={() => setShowResults(false)} />
      )}

      {/* Fixed Sidebar */}
      <aside className="fixed left-0 top-14 bottom-0 w-56 z-40">
        <div className="absolute inset-0 bg-[#0d1321]/90 backdrop-blur-xl border-r border-blue-500/10" />
        <div className="relative h-full flex flex-col">
          {/* Navigation */}
          <nav className="flex-1 p-4 overflow-y-auto">
            <div className="hud-label mb-4 px-2">Navigation</div>
            <ul className="space-y-1">
              {menuItems.map((item) => {
                const Icon = item.icon
                const isActive = pathname === item.href
                return (
                  <li key={item.id}>
                    <Link
                      href={item.href}
                      className={`relative w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all group ${
                        isActive
                          ? 'bg-gradient-to-r from-blue-500/20 to-cyan-500/10 text-white'
                          : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
                      }`}
                    >
                      {isActive && (
                        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-gradient-to-b from-blue-400 to-cyan-400 rounded-r-full" />
                      )}
                      <Icon className={`w-5 h-5 ${isActive ? 'text-blue-400' : 'group-hover:text-blue-400'} transition-colors`} />
                      <span className="font-medium text-sm">{item.label}</span>
                      {isActive && (
                        <Zap className="w-3 h-3 text-cyan-400 ml-auto" />
                      )}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </nav>

          {/* Status Indicator */}
          <div className="p-4 border-t border-slate-800/50">
            <div className="hud-stat p-3">
              <div className="flex items-center gap-2 mb-2">
                <div className="live-pulse" />
                <span className="text-xs text-green-400 font-bold ml-3">LIVE</span>
              </div>
              <div className="text-[10px] text-slate-500 font-mono">
                Market: Open · NYSE · NASDAQ
              </div>
            </div>
          </div>

          {/* User Profile */}
          <div className="p-4 border-t border-slate-800/50">
            {isAuthenticated && user ? (
              <div className="hud-card p-3 flex items-center gap-3">
                <div className="relative">
                  {user.avatar_url ? (
                    <img src={user.avatar_url} alt={user.username} className="w-10 h-10 rounded-xl object-cover" />
                  ) : (
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center">
                      <span className="text-white text-sm font-bold">
                        {user.username?.slice(0, 2).toUpperCase() || 'U'}
                      </span>
                    </div>
                  )}
                  <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-green-500 rounded-full border-2 border-[#0d1321]" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-white truncate">{user.username || user.full_name}</div>
                  <button 
                    onClick={logout}
                    className="text-xs text-slate-400 hover:text-red-400 flex items-center gap-1 transition-colors"
                  >
                    <LogOut className="w-3 h-3" />
                    Sign Out
                  </button>
                </div>
              </div>
            ) : (
              <Link href="/auth" className="hud-card p-3 flex items-center gap-3 hover:border-blue-500/30 transition-all">
                <div className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center">
                  <LogIn className="w-5 h-5 text-blue-400" />
                </div>
                <div className="flex-1">
                  <div className="text-sm font-bold text-white">Sign In</div>
                  <div className="text-xs text-slate-400">Access all features</div>
                </div>
              </Link>
            )}
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main 
        className="pt-14 min-h-screen transition-all duration-300"
        style={{ 
          marginLeft: sidebarWidth,
          marginRight: copilotWidth 
        }}
      >
        <div className="h-full overflow-y-auto">
          {children}
        </div>
      </main>

      {/* Fixed AI Copilot Panel */}
      <div className="fixed right-0 top-14 bottom-0 z-40">
        <CopilotPanel 
          symbol={symbol || 'NVDA'} 
          context={pageContext}
          isOpen={copilotOpen} 
          onToggle={() => setCopilotOpen(!copilotOpen)} 
        />
      </div>
    </div>
  )
}

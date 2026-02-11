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
  Zap,
  LogIn,
  LogOut,
  Menu,
  ChevronLeft,
  X
} from 'lucide-react'
import ApiStatsMonitor from './ApiStatsMonitor'
import { fetchSymbols, Symbol, syncSymbol, fetchMarketStatus, MarketStatus } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { useQuery } from '@tanstack/react-query'

interface AppLayoutProps {
  children: ReactNode
  symbol?: string
}

// Market Status Indicator Component
function MarketStatusIndicator() {
  const { data: marketStatus, isLoading } = useQuery<MarketStatus>({
    queryKey: ['marketStatus'],
    queryFn: fetchMarketStatus,
    refetchInterval: 60000, // Refresh every minute
  })

  const isOpen = marketStatus?.is_open ?? false
  const statusText = marketStatus?.status ?? 'CLOSED'

  return (
    <div className="p-4 border-t border-slate-800/50">
      <div className="hud-stat p-3">
        <div className="flex items-center gap-2 mb-2">
          <div className={`w-2 h-2 rounded-full ${isOpen ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`} />
          <span className={`text-xs font-bold ml-3 ${isOpen ? 'text-green-400' : 'text-red-400'}`}>
            {isLoading ? 'LOADING...' : statusText}
          </span>
        </div>
        <div className="text-[10px] text-slate-500 font-mono">
          {isLoading ? 'Checking...' : `Market: ${statusText} · NYSE · NASDAQ`}
        </div>
      </div>
    </div>
  )
}

export default function AppLayout({ children, symbol }: AppLayoutProps) {
  const pathname = usePathname()
  const router = useRouter()
  const { user, isAuthenticated, logout, isLoading: authLoading } = useAuth()
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Symbol[]>([])
  const [showResults, setShowResults] = useState(false)
  const [searching, setSearching] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  // Load sidebar state from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('sidebarCollapsed')
    if (saved !== null) {
      setSidebarCollapsed(saved === 'true')
    }
  }, [])

  // Save sidebar state to localStorage
  const toggleSidebar = () => {
    const newState = !sidebarCollapsed
    setSidebarCollapsed(newState)
    localStorage.setItem('sidebarCollapsed', String(newState))
  }

  // Close mobile menu when route changes
  useEffect(() => {
    setMobileMenuOpen(false)
  }, [pathname])

  // Dynamic widths for responsive layout
  const sidebarWidth = sidebarCollapsed ? '5rem' : '14rem'

  const menuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, href: '/' },
    { id: 'markets', label: 'Markets', icon: TrendingUp, href: '/markets' },
    { id: 'watchlist', label: 'Watchlist', icon: Bookmark, href: '/watchlist' },
    { id: 'research', label: 'Research', icon: FileText, href: '/research' },
    { id: 'backtest', label: 'Backtest', icon: Activity, href: '/backtest' },
    { id: 'ideas', label: 'Ideas Lab', icon: Lightbulb, href: '/ideas-lab' },
    { id: 'pricing', label: 'Pricing', icon: Zap, href: '/pricing' },
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

  return (
    <div className="min-h-screen bg-[#0a0e1a]">
      {/* Fixed Header */}
      <header className="fixed top-0 left-0 right-0 h-14 z-50">
        <div className="absolute inset-0 bg-[#0d1321]/90 backdrop-blur-xl border-b border-blue-500/10" />
        <div className="relative h-full flex items-center px-4 md:px-6 gap-2 md:gap-4">
          {/* Mobile Menu Button */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="lg:hidden p-2 rounded-lg hover:bg-slate-800/50 text-slate-400 hover:text-white transition-colors"
            aria-label="Toggle mobile menu"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>

          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 group">
            <div className="w-8 h-8 rounded-xl bg-slate-900/60 border border-cyan-500/20 flex items-center justify-center overflow-hidden">
              <img src="/logo.png" alt="QuantTrade AI" className="w-7 h-7 object-contain" />
            </div>
            <span className="hidden sm:block text-lg font-bold bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
              QuantTrade AI
            </span>
          </Link>

          {/* Desktop Sidebar Toggle */}
          <button
            onClick={toggleSidebar}
            className="hidden lg:flex p-2 rounded-lg hover:bg-slate-800/50 text-slate-400 hover:text-white transition-colors"
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {sidebarCollapsed ? <Menu className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
          </button>

          {/* Search Bar - Hidden on mobile */}
          <div className="flex-1 max-w-xl relative hidden md:block">
            <form onSubmit={handleSearchSubmit} className="relative">
              <div className="hud-card flex items-center gap-2 pr-2">
                <Search className="w-4 h-4 text-blue-400 ml-3" />
                {searching && <Loader2 className="w-4 h-4 text-blue-400 animate-spin absolute right-3" />}
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search symbols, companies..."
                  className="flex-1 bg-transparent border-none outline-none text-sm py-2 text-white placeholder-slate-500"
                />
              </div>

              {/* Search Results Dropdown */}
              {showResults && searchResults.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-2 hud-card max-h-96 overflow-y-auto z-50">
                  {searchResults.slice(0, 10).map((sym) => (
                    <button
                      key={sym.symbol}
                      onClick={() => handleSymbolSelect(sym)}
                      className="w-full flex items-center gap-3 p-3 hover:bg-slate-800/50 transition-colors text-left"
                    >
                      <div className="flex-1">
                        <div className="font-bold text-white">{sym.symbol}</div>
                        <div className="text-xs text-slate-400 truncate">{sym.name}</div>
                      </div>
                      {sym.market_cap && (
                        <div className="text-blue-400 font-mono text-sm">
                          ${(sym.market_cap / 1e9).toFixed(1)}B
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </form>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <button className="hud-button p-2 hidden sm:flex" aria-label="Notifications">
              <Bell className="w-5 h-5" />
            </button>
            <button className="hud-button p-2 hidden sm:flex" aria-label="Help">
              <HelpCircle className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Click outside to close search */}
      {showResults && (
        <div className="fixed inset-0 z-40" onClick={() => setShowResults(false)} />
      )}

      {/* Mobile Menu Overlay */}
      {mobileMenuOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 lg:hidden" 
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Fixed Sidebar */}
      <aside 
        className={`fixed left-0 top-14 bottom-0 z-40 transition-all duration-300 ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        } lg:translate-x-0`}
        style={{ width: sidebarWidth }}
      >
        <div className="absolute inset-0 bg-[#0d1321]/90 backdrop-blur-xl border-r border-blue-500/10" />
        <div className="relative h-full flex flex-col overflow-hidden">
          {/* Navigation */}
          <nav className="flex-1 p-4 overflow-y-auto">
            {!sidebarCollapsed && <div className="hud-label mb-4 px-2">Navigation</div>}
            <ul className="space-y-1">
              {menuItems.map((item) => {
                const Icon = item.icon
                const isActive = pathname === item.href
                return (
                  <li key={item.id}>
                    <Link
                      href={item.href}
                      className={`relative w-full flex items-center ${sidebarCollapsed ? 'justify-center' : 'gap-3'} px-4 py-3 rounded-xl transition-all group ${
                        isActive
                          ? 'bg-gradient-to-r from-blue-500/20 to-cyan-500/10 text-white'
                          : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
                      }`}
                      title={sidebarCollapsed ? item.label : undefined}
                    >
                      {isActive && !sidebarCollapsed && (
                        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-gradient-to-b from-blue-400 to-cyan-400 rounded-r-full" />
                      )}
                      <Icon className={`w-5 h-5 ${isActive ? 'text-blue-400' : 'group-hover:text-blue-400'} transition-colors`} />
                      {!sidebarCollapsed && (
                        <>
                          <span className="font-medium text-sm">{item.label}</span>
                          {isActive && (
                            <Zap className="w-3 h-3 text-cyan-400 ml-auto" />
                          )}
                        </>
                      )}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </nav>

          {/* API Stats Monitor */}
          {!sidebarCollapsed && (
            <div className="p-4 border-t border-slate-800/50">
              <ApiStatsMonitor isInSidebar={true} />
            </div>
          )}

          {/* Status Indicator */}
          {!sidebarCollapsed && <MarketStatusIndicator />}

          {/* User Profile */}
          <div className={`p-4 border-t border-slate-800/50 ${sidebarCollapsed ? 'flex justify-center' : ''}`}>
            {isAuthenticated && user ? (
              <div className={`hud-card p-3 flex items-center ${sidebarCollapsed ? 'justify-center' : 'gap-3'}`}>
                <div className="relative" title={sidebarCollapsed ? (user.username || user.full_name || undefined) : undefined}>
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
                {!sidebarCollapsed && (
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
                )}
              </div>
            ) : (
              <Link href="/auth" className={`hud-card p-3 flex items-center ${sidebarCollapsed ? 'justify-center' : 'gap-3'} hover:border-blue-500/30 transition-all`} title={sidebarCollapsed ? 'Sign In' : undefined}>
                <div className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center">
                  <LogIn className="w-5 h-5 text-blue-400" />
                </div>
                {!sidebarCollapsed && (
                  <div className="flex-1">
                    <div className="text-sm font-bold text-white">Sign In</div>
                    <div className="text-xs text-slate-400">Access all features</div>
                  </div>
                )}
              </Link>
            )}
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main 
        className="pt-14 min-h-screen transition-all duration-300"
        style={{ 
          marginLeft: `calc(${sidebarWidth})`,
          marginRight: 0 
        }}
      >
        <div className="h-full overflow-y-auto px-4 md:px-6 py-4 md:py-6">
          {children}
        </div>
      </main>

    </div>
  )
}

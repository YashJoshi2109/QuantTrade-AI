'use client'

import { useState, useEffect, ReactNode, useMemo, useRef } from 'react'
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
  HelpCircle,
  Loader2,
  Activity,
  Zap,
  LogIn,
  LogOut,
  Menu,
  ChevronLeft,
  X,
  Globe,
  Info,
  Sparkles,
  Swords,
} from 'lucide-react'
import ApiStatsMonitor from './ApiStatsMonitor'
import MarketTicker from './MarketTicker'
import SiteFooter from './SiteFooter'
import PredictionAlertCenter from './PredictionAlertCenter'
import HelpDialog from './HelpDialog'
import { fetchSymbols, Symbol, syncSymbol, fetchMarketStatus, MarketStatus, getSubscriptionStatus } from '@/lib/api'
import { fetchLiveVisitors } from '@/lib/monitor-extended-api'
import { useAuth } from '@/contexts/AuthContext'
import { useQuery } from '@tanstack/react-query'
import LiveVisitorCounter from '@/components/ui/live-visitor'

interface AppLayoutProps {
  children: ReactNode
  symbol?: string
  hideFooter?: boolean
}

function HeaderTooltip({
  label,
  detail,
  children,
}: {
  label: string
  detail: string
  children: ReactNode
}) {
  return (
    <div className="relative group">
      {children}
      <div className="pointer-events-none absolute top-full right-0 mt-2 w-52 rounded-lg border border-slate-700/70 bg-slate-900/95 px-3 py-2 text-[10px] opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all shadow-xl z-50">
        <div className="text-slate-200 font-semibold">{label}</div>
        <div className="text-slate-400 mt-0.5">{detail}</div>
      </div>
    </div>
  )
}

// Market Status Indicator Component
function MarketStatusIndicator({ compact = false }: { compact?: boolean }) {
  const { data: marketStatus, isLoading } = useQuery<MarketStatus>({
    queryKey: ['marketStatus'],
    queryFn: fetchMarketStatus,
    refetchInterval: 60000, // Refresh every minute
  })

  const isOpen = marketStatus?.is_open ?? false
  const statusText = marketStatus?.status ?? 'CLOSED'

  if (compact) {
    return (
      <HeaderTooltip
        label="Market Status"
        detail={isLoading ? 'Checking exchange session.' : `NYSE + NASDAQ session is ${statusText}.`}
      >
        <div
          className={`hidden lg:flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-xs font-mono ${
            isOpen
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : 'bg-slate-800/50 border-slate-700/60 text-slate-300'
          }`}
        >
          <span className={`w-2 h-2 rounded-full ${isOpen ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
          <span className="uppercase tracking-wider text-[10px] text-slate-400">MKT</span>
          <span className={`font-bold ${isOpen ? 'text-emerald-300' : 'text-red-300'}`}>
            {isLoading ? 'LOAD' : statusText}
          </span>
        </div>
      </HeaderTooltip>
    )
  }

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

export default function AppLayout({ children, symbol, hideFooter }: AppLayoutProps) {
  const pathname = usePathname()
  const router = useRouter()
  const { user, isAuthenticated, logout, isLoading: authLoading } = useAuth()
  const [planPro, setPlanPro] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Symbol[]>([])
  const [globalResults, setGlobalResults] = useState<Array<{ symbol: string; name: string; exchange_display: string; country: string }>>([])
  const [showResults, setShowResults] = useState(false)
  const [searching, setSearching] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const headerSearchRef = useRef<HTMLInputElement>(null)

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

  // "/" focuses header search when not typing in an input
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return
      e.preventDefault()
      headerSearchRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Dynamic widths for responsive layout
  const sidebarWidth = sidebarCollapsed ? '5rem' : '14rem'

  const isGameActive = pathname?.startsWith('/game')

  useEffect(() => {
    if (!isAuthenticated || authLoading) {
      setPlanPro(false)
      return
    }
    getSubscriptionStatus()
      .then((s) => setPlanPro(!!s.is_pro))
      .catch(() => setPlanPro(false))
  }, [isAuthenticated, authLoading])

  const { data: liveVisitors } = useQuery({
    queryKey: ['live-visitors'],
    queryFn: fetchLiveVisitors,
    refetchInterval: 30_000,
    staleTime: 25_000,
  })

  const menuItems = useMemo(
    () => [
      { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, href: '/' },
      { id: 'copilot', label: 'AI Copilot', icon: Sparkles, href: '/copilot' },
      { id: 'monitor', label: 'Global Monitor', icon: Globe, href: '/monitor' },
      { id: 'markets', label: 'Markets', icon: TrendingUp, href: '/markets' },
      { id: 'watchlist', label: 'Watchlist', icon: Bookmark, href: '/watchlist' },
      { id: 'research', label: 'Research', icon: FileText, href: '/research' },
      { id: 'backtest', label: 'Backtest', icon: Activity, href: '/backtest' },
      { id: 'ideas', label: 'Ideas Lab', icon: Lightbulb, href: '/ideas-lab' },
      { id: 'game', label: 'CoinRealm', icon: Swords, href: '/game', amber: true },
      {
        id: 'pricing',
        label: 'Pricing',
        icon: Zap,
        href: '/pricing',
        badge: planPro ? 'Pro' : undefined,
      },
      { id: 'settings', label: 'Settings', icon: Settings, href: '/settings' },
    ],
    [planPro]
  )

  useEffect(() => {
    const delayDebounceFn = setTimeout(async () => {
      if (searchQuery.length >= 1) {
        setSearching(true)
        try {
          // Parallel: local DB + global Yahoo Finance search
          const [localResults, globalRes] = await Promise.allSettled([
            fetchSymbols(searchQuery),
            fetch(`/api/search/global?q=${encodeURIComponent(searchQuery)}&limit=12`).then((r) =>
              r.ok ? r.json() : []
            ),
          ])

          const local = localResults.status === 'fulfilled' ? localResults.value : []
          const global = globalRes.status === 'fulfilled' ? (globalRes.value as Array<{ symbol: string; name: string; exchange_display: string; country: string }>) : []

          // Deduplicate global by symbols already in local
          const localSymbols = new Set(local.map((s) => s.symbol.toUpperCase()))
          const filteredGlobal = global.filter((g) => !localSymbols.has(g.symbol.toUpperCase()))

          setSearchResults(local)
          setGlobalResults(filteredGlobal)
          setShowResults(true)
        } catch {
          setSearchResults([])
          setGlobalResults([])
        } finally {
          setSearching(false)
        }
      } else {
        setSearchResults([])
        setGlobalResults([])
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
      {/* Market Ticker Bar */}
      <div className="fixed top-0 left-0 right-0 z-[51] hidden md:block">
        <MarketTicker />
      </div>

      {/* Fixed Header — md:top-11 clears ticker a bit more so the alert bell badge does not crowd API usage chip */}
      <header className="fixed top-0 md:top-11 left-0 right-0 h-14 z-50">
        <div className="absolute inset-0 bg-[#0d1321]/90 backdrop-blur-xl border-b border-blue-500/10" />
        <div className="relative h-full flex items-center px-4 md:px-6 gap-2 md:gap-4 md:pt-1">
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
                  ref={headerSearchRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search symbols, companies… (press /)"
                  className="flex-1 bg-transparent border-none outline-none text-sm py-2 text-white placeholder-slate-500"
                />
              </div>

              {/* Search Results Dropdown */}
              {showResults && (searchResults.length > 0 || globalResults.length > 0) && (
                <div className="absolute top-full left-0 right-0 mt-2 hud-card max-h-96 overflow-y-auto z-50">
                  {/* Local DB results */}
                  {searchResults.length > 0 && (
                    <>
                      <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 border-b border-slate-700/40">
                        Your Database
                      </div>
                      {searchResults.slice(0, 8).map((sym) => (
                        <button
                          key={sym.symbol}
                          onClick={() => handleSymbolSelect(sym)}
                          className="w-full flex items-center gap-3 p-3 hover:bg-slate-800/50 transition-colors text-left"
                        >
                          <div className="flex-1">
                            <div className="font-bold text-white text-sm">{sym.symbol}</div>
                            <div className="text-xs text-slate-400 truncate">{sym.name}</div>
                          </div>
                          {sym.market_cap && (
                            <div className="text-[#007AFF] font-mono text-xs">
                              ${(sym.market_cap / 1e9).toFixed(1)}B
                            </div>
                          )}
                        </button>
                      ))}
                    </>
                  )}
                  {/* Global Yahoo Finance results */}
                  {globalResults.length > 0 && (
                    <>
                      <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 border-y border-slate-700/40">
                        Global Markets · {globalResults.length} results
                      </div>
                      {globalResults.slice(0, 8).map((g) => (
                        <button
                          key={`global-${g.symbol}`}
                          onClick={() => {
                            setShowResults(false)
                            setSearchQuery('')
                            syncSymbol(g.symbol).catch(() => {})
                            router.push(`/research?symbol=${g.symbol}`)
                          }}
                          className="w-full flex items-center gap-3 p-3 hover:bg-slate-800/50 transition-colors text-left"
                        >
                          <div className="flex-1">
                            <div className="font-bold text-white text-sm">{g.symbol}</div>
                            <div className="text-xs text-slate-400 truncate">{g.name}</div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="text-[10px] text-slate-500 font-mono">{g.exchange_display}</div>
                            <div className="text-[9px] text-slate-600">{g.country}</div>
                          </div>
                        </button>
                      ))}
                    </>
                  )}
                </div>
              )}
            </form>
          </div>

          {/* Actions — extra gap before bell so badge does not overlap API chip */}
          <div className="flex items-center gap-2 sm:gap-2.5 shrink-0 md:ml-1">
            <div className="shrink-0 max-w-[min(8rem,28vw)]">
              <ApiStatsMonitor compact={true} />
            </div>
            <MarketStatusIndicator compact={true} />
            <HeaderTooltip
              label="Live visitors"
              detail={
                liveVisitors?.count != null
                  ? `~${liveVisitors.count} active (source: ${liveVisitors.source}). Refreshes about every 30s.`
                  : liveVisitors?.message ||
                    'Backend live count not configured — showing a simulated pulse. Set GA4 or Cloudflare env on the API.'
              }
            >
              <div className="hidden md:flex shrink-0 items-center">
                <LiveVisitorCounter gaCount={liveVisitors?.count ?? null} />
              </div>
            </HeaderTooltip>
            <HeaderTooltip
              label="About QuantTrade"
              detail="Product scope, data sources, and operator details."
            >
              <Link
                href="/about"
                className="hud-button p-2 flex items-center justify-center text-slate-400 hover:text-cyan-300 transition-colors rounded-lg hover:bg-slate-800/60 border border-transparent hover:border-slate-700/50 shrink-0"
                aria-label="About this product"
                title="About"
              >
                <Info className="w-5 h-5" aria-hidden />
              </Link>
            </HeaderTooltip>
            <div className="shrink-0 relative z-[52] pl-0.5">
              <PredictionAlertCenter />
            </div>
            <HeaderTooltip
              label="Help"
              detail="Shortcuts, product info, and data disclaimer."
            >
              <button
                type="button"
                onClick={() => setHelpOpen(true)}
                className="hud-button p-2 hidden sm:flex items-center justify-center text-slate-400 hover:text-cyan-300 hover:bg-slate-800/60 rounded-lg border border-transparent hover:border-slate-700/50 transition-colors"
                aria-label="Help"
                aria-expanded={helpOpen}
                aria-haspopup="dialog"
              >
                <HelpCircle className="w-5 h-5" aria-hidden />
              </button>
            </HeaderTooltip>
          </div>
        </div>
      </header>

      <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />

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
        className={`fixed left-0 top-14 md:top-[6.25rem] bottom-0 z-40 transition-all duration-300 ${
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
                const isActive = item.id === 'game' ? isGameActive : pathname === item.href
                const isAmber = (item as { amber?: boolean }).amber
                return (
                  <li key={item.id}>
                    <Link
                      href={item.href}
                      className={`relative w-full flex items-center ${sidebarCollapsed ? 'justify-center' : 'gap-3'} px-4 py-3 rounded-xl transition-all group ${
                        isAmber
                          ? isActive
                            ? 'bg-amber-500/15 border border-amber-500/30 text-amber-300'
                            : 'text-amber-500/70 hover:text-amber-400 hover:bg-amber-500/10 border border-transparent hover:border-amber-500/20'
                          : isActive
                          ? 'bg-gradient-to-r from-blue-500/20 to-cyan-500/10 text-white'
                          : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
                      }`}
                      title={sidebarCollapsed ? item.label : undefined}
                    >
                      {isActive && !sidebarCollapsed && !isAmber && (
                        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-gradient-to-b from-blue-400 to-cyan-400 rounded-r-full" />
                      )}
                      <Icon className={`w-5 h-5 ${isAmber ? (isActive ? 'text-amber-400' : 'group-hover:text-amber-400') : isActive ? 'text-blue-400' : 'group-hover:text-blue-400'} transition-colors`} />
                      {!sidebarCollapsed && (
                        <>
                          <span className="font-medium text-sm">{item.label}</span>
                          {(item as { badge?: string }).badge && (
                            <span className="ml-auto text-xs px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30 font-bold">
                              {(item as { badge?: string }).badge}
                            </span>
                          )}
                          {isActive && !isAmber && (
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
        className="pt-14 md:pt-[6.25rem] min-h-screen transition-all duration-300"
        style={{ 
          marginLeft: `calc(${sidebarWidth})`,
          marginRight: 0 
        }}
      >
        <div className="h-full overflow-y-auto px-4 md:px-6 py-4 md:py-6">
          {children}
          {!hideFooter && <SiteFooter />}
        </div>
      </main>

    </div>
  )
}

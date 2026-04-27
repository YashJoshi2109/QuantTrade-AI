'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowLeft, TrendingUp, TrendingDown, Activity, RefreshCw,
  ArrowUpRight, ArrowDownRight, BarChart3, Zap, Volume2,
} from 'lucide-react'
import TickerLogo from '@/components/TickerLogo'
import MobileLayout from '@/components/layout/MobileLayout'
import {
  fetchMarketMovers,
  MarketMovers,
  StockPerformance,
} from '@/lib/api'
import { formatNumber, formatPercent, isNumber } from '@/lib/format'

const API = process.env.NEXT_PUBLIC_API_URL || ''

type Tab = 'gainers' | 'losers' | 'active'

function formatVolume(vol: number): string {
  if (!vol || vol <= 0) return '--'
  if (vol >= 1_000_000_000) return `${(vol / 1_000_000_000).toFixed(1)}B`
  if (vol >= 1_000_000) return `${(vol / 1_000_000).toFixed(1)}M`
  if (vol >= 1_000) return `${(vol / 1_000).toFixed(1)}K`
  return vol.toLocaleString()
}

function formatMktCap(cap?: number): string {
  if (!cap || cap <= 0) return '--'
  if (cap >= 1e12) return `$${(cap / 1e12).toFixed(1)}T`
  if (cap >= 1e9) return `$${(cap / 1e9).toFixed(1)}B`
  if (cap >= 1e6) return `$${(cap / 1e6).toFixed(0)}M`
  return `$${cap.toLocaleString()}`
}

function StockRow({ stock, rank, tab }: { stock: StockPerformance; rank: number; tab: Tab }) {
  const pct = stock.change_percent
  const up = isNumber(pct) && pct >= 0

  return (
    <Link
      href={`/research?symbol=${encodeURIComponent(stock.symbol)}`}
      className="flex items-center gap-3 px-4 py-3 active:bg-surface-hover transition-colors border-b border-line-subtle last:border-b-0"
    >
      {/* Rank */}
      <span className="w-6 h-6 rounded-lg bg-white/[0.04] flex items-center justify-center text-[10px] font-bold text-fg-muted shrink-0">
        {rank}
      </span>

      {/* Logo */}
      <TickerLogo symbol={stock.symbol} companyName={stock.name} size={36} />

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="text-[13px] font-bold text-white">{stock.symbol}</p>
          {stock.sector && (
            <span className="px-1.5 py-0.5 rounded text-[8px] font-medium bg-surface-hover text-fg-muted truncate max-w-[80px]">
              {stock.sector}
            </span>
          )}
        </div>
        <p className="text-[10px] text-fg-muted truncate">{stock.name || '--'}</p>
        <div className="flex items-center gap-3 mt-0.5">
          <span className="text-[9px] text-fg-muted">Vol: {formatVolume(stock.volume)}</span>
          {stock.market_cap && <span className="text-[9px] text-fg-muted">Cap: {formatMktCap(stock.market_cap)}</span>}
        </div>
      </div>

      {/* Price + Change */}
      <div className="text-right shrink-0">
        <p className="text-[13px] font-mono font-semibold text-white">
          ${isNumber(stock.price) ? formatNumber(stock.price, 2) : '--'}
        </p>
        <div className={`flex items-center justify-end gap-0.5 mt-0.5 ${up ? 'text-emerald-400' : 'text-red-400'}`}>
          {up ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
          <span className="text-[11px] font-mono font-bold">
            {up ? '+' : ''}{formatPercent(pct, 2)}
          </span>
        </div>
        {tab === 'active' && (
          <p className="text-[9px] text-cyan-400/60 font-mono mt-0.5">{formatVolume(stock.volume)}</p>
        )}
      </div>
    </Link>
  )
}

function MobileMoversPage() {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<Tab>('gainers')

  const { data: movers, isLoading, refetch } = useQuery<MarketMovers>({
    queryKey: ['marketMovers'],
    queryFn: () => fetchMarketMovers(),
    refetchInterval: 120000,
    staleTime: 60000,
  })

  // Sort by volume for "active" tab
  const activeByVolume = useMemo(() => {
    if (!movers) return []
    const all = [...(movers.gainers || []), ...(movers.losers || [])]
    const seen = new Set<string>()
    return all
      .filter(s => { const k = s.symbol; if (seen.has(k)) return false; seen.add(k); return true })
      .sort((a, b) => (b.volume || 0) - (a.volume || 0))
      .slice(0, 30)
  }, [movers])

  const gainers = (movers?.gainers || []).slice(0, 30)
  const losers = (movers?.losers || []).slice(0, 30)

  const stocks = activeTab === 'gainers' ? gainers : activeTab === 'losers' ? losers : activeByVolume

  const tabs: { id: Tab; label: string; Icon: typeof TrendingUp; count: number; color: string }[] = [
    { id: 'gainers', label: 'Gainers', Icon: TrendingUp, count: gainers.length, color: 'emerald' },
    { id: 'losers', label: 'Losers', Icon: TrendingDown, count: losers.length, color: 'red' },
    { id: 'active', label: 'Most Active', Icon: Zap, count: activeByVolume.length, color: 'cyan' },
  ]

  return (
    <MobileLayout>
      <div className="min-h-screen pb-4">
        {/* ── Glass Header ── */}
        <header className="sticky top-0 z-30 pt-safe">
          <div
            className="mx-3 mt-2 rounded-2xl border border-line-subtle px-4 py-3"
            style={{
              background: 'linear-gradient(135deg, rgba(10,14,26,0.92) 0%, rgba(26,35,50,0.88) 100%)',
              backdropFilter: 'blur(20px) saturate(1.6)',
              WebkitBackdropFilter: 'blur(20px) saturate(1.6)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.06)',
            }}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => router.back()}
                  className="w-8 h-8 rounded-xl bg-surface-hover border border-line-subtle flex items-center justify-center text-fg-secondary active:scale-90 transition-transform"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <div>
                  <h1 className="text-[15px] font-bold text-white">Market Movers</h1>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                    </span>
                    <p className="text-[10px] text-fg-muted">Real-time data</p>
                  </div>
                </div>
              </div>
              <button
                onClick={() => refetch()}
                className="w-8 h-8 rounded-xl bg-surface-hover border border-line-subtle flex items-center justify-center text-fg-muted active:scale-90"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-cyan-400' : ''}`} />
              </button>
            </div>
          </div>
        </header>

        {/* ── Tab Bar ── */}
        <div className="px-4 mt-3 mb-2">
          <div
            className="flex gap-1.5 p-1.5 rounded-2xl border border-line-subtle"
            style={{
              background: 'linear-gradient(135deg, rgba(10,14,26,0.8) 0%, rgba(15,20,30,0.8) 100%)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
            }}
          >
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`relative flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-[11px] font-semibold transition-all active:scale-[0.97] ${
                  activeTab === tab.id
                    ? `text-${tab.color}-300`
                    : 'text-fg-muted'
                }`}
              >
                {activeTab === tab.id && (
                  <motion.div
                    layoutId="mover-tab-bg"
                    className={`absolute inset-0 rounded-xl border ${
                      tab.color === 'emerald' ? 'bg-emerald-500/10 border-emerald-500/20' :
                      tab.color === 'red' ? 'bg-red-500/10 border-red-500/20' :
                      'bg-cyan-500/10 border-cyan-500/20'
                    }`}
                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                  />
                )}
                <tab.Icon className="w-3.5 h-3.5 relative z-10" />
                <span className="relative z-10">{tab.label}</span>
                <span className={`relative z-10 text-[9px] px-1 py-0.5 rounded-full ${
                  activeTab === tab.id ? 'bg-surface-overlay' : 'bg-surface-hover'
                }`}>
                  {tab.count}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* ── Summary Stats ── */}
        <div className="px-4 mb-3">
          <div
            className="grid grid-cols-3 gap-2"
          >
            {activeTab === 'gainers' && gainers.length > 0 && (
              <>
                <GlassStat label="Best" value={`+${formatPercent(gainers[0]?.change_percent, 1)}`} sub={gainers[0]?.symbol} color="emerald" />
                <GlassStat label="Avg Change" value={`+${formatPercent(gainers.reduce((s,g) => s + g.change_percent, 0) / Math.max(1, gainers.length), 1)}`} sub={`${gainers.length} stocks`} color="emerald" />
                <GlassStat label="Top Volume" value={formatVolume(Math.max(...gainers.map(g => g.volume || 0)))} sub="shares" color="slate" />
              </>
            )}
            {activeTab === 'losers' && losers.length > 0 && (
              <>
                <GlassStat label="Worst" value={formatPercent(losers[0]?.change_percent, 1)} sub={losers[0]?.symbol} color="red" />
                <GlassStat label="Avg Change" value={formatPercent(losers.reduce((s,l) => s + l.change_percent, 0) / Math.max(1, losers.length), 1)} sub={`${losers.length} stocks`} color="red" />
                <GlassStat label="Top Volume" value={formatVolume(Math.max(...losers.map(l => l.volume || 0)))} sub="shares" color="slate" />
              </>
            )}
            {activeTab === 'active' && activeByVolume.length > 0 && (
              <>
                <GlassStat label="#1 Volume" value={formatVolume(activeByVolume[0]?.volume)} sub={activeByVolume[0]?.symbol} color="cyan" />
                <GlassStat label="Total Vol" value={formatVolume(activeByVolume.reduce((s,a) => s + (a.volume || 0), 0))} sub={`${activeByVolume.length} stocks`} color="cyan" />
                <GlassStat label="Avg Price" value={`$${formatNumber(activeByVolume.reduce((s,a) => s + a.price, 0) / Math.max(1, activeByVolume.length), 0)}`} sub="per share" color="slate" />
              </>
            )}
          </div>
        </div>

        {/* ── Stock List ── */}
        <div className="mx-4">
          <div
            className="rounded-2xl border border-line-subtle overflow-hidden"
            style={{
              background: 'linear-gradient(180deg, rgba(26,35,50,0.6) 0%, rgba(10,14,26,0.8) 100%)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
            }}
          >
            {/* Column headers */}
            <div className="flex items-center gap-3 px-4 py-2 border-b border-line-subtle text-[9px] text-fg-muted uppercase tracking-wider font-semibold">
              <span className="w-6 text-center">#</span>
              <span className="w-9" />
              <span className="flex-1">Stock</span>
              <span className="text-right w-20">Price</span>
            </div>

            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.15 }}
              >
                {isLoading ? (
                  <div className="space-y-0">
                    {Array.from({ length: 10 }).map((_, i) => (
                      <div key={i} className="flex items-center gap-3 px-4 py-3 border-b border-line-subtle">
                        <div className="w-6 h-6 rounded-lg bg-surface-overlay animate-pulse" />
                        <div className="w-9 h-9 rounded-full bg-surface-overlay animate-pulse" />
                        <div className="flex-1 space-y-1.5">
                          <div className="h-3 w-16 rounded bg-surface-overlay animate-pulse" />
                          <div className="h-2 w-24 rounded bg-surface-overlay animate-pulse" />
                        </div>
                        <div className="w-16 h-8 rounded bg-surface-overlay animate-pulse" />
                      </div>
                    ))}
                  </div>
                ) : stocks.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <BarChart3 className="w-10 h-10 text-fg-muted mb-3" />
                    <p className="text-sm text-fg-secondary">No data available</p>
                    <p className="text-[11px] text-fg-muted mt-1">Market data may be loading</p>
                  </div>
                ) : (
                  stocks.map((stock, i) => (
                    <StockRow key={stock.symbol} stock={stock} rank={i + 1} tab={activeTab} />
                  ))
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </MobileLayout>
  )
}

function GlassStat({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  const colorMap: Record<string, string> = {
    emerald: 'text-emerald-400',
    red: 'text-red-400',
    cyan: 'text-cyan-400',
    slate: 'text-fg-primary',
  }
  return (
    <div
      className="rounded-xl border border-line-subtle p-2.5 text-center"
      style={{
        background: 'linear-gradient(135deg, rgba(26,35,50,0.5) 0%, rgba(10,14,26,0.6) 100%)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
      }}
    >
      <p className="text-[9px] text-fg-muted uppercase tracking-wider">{label}</p>
      <p className={`text-sm font-bold font-mono mt-0.5 ${colorMap[color] || 'text-white'}`}>{value}</p>
      <p className="text-[9px] text-fg-muted mt-0.5">{sub}</p>
    </div>
  )
}

// ── Page export with desktop fallback ──
export default function MoversPage() {
  return (
    <>
      <div className="hidden md:block">
        <div className="flex items-center justify-center min-h-screen bg-surface-base">
          <div className="text-center">
            <p className="text-fg-secondary">Use the Markets page for desktop view</p>
            <Link href="/markets" className="text-cyan-400 text-sm mt-2 block hover:underline">← Back to Markets</Link>
          </div>
        </div>
      </div>
      <div className="md:hidden">
        <MobileMoversPage />
      </div>
    </>
  )
}

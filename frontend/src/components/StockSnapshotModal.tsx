'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X, TrendingUp, TrendingDown, Star, StarOff, BarChart2, LineChart,
  Activity, Zap, ExternalLink, RefreshCw, BookmarkPlus, Bell,
  ChevronDown, ChevronUp, ArrowUpRight, ArrowDownRight, Info,
} from 'lucide-react'
import Link from 'next/link'

// ── Types ─────────────────────────────────────────────────────────────────────
export interface SnapshotStock {
  symbol: string
  name?: string
  price?: number
  change?: number
  change_percent?: number
  exchange?: string
  currency?: string
  market_cap?: number
  pe_ratio?: number
  volume?: number
  avg_volume?: number
  week_52_high?: number
  week_52_low?: number
  country?: string
  flag?: string
}

interface Props {
  stock: SnapshotStock | null
  onClose: () => void
  onAddToWatchlist?: (symbol: string) => void
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(n: number | undefined, digits = 2, prefix = '$') {
  if (n == null || !Number.isFinite(n)) return '—'
  if (n >= 1e12) return `${prefix}${(n / 1e12).toFixed(2)}T`
  if (n >= 1e9)  return `${prefix}${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6)  return `${prefix}${(n / 1e6).toFixed(2)}M`
  return `${prefix}${n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`
}
function fmtVol(n: number | undefined) {
  if (n == null || !Number.isFinite(n)) return '—'
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return String(n)
}

// ── Sparkline canvas (renders real close-price array or falls back to flat) ───
function SparklineCanvas({ positive, prices }: { positive: boolean; prices: number[] }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const W = canvas.offsetWidth * devicePixelRatio
    const H = canvas.offsetHeight * devicePixelRatio
    canvas.width = W; canvas.height = H; ctx.scale(devicePixelRatio, devicePixelRatio)
    const w = canvas.offsetWidth, h = canvas.offsetHeight

    const raw = prices.length >= 2 ? prices : [1, 1]
    const min = Math.min(...raw)
    const max = Math.max(...raw)
    const range = max - min || 1
    const pts: [number, number][] = raw.map((v, i) => [
      i * (w / (raw.length - 1)),
      h * 0.1 + (1 - (v - min) / range) * h * 0.8,
    ])

    const color = positive ? '#34d399' : '#f87171'
    const gradColor = positive ? 'rgba(52,211,153,' : 'rgba(248,113,113,'

    ctx.clearRect(0, 0, w, h)
    const grad = ctx.createLinearGradient(0, 0, 0, h)
    grad.addColorStop(0, gradColor + '0.25)')
    grad.addColorStop(1, gradColor + '0)')
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.moveTo(pts[0][0], h)
    pts.forEach(([x, y]) => ctx.lineTo(x, y))
    ctx.lineTo(pts[pts.length - 1][0], h)
    ctx.closePath(); ctx.fill()

    ctx.beginPath()
    pts.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y))
    ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.lineJoin = 'round'; ctx.stroke()
  }, [positive, prices])

  return <canvas ref={ref} className="w-full h-full" />
}

// ── Chart tab → Yahoo Finance range/interval ───────────────────────────────────
function chartRangeParam(tab: ChartTab): string {
  switch (tab) {
    case '1D': return '1d'
    case '5D': return '5d'
    case '1M': return '1mo'
    case '3M': return '3mo'
    case '1Y': return '1y'
  }
}

// ── Quick Stat Row ─────────────────────────────────────────────────────────────
function StatRow({ label, value, highlight }: { label: string; value: string; highlight?: 'green' | 'red' | 'blue' }) {
  const cls = highlight === 'green' ? 'text-emerald-400' : highlight === 'red' ? 'text-red-400' : highlight === 'blue' ? 'text-cyan-400' : 'text-slate-100'
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-white/[0.05] last:border-0">
      <span className="text-[11px] text-slate-500 font-medium">{label}</span>
      <span className={`text-[12px] font-bold font-mono tabular-nums ${cls}`}>{value}</span>
    </div>
  )
}

// ── Chart Tab ─────────────────────────────────────────────────────────────────
type ChartTab = '1D' | '5D' | '1M' | '3M' | '1Y'
const CHART_TABS: ChartTab[] = ['1D', '5D', '1M', '3M', '1Y']

// ── Main Modal ────────────────────────────────────────────────────────────────
export default function StockSnapshotModal({ stock, onClose, onAddToWatchlist }: Props) {
  const [chartTab, setChartTab] = useState<ChartTab>('1D')
  const [chartType, setChartType] = useState<'line' | 'candle'>('line')
  const [inWatchlist, setInWatchlist] = useState(false)
  const [alertSet, setAlertSet] = useState(false)

  // Live quote + candle data
  const [liveStock, setLiveStock] = useState<SnapshotStock | null>(null)
  const [sparkPrices, setSparkPrices] = useState<number[]>([])
  const [dataLoading, setDataLoading] = useState(false)

  // Merge prop with live quote (live takes precedence when available)
  const s = liveStock ?? stock
  const up = (s?.change_percent ?? 0) >= 0
  const neon = up ? '#34d399' : '#f87171'
  const neonBg = up ? 'rgba(52,211,153,' : 'rgba(248,113,113,'

  // Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  // Fetch live quote + basic-financials whenever modal opens on a new symbol
  useEffect(() => {
    if (!stock?.symbol) return
    setLiveStock(null)
    setSparkPrices([])
    let cancelled = false

    async function fetchLiveData() {
      setDataLoading(true)
      try {
        // Parallel: Finnhub quote (price) + basic-financials (52W, market cap, P/E)
        const [quoteRes, metricsRes] = await Promise.allSettled([
          fetch(`/api/finnhub?type=quote&symbol=${encodeURIComponent(stock!.symbol)}`),
          fetch(`/api/finnhub?type=basic-financials&symbol=${encodeURIComponent(stock!.symbol)}`),
        ])

        if (cancelled) return

        let livePrice: number | undefined
        let liveChange: number | undefined
        let liveChangePct: number | undefined
        let liveVolume: number | undefined

        if (quoteRes.status === 'fulfilled' && quoteRes.value.ok) {
          const q = await quoteRes.value.json()
          // Finnhub quote: c=current, d=change, dp=change%, v=volume
          if (q?.c) {
            livePrice = q.c
            liveChange = q.d
            liveChangePct = q.dp
            liveVolume = q.v
          }
        }

        let metricPatch: Partial<SnapshotStock> = {}
        if (metricsRes.status === 'fulfilled' && metricsRes.value.ok) {
          const m = await metricsRes.value.json()
          const mt = m?.metric ?? {}
          // Finnhub basic-financials metric keys:
          // 52WeekHigh, 52WeekLow, marketCapitalization (in millions),
          // peBasicExclExtraItemsTTM, 10DayAverageTradingVolume (in millions shares)
          metricPatch = {
            week_52_high: mt['52WeekHigh'] ? Number(mt['52WeekHigh']) : undefined,
            week_52_low: mt['52WeekLow'] ? Number(mt['52WeekLow']) : undefined,
            market_cap: mt['marketCapitalization'] ? Number(mt['marketCapitalization']) * 1e6 : undefined,
            pe_ratio: mt['peBasicExclExtraItemsTTM'] ? Number(mt['peBasicExclExtraItemsTTM']) : (mt['peTTM'] ? Number(mt['peTTM']) : undefined),
            avg_volume: mt['10DayAverageTradingVolume'] ? Number(mt['10DayAverageTradingVolume']) * 1e6 : undefined,
          }
        }

        setLiveStock({
          ...(stock as SnapshotStock),
          ...metricPatch,
          ...(livePrice ? {
            price: livePrice,
            change: liveChange,
            change_percent: liveChangePct,
            volume: liveVolume,
          } : {}),
        })
      } catch { /* non-fatal */ } finally {
        if (!cancelled) setDataLoading(false)
      }
    }
    fetchLiveData()
    return () => { cancelled = true }
  }, [stock?.symbol])

  // Fetch chart data whenever symbol or chart tab changes (Yahoo Finance)
  useEffect(() => {
    if (!stock?.symbol) return
    let cancelled = false
    const range = chartRangeParam(chartTab)

    async function fetchChart() {
      try {
        const res = await fetch(
          `/api/quotes/chart?symbol=${encodeURIComponent(stock!.symbol)}&range=${range}`
        )
        if (!res.ok || cancelled) return
        const data = await res.json()
        if (Array.isArray(data.closes) && data.closes.length > 1) {
          setSparkPrices(data.closes.filter((v: number) => v > 0))
        }
      } catch { /* non-fatal */ }
    }
    fetchChart()
    return () => { cancelled = true }
  }, [stock?.symbol, chartTab])

  const handleWatchlist = useCallback(() => {
    setInWatchlist(v => !v)
    if (stock) onAddToWatchlist?.(stock.symbol)
  }, [stock, onAddToWatchlist])

  if (!stock) return null

  const aiSignal = up ? 'Bullish' : (s?.change_percent ?? 0) < -2 ? 'Bearish' : 'Neutral'
  const aiColor = aiSignal === 'Bullish' ? 'text-emerald-400' : aiSignal === 'Bearish' ? 'text-red-400' : 'text-amber-400'

  return (
    <AnimatePresence>
      {stock && (
        <>
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[999] cursor-pointer"
            style={{ backdropFilter: 'blur(18px) saturate(1.6)', background: 'rgba(2,6,23,0.75)' }}
            onClick={onClose}
          />

          {/* Modal */}
          <motion.div
            key="modal"
            initial={{ opacity: 0, scale: 0.93, y: 32 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.93, y: 32 }}
            transition={{ type: 'spring', stiffness: 340, damping: 28 }}
            className="fixed inset-0 z-[1000] flex items-center justify-center p-4"
            style={{ pointerEvents: 'none' }}
          >
            <div
              className="relative w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col"
              style={{
                pointerEvents: 'auto',
                background: 'linear-gradient(145deg, rgba(12,18,40,0.98) 0%, rgba(6,10,28,0.98) 100%)',
                border: '1px solid rgba(255,255,255,0.10)',
                borderTop: '1px solid rgba(255,255,255,0.16)',
                borderRadius: 24,
                boxShadow: [
                  'inset 0 1px 0 rgba(255,255,255,0.10)',
                  'inset 1px 0 0 rgba(255,255,255,0.05)',
                  `0 0 0 1px ${neonBg}0.12)`,
                  `0 24px 80px rgba(0,0,0,0.7)`,
                  `0 8px 32px rgba(0,0,0,0.5)`,
                ].join(', '),
              }}
            >
              {/* Neon top accent */}
              <div className="absolute inset-x-0 top-0 h-[2px] rounded-t-3xl" style={{ background: `linear-gradient(90deg, transparent, ${neon}, transparent)` }} />

              {/* ── HEADER ──────────────────────────────────────────────────── */}
              <div className="px-5 pt-5 pb-4 border-b border-white/[0.07] shrink-0">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    {/* Company row */}
                    <div className="flex items-center gap-3 mb-1.5">
                      {stock.flag && (
                        <span className="text-2xl leading-none">{stock.flag}</span>
                      )}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h2 className="text-lg font-black text-white tracking-tight truncate">{stock.name || stock.symbol}</h2>
                          <span className="text-slate-500 font-mono text-sm font-bold">({stock.symbol})</span>
                          {stock.exchange && (
                            <span className="px-1.5 py-0.5 rounded-md bg-slate-800/80 border border-slate-700/50 text-[9px] font-bold text-slate-400 font-mono uppercase tracking-wide">
                              {stock.exchange}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Price row */}
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="text-3xl font-black font-mono tabular-nums text-white">
                        {s?.currency === 'JPY' ? '¥' : s?.currency === 'EUR' ? '€' : s?.currency === 'GBP' ? '£' : '$'}
                        {(s?.price ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                      {dataLoading && <RefreshCw className="w-3.5 h-3.5 text-slate-600 animate-spin" />}
                      <div className="flex items-center gap-1.5">
                        <div className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold"
                          style={{ background: neonBg + '0.12)', border: `1px solid ${neonBg}0.4)`, color: neon }}>
                          {up ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                          {up ? '+' : ''}{(s?.change ?? 0).toFixed(2)} ({up ? '+' : ''}{(s?.change_percent ?? 0).toFixed(2)}%)
                        </div>
                      </div>
                    </div>

                    {/* AI signal strip */}
                    <div className="flex items-center gap-3 mt-2 text-[10px] font-bold">
                      <span className="flex items-center gap-1">
                        <Zap className="w-3 h-3 text-amber-400" />
                        <span className="text-slate-500">AI Signal:</span>
                        <span className={aiColor}>{aiSignal}</span>
                      </span>
                      <span className="text-slate-700">·</span>
                      <span className="text-slate-500">Market Open</span>
                      <span className="text-slate-700">·</span>
                      <span className="text-slate-500">
                        {dataLoading ? 'Updating…' : `Live · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
                      </span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 shrink-0">
                    <motion.button
                      whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.92 }}
                      onClick={handleWatchlist}
                      className="mac-btn mac-btn-icon"
                      title={inWatchlist ? 'Remove from watchlist' : 'Add to watchlist'}
                    >
                      {inWatchlist ? <Star className="w-4 h-4 text-amber-400" fill="#fbbf24" /> : <StarOff className="w-4 h-4" />}
                    </motion.button>
                    <motion.button
                      whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.92 }}
                      onClick={() => setAlertSet(v => !v)}
                      className={`mac-btn mac-btn-icon ${alertSet ? 'mac-btn-active' : ''}`}
                      title="Set alert"
                    >
                      <Bell className="w-4 h-4" />
                    </motion.button>
                    <motion.button
                      whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.92 }}
                      onClick={onClose}
                      className="mac-btn mac-btn-icon"
                    >
                      <X className="w-4 h-4" />
                    </motion.button>
                  </div>
                </div>
              </div>

              {/* ── BODY ────────────────────────────────────────────────────── */}
              <div className="flex flex-col md:flex-row flex-1 overflow-y-auto md:overflow-hidden">

                {/* LEFT: Chart */}
                <div className="flex-1 min-w-0 flex flex-col min-h-[300px] md:min-h-0 border-b md:border-b-0 md:border-r border-white/[0.06]">

                  {/* Chart toolbar */}
                  <div className="flex items-center justify-between gap-3 px-4 py-2 border-b border-white/[0.05] shrink-0 overflow-x-auto mac-scrollbar">
                    {/* Time tabs (Segmented Style) */}
                    <div className="flex items-center bg-[#060A16]/60 p-1 rounded-xl border border-white/[0.04] shadow-inner shrink-0">
                      {CHART_TABS.map(tab => (
                        <button key={tab} onClick={() => setChartTab(tab)}
                          className={`relative flex items-center justify-center min-w-[34px] px-2 h-7 rounded-lg text-[10px] font-mono font-black transition-all ${
                            chartTab === tab 
                              ? 'bg-gradient-to-b from-[#1E293B] to-[#0F172A] text-white shadow-[0_1px_3px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.1)] border border-white/[0.08]' 
                              : 'text-slate-500 hover:text-slate-300 border border-transparent'
                          }`}>
                          {chartTab === tab && (
                            <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-[#00D4FF] to-transparent opacity-80" />
                          )}
                          {tab}
                        </button>
                      ))}
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      {/* Chart type (Segmented Style) */}
                      <div className="flex items-center bg-[#060A16]/60 p-1 rounded-xl border border-white/[0.04] shadow-inner">
                        <button onClick={() => setChartType('line')}
                          className={`relative flex items-center justify-center w-[34px] h-7 rounded-lg transition-all ${
                            chartType === 'line' 
                               ? 'bg-gradient-to-b from-[#1E293B] to-[#0F172A] text-[#00D4FF] shadow-[0_1px_3px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.1)] border border-white/[0.08]' 
                              : 'text-slate-500 hover:text-slate-300 border border-transparent'
                          }`}>
                          {chartType === 'line' && <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-[#00D4FF] to-transparent opacity-80" />}
                          <LineChart className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => setChartType('candle')}
                          className={`relative flex items-center justify-center w-[34px] h-7 rounded-lg transition-all ${
                            chartType === 'candle' 
                               ? 'bg-gradient-to-b from-[#1E293B] to-[#0F172A] text-[#00D4FF] shadow-[0_1px_3px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.1)] border border-white/[0.08]' 
                              : 'text-slate-500 hover:text-slate-300 border border-transparent'
                          }`}>
                          {chartType === 'candle' && <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-[#00D4FF] to-transparent opacity-80" />}
                          <BarChart2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {/* Open in Research */}
                      <Link href={`/research?symbol=${stock.symbol}`}
                        className="flex items-center justify-center w-8 h-8 rounded-xl bg-gradient-to-b from-slate-800 to-slate-900 border border-white/[0.08] text-slate-300 hover:text-[#00D4FF] hover:border-[#00D4FF]/30 transition-all shadow-[0_2px_8px_rgba(0,0,0,0.3)]" 
                        title="Open in Research">
                        <ExternalLink className="w-3.5 h-3.5" />
                      </Link>
                    </div>
                  </div>

                  {/* Chart area */}
                  <div className="flex-1 relative p-4 min-h-0">
                    <div className="h-full w-full rounded-2xl overflow-hidden relative"
                      style={{ background: 'rgba(4,8,20,0.6)', border: '1px solid rgba(255,255,255,0.05)' }}>
                      <SparklineCanvas positive={up} prices={sparkPrices} />

                      {/* Price labels */}
                      <div className="absolute top-3 left-3 text-[10px] font-mono text-slate-600 font-bold">
                        {s?.week_52_high ? fmt(s.week_52_high) : '52W High'}
                      </div>
                      <div className="absolute bottom-3 left-3 text-[10px] font-mono text-slate-600 font-bold">
                        {s?.week_52_low ? fmt(s.week_52_low) : '52W Low'}
                      </div>
                      <div className="absolute top-3 right-3 text-[10px] font-mono font-bold" style={{ color: neon }}>
                        {CHART_TABS.indexOf(chartTab) > 0 ? 'Historical View' : 'Live · 1D'}
                      </div>

                      {/* Current price line */}
                      <div className="absolute left-0 right-0" style={{ bottom: `${up ? 22 : 78}%`, borderTop: `1px dashed ${neon}40` }}>
                        <span className="absolute right-1 -top-2.5 text-[9px] font-mono font-bold" style={{ color: neon }}>
                          {fmt(s?.price)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Volume bar */}
                  <div className="px-4 pb-3 shrink-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[9px] text-slate-600 font-mono uppercase tracking-widest">Volume</span>
                      <span className="text-[10px] text-slate-400 font-mono font-bold">{fmtVol(s?.volume)}</span>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                      <motion.div className="h-full rounded-full"
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.min(100, ((s?.volume ?? 1) / (s?.avg_volume ?? 1)) * 60)}%` }}
                        transition={{ duration: 0.8, ease: 'easeOut' }}
                        style={{ background: neon }}
                      />
                    </div>
                    <div className="text-[9px] text-slate-600 mt-0.5 font-mono">Avg: {fmtVol(s?.avg_volume)}</div>
                  </div>
                </div>

                {/* RIGHT: Quick Stats */}
                <div className="w-full md:w-52 shrink-0 flex flex-col">
                  <div className="px-4 py-3 border-b border-white/[0.05] shrink-0">
                    <span className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-600">Quick Stats</span>
                  </div>
                  <div className="flex-1 overflow-y-auto px-4 py-1 mac-scrollbar">
                    <StatRow label="Market Cap"  value={fmt(s?.market_cap, 2, '')} />
                    <StatRow label="P/E Ratio"   value={s?.pe_ratio?.toFixed(2) ?? '—'} />
                    <StatRow label="Volume"      value={fmtVol(s?.volume)} highlight="blue" />
                    <StatRow label="Avg Volume"  value={fmtVol(s?.avg_volume)} />
                    <StatRow label="52W High"    value={fmt(s?.week_52_high)} highlight="green" />
                    <StatRow label="52W Low"     value={fmt(s?.week_52_low)}  highlight="red" />
                    <StatRow label="Currency"    value={s?.currency ?? 'USD'} />
                    <StatRow label="Exchange"    value={s?.exchange ?? '—'} />

                    {/* 52W Range bar */}
                    {s?.week_52_high && s?.week_52_low && s?.price && (
                      <div className="mt-3">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[9px] text-slate-600 font-mono">52W Range</span>
                          <span className="text-[9px] text-slate-400 font-mono font-bold">
                            {Math.round(((s.price - s.week_52_low!) / (s.week_52_high! - s.week_52_low!)) * 100)}%
                          </span>
                        </div>
                        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                          <motion.div className="h-full rounded-full"
                            initial={{ width: 0 }}
                            animate={{ width: `${Math.min(100, Math.max(0, ((s.price - s.week_52_low!) / (s.week_52_high! - s.week_52_low!)) * 100))}%` }}
                            transition={{ duration: 0.9, ease: 'easeOut', delay: 0.2 }}
                            style={{ background: 'linear-gradient(90deg, #34d399, #fbbf24, #f87171)' }}
                          />
                        </div>
                        <div className="flex justify-between mt-1">
                          <span className="text-[8px] font-mono text-red-400">{fmt(s.week_52_low)}</span>
                          <span className="text-[8px] font-mono text-emerald-400">{fmt(s.week_52_high)}</span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* CTA */}
                  <div className="p-4 border-t border-white/[0.05] shrink-0 space-y-2">
                    <Link href={`/research?symbol=${stock.symbol}`}
                      className="mac-btn mac-btn-lg w-full flex items-center justify-center gap-2 text-[11px]"
                      style={{ background: 'linear-gradient(135deg, rgba(0,122,255,0.3), rgba(0,212,255,0.2))', borderColor: 'rgba(0,122,255,0.5)', color: '#60b0ff' }}
                      onClick={onClose}>
                      <ExternalLink className="w-3.5 h-3.5" />
                      Full Analysis
                    </Link>
                    <button onClick={handleWatchlist}
                      className={`mac-btn w-full text-[11px] ${inWatchlist ? 'mac-btn-active' : ''}`}>
                      <BookmarkPlus className="w-3.5 h-3.5" />
                      {inWatchlist ? 'In Watchlist' : 'Add to Watchlist'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

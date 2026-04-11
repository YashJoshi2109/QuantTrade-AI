'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Player } from '@remotion/player'
import { Activity, Radio } from 'lucide-react'
import {
  AuthTickerSpark,
  AUTH_TICKER_SPARK_DURATION,
  AUTH_TICKER_SPARK_FPS,
} from '@/remotion/AuthTickerSpark'

const SYMBOL = 'NVDA'
const TICKER_POLL_MS = 45_000
const CHART_POLL_MS = 60_000

type ChartRange = '1d' | '5d'

interface TickerPayload {
  price: number
  change: number
  change_percent: number
  currency?: string
  volume?: number
  avg_volume?: number
  regularMarketPrice?: number
}

interface ChartPayload {
  closes: number[]
  regularMarketPrice?: number
  previousClose?: number
}

function isValidChartPayload(d: unknown): d is ChartPayload {
  if (!d || typeof d !== 'object') return false
  const c = (d as ChartPayload).closes
  return Array.isArray(c) && c.length >= 2
}

function formatPrice(n: number, currency = 'USD') {
  const sym = currency === 'USD' ? '$' : ''
  return `${sym}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatVol(n: number | undefined) {
  if (n == null || !Number.isFinite(n) || n <= 0) return '—'
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return String(Math.round(n))
}

export function AuthLiveTickerCard() {
  const [range, setRange] = useState<ChartRange>('1d')
  const [ticker, setTicker] = useState<TickerPayload | null>(null)
  const [chart, setChart] = useState<ChartPayload | null>(null)
  const [tick, setTick] = useState(0)

  const loadTicker = useCallback(async () => {
    try {
      const res = await fetch(`/api/quotes/ticker?symbol=${SYMBOL}`, { cache: 'no-store' })
      if (!res.ok) return
      const data = (await res.json()) as TickerPayload
      if (data?.price > 0) setTicker(data)
    } catch {
      /* keep last */
    }
  }, [])

  const loadChart = useCallback(async (r: ChartRange) => {
    try {
      const res = await fetch(`/api/quotes/chart?symbol=${SYMBOL}&range=${r}`, { cache: 'no-store' })
      if (!res.ok) return
      const data: unknown = await res.json()
      if (isValidChartPayload(data)) {
        setChart(data)
        setTick((x) => x + 1)
      }
    } catch {
      /* keep last */
    }
  }, [])

  useEffect(() => {
    loadTicker()
    const id = window.setInterval(loadTicker, TICKER_POLL_MS)
    return () => window.clearInterval(id)
  }, [loadTicker])

  useEffect(() => {
    loadChart(range)
    const id = window.setInterval(() => loadChart(range), CHART_POLL_MS)
    return () => window.clearInterval(id)
  }, [range, loadChart])

  const closes = chart?.closes ?? []
  const firstClose = closes.length >= 2 ? closes[0] : 0
  const lastClose = closes.length >= 2 ? closes[closes.length - 1] : 0
  const displayPrice =
    ticker?.price && ticker.price > 0 ? ticker.price : lastClose || chart?.regularMarketPrice || 0

  const sessionChange =
    ticker?.change ??
    (chart?.regularMarketPrice && chart?.previousClose
      ? chart.regularMarketPrice - chart.previousClose
      : 0)
  const sessionPct =
    ticker?.change_percent ??
    (chart?.previousClose && chart?.regularMarketPrice && chart.previousClose > 0
      ? ((chart.regularMarketPrice - chart.previousClose) / chart.previousClose) * 100
      : 0)
  const rangeMove = firstClose > 0 && lastClose > 0 ? lastClose - firstClose : 0
  const rangePct = firstClose > 0 ? (rangeMove / firstClose) * 100 : 0

  const activeChange = range === '1d' ? sessionChange : rangeMove
  const activePct = range === '1d' ? sessionPct : rangePct
  const positive = activeChange >= 0
  const currency = ticker?.currency ?? 'USD'

  const changeSubtitle =
    range === '1d' ? 'vs prev close' : 'window move'

  const rangeLabel = useMemo(() => {
    switch (range) {
      case '1d':
        return 'Intraday'
      case '5d':
        return '5 sessions'
    }
  }, [range])

  const sparkKey = useMemo(() => {
    const tail = closes.slice(-3).join(':')
    return `${range}-${closes.length}-${tail}-${tick}`
  }, [closes, range, tick])

  return (
    <div className="relative mb-5 rounded-2xl p-[1px] overflow-hidden">
      <motion.div
        className="absolute -in-[40%] aspect-square rounded-full opacity-[0.45]"
        style={{
          background:
            'conic-gradient(from 90deg at 50% 50%, transparent 0deg, rgba(0,212,255,0.35) 80deg, rgba(0,229,160,0.25) 200deg, transparent 320deg)',
        }}
        animate={{ rotate: [0, 360] }}
        transition={{ duration: 14, repeat: Infinity, ease: 'linear' }}
      />
      <div className="relative rounded-2xl border border-[#00D4FF]/10 bg-[#08101E]/90 backdrop-blur-sm p-4 shadow-[0_0_40px_-12px_rgba(0,212,255,0.35)]">
        <div className="pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-br from-[#00D4FF]/[0.06] via-transparent to-[#00E5A0]/[0.04]" />

        <div className="relative flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <motion.span
                className="flex items-center gap-1.5 text-[10px] font-semibold tracking-widest uppercase text-[#00D4FF]/80"
                animate={{ opacity: [0.65, 1, 0.65] }}
                transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
              >
                <Radio className="w-3 h-3 shrink-0" aria-hidden />
                {SYMBOL} · LIVE
              </motion.span>
            </div>
            <AnimatePresence mode="wait">
              <motion.p
                key={displayPrice > 0 ? displayPrice.toFixed(2) : 'loading'}
                initial={{ opacity: 0.4, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0.3, y: -4 }}
                transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                className="text-xl font-bold text-white tabular-nums"
                style={{ fontFamily: 'JetBrains Mono, monospace' }}
              >
                {displayPrice > 0 ? formatPrice(displayPrice, currency) : '—'}
              </motion.p>
            </AnimatePresence>
          </div>
          <div className="text-right shrink-0">
            <AnimatePresence mode="wait">
              <motion.div
                key={`${range}-${activePct}-${positive}`}
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -6 }}
                transition={{ duration: 0.3 }}
              >
                <p
                  className={`text-sm font-semibold tabular-nums ${positive ? 'text-[#00E5A0]' : 'text-[#FF6B7A]'}`}
                  style={{ fontFamily: 'JetBrains Mono, monospace' }}
                >
                  {displayPrice > 0 && Number.isFinite(activePct)
                    ? `${positive ? '+' : ''}${activePct.toFixed(2)}%`
                    : '—'}
                </p>
                <p className="text-[#475569] text-xs tabular-nums" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                  {displayPrice > 0 && Number.isFinite(activeChange) ? (
                    <>
                      {positive ? '+' : '−'}
                      {formatPrice(Math.abs(activeChange), currency)}{' '}
                      <span className="text-[#334155]">{changeSubtitle}</span>
                    </>
                  ) : (
                    '…'
                  )}
                </p>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        <div className="relative flex items-center justify-between gap-2 mb-2">
          <div className="flex rounded-lg bg-[#0D1828]/90 p-0.5 border border-[#1E293B]/80">
            {(['1d', '5d'] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
                className="relative px-3 py-1 text-[11px] font-semibold uppercase tracking-wide rounded-md transition-colors"
              >
                {range === r ? (
                  <motion.span
                    layoutId="authTickerTab"
                    className="absolute inset-0 rounded-md bg-[#00D4FF]/15 border border-[#00D4FF]/25 shadow-[0_0_16px_-4px_rgba(0,212,255,0.5)]"
                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                  />
                ) : null}
                <span className={`relative z-10 ${range === r ? 'text-[#00D4FF]' : 'text-[#64748B] hover:text-[#94A3B8]'}`}>
                  {r === '1d' ? '1D' : '5D'}
                </span>
              </button>
            ))}
          </div>
          <span className="text-[10px] text-[#475569] tracking-wide">{rangeLabel}</span>
        </div>

        <div className="relative h-[104px] w-full rounded-xl overflow-hidden bg-[#060B12]/80 border border-[#0D1828]">
          <div className="absolute inset-0 opacity-[0.5] bg-[linear-gradient(rgba(0,212,255,0.05)_1px,transparent_1px)] bg-[length:100%_22px]" />
          {closes.length >= 2 ? (
            <Player
              key={sparkKey}
              component={AuthTickerSpark}
              durationInFrames={AUTH_TICKER_SPARK_DURATION}
              compositionWidth={380}
              compositionHeight={104}
              fps={AUTH_TICKER_SPARK_FPS}
              inputProps={{ closes, positive }}
              controls={false}
              autoPlay
              loop
              clickToPlay={false}
              doubleClickToFullscreen={false}
              spaceKeyToPlayOrPause={false}
              style={{ width: '100%', height: 104 }}
            />
          ) : (
            <div className="flex h-full items-center justify-center gap-2 text-[11px] text-[#475569]">
              <Activity className="w-3.5 h-3.5 animate-pulse text-[#00D4FF]/60" aria-hidden />
              Syncing market data…
            </div>
          )}
        </div>

        <div className="relative mt-3 flex items-center justify-between gap-2 text-[10px] text-[#64748B]">
          <span className="flex items-center gap-1.5">
            <span className="h-1 w-1 rounded-full bg-[#00E5A0] shadow-[0_0_6px_#00E5A0]" aria-hidden />
            Vol {formatVol(ticker?.volume)}
            {ticker?.avg_volume ? (
              <span className="text-[#475569]">· avg {formatVol(ticker.avg_volume)}</span>
            ) : null}
          </span>
          <span className="text-[#475569] tabular-nums">Updates ~1m</span>
        </div>
      </div>
    </div>
  )
}

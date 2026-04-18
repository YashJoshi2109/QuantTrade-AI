'use client'

import Link from 'next/link'
import { motion } from 'framer-motion'
import { ArrowUpRight, ArrowDownRight } from 'lucide-react'
import TickerLogo from '@/components/TickerLogo'
import { formatNumber, formatPercent, isNumber } from '@/lib/format'

/* ═══════════════════════════════════════════════════════════════════════════
   ANIMATION PRESETS
   ═══════════════════════════════════════════════════════════════════════════ */

const staggerContainer = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.06, delayChildren: 0.04 },
  },
}

const slideInLeft = {
  hidden: { opacity: 0, x: -14 },
  show: {
    opacity: 1,
    x: 0,
    transition: { type: 'spring' as const, stiffness: 120, damping: 16 },
  },
}

const slideInRight = {
  hidden: { opacity: 0, x: 14 },
  show: {
    opacity: 1,
    x: 0,
    transition: { type: 'spring' as const, stiffness: 120, damping: 16 },
  },
}

/* ═══════════════════════════════════════════════════════════════════════════
   GLASS MOVERS PANEL — Top Gainers / Top Losers
   Two side-by-side glass panels. Each row: ticker logo, symbol, company
   name, price, change %. Staggered directional slide-in animation.
   ═══════════════════════════════════════════════════════════════════════════ */

interface GlobalMover {
  symbol: string
  name: string
  price: number
  change_percent: number
}

interface GlassMoversProps {
  gainers: GlobalMover[]
  losers: GlobalMover[]
  isLoading: boolean
  scopeLabel: string
}

function MoverRow({
  stock,
  type,
}: {
  stock: GlobalMover
  idx: number
  type: 'gainer' | 'loser'
}) {
  const up = type === 'gainer'

  return (
    <motion.div variants={up ? slideInLeft : slideInRight}>
      <Link
        href={`/research?symbol=${encodeURIComponent(stock.symbol)}`}
        className={`flex items-center justify-between px-5 py-3 transition-all duration-150 group ${
          up
            ? 'hover:bg-emerald-500/[0.03] border-b border-white/[0.03]'
            : 'hover:bg-red-500/[0.03] border-b border-white/[0.03]'
        }`}
      >
        <div className="flex items-center gap-3 min-w-0">
          <TickerLogo symbol={stock.symbol} companyName={stock.name} size={28} />
          <div className="min-w-0">
            <span className="text-[13px] font-bold text-white font-mono block">
              {stock.symbol}
            </span>
            <span className="text-[10px] text-slate-500 truncate block max-w-[130px]">
              {stock.name}
            </span>
          </div>
        </div>
        <div className="text-right shrink-0 ml-3">
          <span className="text-[13px] font-bold font-mono text-white tabular-nums block">
            {isNumber(stock.price) ? `$${formatNumber(stock.price, 2)}` : '--'}
          </span>
          <span
            className={`text-[11px] font-mono font-bold tabular-nums block ${
              up ? 'text-emerald-400' : 'text-red-400'
            }`}
          >
            {up ? '+' : ''}
            {formatPercent(stock.change_percent, 2)}
          </span>
        </div>
      </Link>
    </motion.div>
  )
}

function SkeletonRows({ count = 5 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="flex items-center justify-between px-5 py-3 border-b border-white/[0.03]"
        >
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-full bg-slate-800/40 animate-pulse" />
            <div>
              <div className="h-3 w-14 bg-slate-800/40 rounded animate-pulse mb-1.5" />
              <div className="h-2.5 w-24 bg-slate-800/25 rounded animate-pulse" />
            </div>
          </div>
          <div className="text-right">
            <div className="h-3 w-16 bg-slate-800/40 rounded animate-pulse mb-1.5" />
            <div className="h-2.5 w-12 bg-slate-800/25 rounded animate-pulse" />
          </div>
        </div>
      ))}
    </>
  )
}

export function GlassMoversPanel({
  gainers,
  losers,
  isLoading,
  scopeLabel,
}: GlassMoversProps) {
  return (
    <motion.div
      title={scopeLabel}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.06, ease: [0.22, 1, 0.36, 1] }}
      className="grid grid-cols-1 sm:grid-cols-2 gap-4"
    >
      {/* ─── Top Gainers ─── */}
      <div className="glass-panel overflow-hidden">
        <div className="px-5 py-4 border-b border-white/[0.05] flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <ArrowUpRight className="w-4 h-4 text-emerald-400" />
            <h3 className="text-[14px] font-bold text-white tracking-[-0.01em]">
              Top Gainers
            </h3>
          </div>
        </div>

        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="show"
          className="max-h-[400px] overflow-y-auto"
        >
          {isLoading ? (
            <SkeletonRows />
          ) : gainers.length === 0 ? (
            <div className="flex items-center justify-center h-24 text-slate-600 text-xs">
              No gainers data available
            </div>
          ) : (
            gainers.slice(0, 10).map((s, i) => (
              <MoverRow key={s.symbol} stock={s} idx={i} type="gainer" />
            ))
          )}
        </motion.div>
      </div>

      {/* ─── Top Losers ─── */}
      <div className="glass-panel overflow-hidden">
        <div className="px-5 py-4 border-b border-white/[0.05] flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <ArrowDownRight className="w-4 h-4 text-red-400" />
            <h3 className="text-[14px] font-bold text-white tracking-[-0.01em]">
              Top Losers
            </h3>
          </div>
        </div>

        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="show"
          className="max-h-[400px] overflow-y-auto"
        >
          {isLoading ? (
            <SkeletonRows />
          ) : losers.length === 0 ? (
            <div className="flex items-center justify-center h-24 text-slate-600 text-xs">
              No losers data available
            </div>
          ) : (
            losers.slice(0, 10).map((s, i) => (
              <MoverRow key={s.symbol} stock={s} idx={i} type="loser" />
            ))
          )}
        </motion.div>
      </div>
    </motion.div>
  )
}

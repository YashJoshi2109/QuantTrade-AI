'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { TrendingUp, TrendingDown, ExternalLink, BarChart3 } from 'lucide-react'
import Link from 'next/link'
import type { ScreenerData } from '../types'

interface Props {
  data: ScreenerData
}

type Tab = 'gainers' | 'losers'

function MiniBar({ value, max, isUp }: { value: number; max: number; isUp: boolean }) {
  const width = Math.max(4, (Math.abs(value) / max) * 100)
  return (
    <div className="w-16 h-2 bg-white/[0.04] rounded-full overflow-hidden">
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: `${width}%` }}
        transition={{ duration: 0.4 }}
        className={`h-full rounded-full ${isUp ? 'bg-emerald-500/60' : 'bg-red-500/60'}`}
      />
    </div>
  )
}

export default function ScreenerTable({ data }: Props) {
  const [tab, setTab] = useState<Tab>('gainers')
  const items = tab === 'gainers' ? data.gainers : data.losers
  const maxChange = Math.max(1, ...((items || []).map((i) => Math.abs(i.change_percent ?? 0))))

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="rounded-2xl bg-[#15171E]/80 backdrop-blur-xl border border-white/[0.06] overflow-hidden"
    >
      {/* Tab header */}
      <div className="flex items-center justify-between px-3 pt-3 pb-2">
        <div className="flex items-center gap-1">
          {(['gainers', 'losers'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-lg transition-all ${
                tab === t
                  ? t === 'gainers'
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                    : 'bg-red-500/10 text-red-400 border border-red-500/20'
                  : 'text-slate-500 border border-transparent hover:text-slate-300'
              }`}
            >
              {t === 'gainers' ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              {t === 'gainers' ? 'Top Gainers' : 'Top Losers'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 text-[9px] text-slate-500">
          <BarChart3 className="w-3 h-3" />
          <span>{items?.length ?? 0} stocks</span>
        </div>
      </div>

      {/* Table */}
      <div className="px-3 pb-3">
        <div className="rounded-lg overflow-hidden border border-white/[0.04]">
          {/* Header row */}
          <div className="grid grid-cols-[1fr_60px_70px_70px] text-[9px] text-slate-500 font-medium uppercase tracking-wider bg-white/[0.02] px-2.5 py-1.5">
            <span>Symbol</span>
            <span className="text-right">Price</span>
            <span className="text-center">Strength</span>
            <span className="text-right">Change</span>
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={tab}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              {items?.length ? items.slice(0, 10).map((item, i) => {
                const isUp = (item.change_percent ?? 0) >= 0
                return (
                  <motion.div
                    key={item.symbol}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.03 }}
                  >
                    <Link
                      href={`/research?symbol=${item.symbol}`}
                      className={`grid grid-cols-[1fr_60px_70px_70px] items-center px-2.5 py-2 hover:bg-white/[0.02] transition-colors group ${
                        i % 2 === 0 ? 'bg-white/[0.01]' : ''
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-[11px] font-bold text-white">{item.symbol}</span>
                        <span className="text-[9px] text-slate-500 truncate hidden sm:inline">{item.name}</span>
                        <ExternalLink className="w-2.5 h-2.5 text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                      </div>
                      <span className="text-[11px] font-semibold text-white tabular-nums text-right">
                        ${item.price?.toFixed(2) ?? '—'}
                      </span>
                      <div className="flex justify-center">
                        <MiniBar value={item.change_percent ?? 0} max={maxChange} isUp={isUp} />
                      </div>
                      <span className={`text-[11px] font-semibold tabular-nums text-right ${isUp ? 'text-emerald-400' : 'text-red-400'}`}>
                        {isUp ? '+' : ''}{item.change_percent?.toFixed(2) ?? '—'}%
                      </span>
                    </Link>
                  </motion.div>
                )
              }) : (
                <div className="text-center py-4 text-[10px] text-slate-500">No data available</div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  )
}

'use client'

import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { TrendingUp, TrendingDown, Building2, Plus, Check, ExternalLink } from 'lucide-react'
import Link from 'next/link'
import { addToWatchlist } from '@/lib/api'
import type { StockAnalysisData } from '../types'

function fmt(val: number | null | undefined, decimals = 2): string {
  if (val == null) return '—'
  return val.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function fmtLarge(val: number | null | undefined): string {
  if (val == null) return '—'
  if (Math.abs(val) >= 1e12) return `$${(val / 1e12).toFixed(2)}T`
  if (Math.abs(val) >= 1e9) return `$${(val / 1e9).toFixed(2)}B`
  if (Math.abs(val) >= 1e6) return `$${(val / 1e6).toFixed(2)}M`
  return `$${fmt(val)}`
}

interface Props {
  data: StockAnalysisData
}

export default function StockOverviewCard({ data }: Props) {
  const [addedToWatchlist, setAddedToWatchlist] = useState(false)
  const price = data.quote?.price
  const change = data.quote?.change
  const changePct = data.quote?.change_percent
  const isUp = (changePct ?? 0) >= 0

  const handleAddWatchlist = async () => {
    try {
      await addToWatchlist({ symbol: data.symbol })
      setAddedToWatchlist(true)
    } catch {
      setAddedToWatchlist(true)
    }
  }

  const stats = useMemo(() => {
    const f = data.fundamentals
    const c = data.company
    return [
      { label: 'Market Cap', value: fmtLarge(f?.market_cap ?? c?.market_cap) },
      { label: 'P/E', value: f?.pe_ratio != null ? fmt(f.pe_ratio, 1) : '—' },
      { label: 'Beta', value: f?.beta != null ? fmt(f.beta, 2) : '—' },
      { label: '52W High', value: f?.week_52_high != null ? `$${fmt(f.week_52_high)}` : '—' },
      { label: '52W Low', value: f?.week_52_low != null ? `$${fmt(f.week_52_low)}` : '—' },
      { label: 'Volume', value: data.quote?.volume != null ? (data.quote.volume / 1e6).toFixed(1) + 'M' : '—' },
    ]
  }, [data])

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="rounded-2xl bg-[#15171E]/80 backdrop-blur-xl border border-white/[0.06] overflow-hidden"
    >
      {/* Header */}
      <div className="px-4 pt-4 pb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-bold text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded-md border border-cyan-500/20">
              {data.symbol}
            </span>
            {data.company?.sector && (
              <span className="flex items-center gap-1 text-[9px] text-slate-500">
                <Building2 className="w-3 h-3" />
                {data.company.sector}
              </span>
            )}
          </div>
          <h4 className="text-[15px] font-bold text-white truncate">
            {data.company?.name || data.symbol}
          </h4>
        </div>

        {/* Price block */}
        <div className="text-right flex-shrink-0">
          <motion.div
            key={price}
            initial={{ scale: 1.06, opacity: 0.7 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.3 }}
            className="text-[22px] font-bold text-white tabular-nums"
          >
            {price != null ? `$${fmt(price)}` : '—'}
          </motion.div>
          <div className={`flex items-center justify-end gap-1 text-[12px] font-mono font-semibold ${isUp ? 'text-emerald-400' : 'text-red-400'}`}>
            {isUp ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
            <span>{change != null ? `${isUp ? '+' : ''}${fmt(change)}` : ''}</span>
            <span className="text-[10px] opacity-80">
              ({changePct != null ? `${isUp ? '+' : ''}${fmt(changePct)}%` : ''})
            </span>
          </div>
        </div>
      </div>

      {/* Stats grid */}
      <div className="px-4 pb-3">
        <div className="grid grid-cols-3 gap-2">
          {stats.map((s) => (
            <div
              key={s.label}
              className="rounded-lg bg-white/[0.03] border border-white/[0.04] px-2.5 py-2"
            >
              <p className="text-[9px] text-slate-500 uppercase tracking-wider mb-0.5">{s.label}</p>
              <p className="text-[12px] font-semibold text-white tabular-nums">{s.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Action buttons */}
      <div className="px-4 pb-3 flex items-center gap-2">
        <button
          onClick={handleAddWatchlist}
          disabled={addedToWatchlist}
          className={`flex items-center gap-1.5 text-[10px] font-semibold px-3 py-1.5 rounded-lg border transition-all ${
            addedToWatchlist
              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
              : 'bg-white/[0.03] text-slate-400 border-white/[0.06] hover:text-white hover:border-white/[0.12]'
          }`}
        >
          {addedToWatchlist ? <Check className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
          {addedToWatchlist ? 'Added' : 'Watchlist'}
        </button>
        <Link
          href={`/research?symbol=${data.symbol}`}
          className="flex items-center gap-1.5 text-[10px] font-semibold px-3 py-1.5 rounded-lg border bg-cyan-500/10 text-cyan-400 border-cyan-500/20 hover:bg-cyan-500/20 transition-all"
        >
          <ExternalLink className="w-3 h-3" />
          Full Research
        </Link>
      </div>
    </motion.div>
  )
}

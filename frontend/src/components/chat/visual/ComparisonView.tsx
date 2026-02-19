'use client'

import { motion } from 'framer-motion'
import { ArrowUpRight, ArrowDownRight, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import type { ComparisonData, StockAnalysisData } from '../types'

interface Props {
  data: ComparisonData
}

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

function RegimeBadge({ stock }: { stock: StockAnalysisData }) {
  const regime = stock.regime?.regime || stock.technical_signal?.trend?.toUpperCase() || 'NEUTRAL'
  const config: Record<string, { icon: typeof TrendingUp; color: string }> = {
    BULLISH: { icon: TrendingUp, color: 'text-emerald-400 bg-emerald-500/10' },
    bullish: { icon: TrendingUp, color: 'text-emerald-400 bg-emerald-500/10' },
    BEARISH: { icon: TrendingDown, color: 'text-red-400 bg-red-500/10' },
    bearish: { icon: TrendingDown, color: 'text-red-400 bg-red-500/10' },
  }
  const c = config[regime] || { icon: Minus, color: 'text-amber-400 bg-amber-500/10' }
  return (
    <span className={`inline-flex items-center gap-0.5 text-[8px] font-bold px-1.5 py-0.5 rounded ${c.color}`}>
      <c.icon className="w-2.5 h-2.5" />
      {regime}
    </span>
  )
}

function MiniCard({ stock }: { stock: StockAnalysisData }) {
  const isUp = (stock.quote?.change_percent ?? 0) >= 0

  return (
    <div className="flex-1 rounded-xl bg-white/[0.02] border border-white/[0.04] p-3 min-w-0">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] font-bold text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded-md border border-cyan-500/20">
          {stock.symbol}
        </span>
        <RegimeBadge stock={stock} />
      </div>
      <p className="text-[12px] text-slate-400 truncate mb-1.5">
        {stock.company?.name || stock.symbol}
      </p>
      <div className="text-[18px] font-bold text-white tabular-nums">
        {stock.quote?.price != null ? `$${fmt(stock.quote.price)}` : '—'}
      </div>
      <div className={`flex items-center gap-1 text-[11px] font-mono font-semibold mt-0.5 ${isUp ? 'text-emerald-400' : 'text-red-400'}`}>
        {isUp ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
        {stock.quote?.change_percent != null ? `${isUp ? '+' : ''}${fmt(stock.quote.change_percent)}%` : '—'}
      </div>
    </div>
  )
}

interface CompRow {
  label: string
  getValue: (s: StockAnalysisData) => string
}

const rows: CompRow[] = [
  { label: 'Price', getValue: (s) => s.quote?.price != null ? `$${fmt(s.quote.price)}` : '—' },
  { label: 'Change %', getValue: (s) => s.quote?.change_percent != null ? `${fmt(s.quote.change_percent)}%` : '—' },
  { label: 'Market Cap', getValue: (s) => fmtLarge(s.fundamentals?.market_cap ?? s.company?.market_cap) },
  { label: 'P/E Ratio', getValue: (s) => s.fundamentals?.pe_ratio != null ? fmt(s.fundamentals.pe_ratio, 1) : '—' },
  { label: 'Beta', getValue: (s) => s.fundamentals?.beta != null ? fmt(s.fundamentals.beta) : '—' },
  { label: 'RSI', getValue: (s) => s.indicators?.rsi != null ? fmt(s.indicators.rsi, 1) : '—' },
  { label: 'EPS', getValue: (s) => s.fundamentals?.eps != null ? `$${fmt(s.fundamentals.eps)}` : '—' },
  { label: 'Signal', getValue: (s) => s.technical_signal?.trend || s.regime?.regime?.toLowerCase() || '—' },
  { label: 'Risk', getValue: (s) => s.risk?.risk_level || '—' },
]

export default function ComparisonView({ data }: Props) {
  if (data.stocks.length < 2) return null
  const [a, b] = data.stocks

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="rounded-2xl bg-[#15171E]/80 backdrop-blur-xl border border-white/[0.06] overflow-hidden"
    >
      {/* Side by side header cards */}
      <div className="flex gap-2 p-3">
        <MiniCard stock={a} />
        <div className="flex items-center">
          <span className="text-[10px] font-bold text-slate-500 bg-white/[0.03] border border-white/[0.04] rounded-full w-7 h-7 flex items-center justify-center">
            VS
          </span>
        </div>
        <MiniCard stock={b} />
      </div>

      {/* Comparison table */}
      <div className="px-3 pb-3">
        <div className="rounded-lg overflow-hidden border border-white/[0.04]">
          {rows.map((row, i) => (
            <div
              key={row.label}
              className={`grid grid-cols-3 text-[10px] ${i % 2 === 0 ? 'bg-white/[0.01]' : 'bg-transparent'}`}
            >
              <div className="px-2.5 py-1.5 text-slate-500 font-medium">{row.label}</div>
              <div className="px-2.5 py-1.5 text-white font-semibold tabular-nums text-center">{row.getValue(a)}</div>
              <div className="px-2.5 py-1.5 text-white font-semibold tabular-nums text-center">{row.getValue(b)}</div>
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  )
}

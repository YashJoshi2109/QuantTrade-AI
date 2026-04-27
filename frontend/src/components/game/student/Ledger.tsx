'use client'

import { motion } from 'framer-motion'
import type { LedgerEntry } from '@/lib/student-store'

const CATEGORY_META: Record<LedgerEntry['category'], { label: string; color: string; sign: string; emoji: string }> = {
  earn:      { label: 'Earned',    color: '#00E5A0', sign: '+', emoji: '💰' },
  spend:     { label: 'Spent',     color: '#FF4757', sign: '-', emoji: '🪙' },
  save:      { label: 'Saved',     color: '#00D4FF', sign: '+', emoji: '💎' },
  emergency: { label: 'Emergency', color: '#ECCC68', sign: '±', emoji: '❄️' },
  debt:      { label: 'Debt',      color: '#FF6B9D', sign: '-', emoji: '📜' },
  invest:    { label: 'Invested',  color: '#A78BFA', sign: '→', emoji: '⚙️' },
}

interface LedgerProps {
  entries: LedgerEntry[]
  showSummary?: boolean
  maxRows?: number
  title?: string
}

export function Ledger({ entries, showSummary = true, maxRows = 8, title = 'Daily Ledger' }: LedgerProps) {
  const visible = entries.slice(-maxRows).reverse()

  const totals = entries.reduce(
    (acc, e) => {
      if (e.category === 'earn') acc.earned += Math.abs(e.amount)
      else if (e.category === 'spend') acc.spent += Math.abs(e.amount)
      else if (e.category === 'save') acc.saved += Math.abs(e.amount)
      return acc
    },
    { earned: 0, spent: 0, saved: 0 }
  )

  return (
    <div className="rounded-2xl border border-line-default bg-[#080B14] overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-line-subtle flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-amber-400">📜</span>
          <span className="text-sm font-bold text-amber-300/90" style={{ fontFamily: 'Syne, serif' }}>
            {title}
          </span>
        </div>
        <span className="text-[10px] text-white/30 uppercase tracking-widest">
          {entries.length} entries
        </span>
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-12 px-4 py-2 text-[9px] font-semibold text-white/30 uppercase tracking-widest border-b border-line-subtle">
        <div className="col-span-1">Day</div>
        <div className="col-span-2">Type</div>
        <div className="col-span-7">Description</div>
        <div className="col-span-2 text-right">Amount</div>
      </div>

      {/* Entries */}
      <div className="divide-y divide-white/4 max-h-48 overflow-y-auto">
        {visible.length === 0 ? (
          <div className="px-4 py-6 text-center text-white/30 text-sm">
            No ledger entries yet. Start trading!
          </div>
        ) : (
          visible.map((entry, i) => {
            const meta = CATEGORY_META[entry.category]
            return (
              <motion.div
                key={entry.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.04 }}
                className="grid grid-cols-12 px-4 py-2 text-xs items-center hover:bg-white/3 transition-colors"
              >
                <div className="col-span-1 text-white/30 font-mono text-[10px]">{entry.day}</div>
                <div className="col-span-2">
                  <span
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-bold border"
                    style={{ color: meta.color, borderColor: `${meta.color}30`, backgroundColor: `${meta.color}10` }}
                  >
                    {meta.emoji} {meta.label}
                  </span>
                </div>
                <div className="col-span-7 text-white/60 truncate pr-2">{entry.label}</div>
                <div
                  className="col-span-2 text-right font-bold font-mono text-xs"
                  style={{ color: meta.color }}
                >
                  {meta.sign}{Math.abs(entry.amount)}s
                </div>
              </motion.div>
            )
          })
        )}
      </div>

      {/* Summary */}
      {showSummary && entries.length > 0 && (
        <div className="px-4 py-3 border-t border-line-subtle grid grid-cols-3 gap-3">
          {[
            { label: 'Earned', value: totals.earned, color: '#00E5A0' },
            { label: 'Spent',  value: totals.spent,  color: '#FF4757' },
            { label: 'Saved',  value: totals.saved,  color: '#00D4FF' },
          ].map((s) => (
            <div key={s.label} className="text-center">
              <div className="text-[10px] text-white/40 uppercase tracking-wider">{s.label}</div>
              <div className="font-bold font-mono text-sm" style={{ color: s.color }}>
                {s.value}s
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

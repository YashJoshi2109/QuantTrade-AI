'use client'

import { motion } from 'framer-motion'

interface Bucket {
  id: string
  label: string
  emoji: string
  amount: number
  color: string
  description: string
  maxDisplay?: number
}

interface SavingsBucketsProps {
  gold: number
  savings: number
  emergency: number
  debt?: number
  goalLabel?: string
}

export function SavingsBuckets({
  gold,
  savings,
  emergency,
  debt = 0,
  goalLabel = 'Roof Fund',
}: SavingsBucketsProps) {
  const buckets: Bucket[] = [
    {
      id: 'spending',
      label: 'Spending Pouch',
      emoji: '👜',
      amount: gold,
      color: '#C9A84C',
      description: 'Daily use — food, tools, transport',
      maxDisplay: 100,
    },
    {
      id: 'savings',
      label: goalLabel,
      emoji: '🏆',
      amount: savings,
      color: '#00D4FF',
      description: 'Goal savings — do not touch',
      maxDisplay: 100,
    },
    {
      id: 'emergency',
      label: 'Winter Reserve',
      emoji: '❄️',
      amount: emergency,
      color: '#00E5A0',
      description: 'Emergency only — broken carts, illness',
      maxDisplay: 60,
    },
  ]

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-amber-400 text-sm">💼</span>
        <span className="text-xs font-bold text-amber-300/80 uppercase tracking-widest">
          Savings Buckets
        </span>
      </div>

      {buckets.map((bucket, i) => {
        const fillPct = Math.min(100, (bucket.amount / (bucket.maxDisplay ?? 100)) * 100)

        return (
          <motion.div
            key={bucket.id}
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.1 }}
            className="rounded-xl border border-line-subtle bg-white/3 p-3"
          >
            <div className="flex items-center gap-2.5 mb-2">
              <span className="text-xl">{bucket.emoji}</span>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold text-white/80">{bucket.label}</div>
                <div className="text-[10px] text-white/35 truncate">{bucket.description}</div>
              </div>
              <div className="text-right shrink-0">
                <span className="font-bold font-mono text-sm" style={{ color: bucket.color }}>
                  {bucket.amount}
                </span>
                <span className="text-white/30 text-[10px]"> s</span>
              </div>
            </div>

            {/* Fill bar */}
            <div className="h-2 bg-white/5 rounded-full overflow-hidden">
              <motion.div
                className="h-full rounded-full"
                style={{ backgroundColor: bucket.color }}
                initial={{ width: '0%' }}
                animate={{ width: `${fillPct}%` }}
                transition={{ duration: 0.8, delay: i * 0.1 + 0.2, ease: 'easeOut' }}
              />
            </div>
          </motion.div>
        )
      })}

      {/* Debt warning */}
      {debt > 0 && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="rounded-xl border border-red-500/30 bg-red-500/8 p-3 flex items-center gap-2.5"
        >
          <span className="text-xl">📜</span>
          <div className="flex-1">
            <div className="text-xs font-semibold text-red-300">Outstanding Debt</div>
            <div className="text-[10px] text-red-400/60">Repay to avoid interest penalties</div>
          </div>
          <div className="font-bold font-mono text-sm text-red-400">-{debt} s</div>
        </motion.div>
      )}

      {/* Total net worth summary */}
      <div className="pt-2 flex items-center justify-between px-1">
        <span className="text-[10px] text-white/30 uppercase tracking-wider">Net Holdings</span>
        <span
          className="font-bold font-mono text-sm"
          style={{ color: gold + savings + emergency - debt >= 0 ? '#00E5A0' : '#FF4757' }}
        >
          {gold + savings + emergency - debt} silver
        </span>
      </div>
    </div>
  )
}

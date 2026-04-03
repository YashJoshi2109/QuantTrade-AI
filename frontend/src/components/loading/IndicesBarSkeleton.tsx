'use client'

import { motion } from 'framer-motion'
import { Signal } from 'lucide-react'

const chips = Array.from({ length: 12 })

export default function IndicesBarSkeleton() {
  return (
    <div className="flex items-center gap-px bg-slate-950/60 border-b border-slate-800/60 overflow-x-auto scrollbar-none">
      <div className="shrink-0 flex items-center gap-1.5 px-3 py-2 border-r border-slate-800/60 bg-sky-500/10">
        <Signal className="w-3 h-3 text-sky-400 animate-pulse" />
        <span className="text-[9px] font-black uppercase tracking-[0.15em] text-sky-400/80 font-mono whitespace-nowrap">
          INDICES
        </span>
      </div>
      {chips.map((_, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0.4 }}
          animate={{ opacity: [0.4, 0.9, 0.4] }}
          transition={{ duration: 1.6, repeat: Infinity, delay: i * 0.08 }}
          className="shrink-0 flex flex-col gap-1 px-3 py-2 border-r border-slate-800/40 min-w-[88px]"
        >
          <div className="h-2.5 w-10 rounded bg-slate-800 skeleton-shimmer" />
          <div className="h-3 w-14 rounded bg-slate-700/80 skeleton-shimmer" />
          <div className="h-2.5 w-16 rounded bg-slate-800/60 skeleton-shimmer" />
        </motion.div>
      ))}
    </div>
  )
}

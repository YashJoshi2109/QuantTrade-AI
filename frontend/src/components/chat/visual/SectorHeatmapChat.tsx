'use client'

import { motion } from 'framer-motion'
import { BarChart3 } from 'lucide-react'
import type { SectorData } from '../types'

interface Props {
  data: SectorData
}

export default function SectorHeatmapChat({ data }: Props) {
  const sectors = data.sectors || []
  const sorted = [...sectors].sort((a, b) => (b.change_percent ?? 0) - (a.change_percent ?? 0))

  if (!sorted.length) {
    return (
      <div className="rounded-2xl bg-[#15171E]/80 backdrop-blur-xl border border-white/[0.06] p-4 text-center">
        <p className="text-[10px] text-slate-500">No sector data available</p>
      </div>
    )
  }

  const maxAbs = Math.max(1, ...sorted.map((s) => Math.abs(s.change_percent ?? 0)))

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="rounded-2xl bg-[#15171E]/80 backdrop-blur-xl border border-white/[0.06] overflow-hidden"
    >
      <div className="px-3 pt-3 pb-2 flex items-center gap-2">
        <BarChart3 className="w-3.5 h-3.5 text-cyan-400" />
        <span className="text-[11px] font-semibold text-slate-300">Sector Performance</span>
      </div>

      <div className="px-3 pb-3 space-y-1.5">
        {sorted.map((sector, i) => {
          const pct = sector.change_percent ?? 0
          const isUp = pct >= 0
          const barWidth = Math.max(2, (Math.abs(pct) / maxAbs) * 100)

          return (
            <motion.div
              key={sector.sector}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.04 }}
              className="flex items-center gap-2"
            >
              <span className="text-[10px] text-slate-400 w-28 truncate flex-shrink-0">
                {sector.sector}
              </span>
              <div className="flex-1 h-4 bg-white/[0.02] rounded overflow-hidden relative">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${barWidth}%` }}
                  transition={{ duration: 0.5, delay: i * 0.04 }}
                  className={`h-full rounded ${isUp ? 'bg-emerald-500/30' : 'bg-red-500/30'}`}
                />
              </div>
              <span className={`text-[10px] font-mono font-semibold tabular-nums w-14 text-right ${isUp ? 'text-emerald-400' : 'text-red-400'}`}>
                {isUp ? '+' : ''}{pct.toFixed(2)}%
              </span>
            </motion.div>
          )
        })}
      </div>
    </motion.div>
  )
}

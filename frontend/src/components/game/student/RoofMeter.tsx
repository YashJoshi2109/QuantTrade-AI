'use client'

import { motion } from 'framer-motion'

interface RoofMeterProps {
  current: number
  target: number
  label?: string
  emoji?: string
  deadlineDays?: number
  daysLeft?: number
}

export function RoofMeter({
  current,
  target,
  label = 'Roof Repair Fund',
  emoji = '🏠',
  deadlineDays,
  daysLeft,
}: RoofMeterProps) {
  const pct = Math.min(100, (current / target) * 100)
  const isComplete = pct >= 100
  const isUrgent = daysLeft !== undefined && daysLeft <= 3

  const segments = [
    { threshold: 25, color: '#FF4757' },
    { threshold: 50, color: '#FFA502' },
    { threshold: 75, color: '#ECCC68' },
    { threshold: 100, color: '#00E5A0' },
  ]
  const currentColor = segments.find((s) => pct <= s.threshold)?.color ?? '#00E5A0'

  return (
    <div className="rounded-2xl border border-white/10 bg-white/3 p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-2xl">{emoji}</span>
          <div>
            <div className="text-xs font-bold text-white/70 uppercase tracking-wider">{label}</div>
            {deadlineDays && (
              <div className={`text-[10px] font-medium ${isUrgent ? 'text-red-400' : 'text-white/40'}`}>
                {daysLeft !== undefined ? `${daysLeft} days until winter` : `${deadlineDays}-day goal`}
              </div>
            )}
          </div>
        </div>
        <div className="text-right">
          <div className="text-lg font-bold" style={{ color: currentColor }}>
            {current}
            <span className="text-white/40 text-sm font-normal"> / {target}</span>
          </div>
          <div className="text-[10px] text-white/40">silver coins</div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="relative">
        <div className="h-5 bg-white/5 rounded-full overflow-hidden border border-white/8">
          <motion.div
            className="h-full rounded-full relative overflow-hidden"
            style={{ backgroundColor: currentColor }}
            initial={{ width: '0%' }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 1.2, ease: 'easeOut' }}
          >
            {/* Shimmer */}
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-pulse" />
          </motion.div>
        </div>

        {/* Percentage label */}
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-[10px] font-bold text-white/80 drop-shadow">
            {Math.round(pct)}%
          </span>
        </div>

        {/* Milestone ticks */}
        {[25, 50, 75].map((tick) => (
          <div
            key={tick}
            className="absolute top-0 h-5 w-px bg-white/20"
            style={{ left: `${tick}%` }}
          />
        ))}
      </div>

      {/* House illustration */}
      <div className="flex gap-1 justify-center">
        {Array.from({ length: 8 }).map((_, i) => {
          const filled = (i + 1) / 8 <= pct / 100
          return (
            <div
              key={i}
              className="text-lg transition-all duration-500"
              style={{ opacity: filled ? 1 : 0.2, filter: filled ? 'none' : 'grayscale(1)' }}
            >
              🧱
            </div>
          )
        })}
      </div>

      {/* Status message */}
      {isComplete ? (
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="text-center py-2 rounded-xl bg-emerald-500/15 border border-emerald-500/30"
        >
          <div className="text-emerald-400 font-bold text-sm">🏠 Roof Repaired! Family is safe.</div>
        </motion.div>
      ) : (
        <div className="text-center text-xs text-white/40">
          Need <span className="text-white/70 font-semibold">{target - current} more silver</span> to repair the roof
        </div>
      )}
    </div>
  )
}

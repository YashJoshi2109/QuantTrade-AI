'use client'

import { motion } from 'framer-motion'
import type { Choice } from '@/lib/student-chapters'

interface DailyReflectionProps {
  chapterTitle: string
  chapterNum: number
  choiceMade: Choice
  xpEarned: number
  totalXp: number
  totalGold: number
  dayNumber: number
  onContinue: () => void
}

export function DailyReflection({
  chapterTitle,
  chapterNum,
  choiceMade,
  xpEarned,
  totalXp,
  totalGold,
  dayNumber,
  onContinue,
}: DailyReflectionProps) {
  const deltas = [
    { label: 'Gold change', value: choiceMade.goldDelta, color: choiceMade.goldDelta >= 0 ? '#00E5A0' : '#FF4757', emoji: '🪙' },
    { label: 'Saved', value: choiceMade.savingsDelta, color: '#00D4FF', emoji: '💎' },
    { label: 'Emergency reserve', value: choiceMade.emergencyDelta, color: '#ECCC68', emoji: '❄️' },
    { label: 'New debt', value: -choiceMade.debtDelta, color: '#FF6B9D', emoji: '📜' },
  ].filter((d) => d.value !== 0)

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="rounded-2xl border border-amber-500/25 bg-gradient-to-b from-amber-500/8 to-transparent p-6 space-y-5"
    >
      {/* Header */}
      <div className="text-center">
        <div className="text-3xl mb-2">📜</div>
        <div className="text-xs text-amber-400/60 uppercase tracking-widest font-semibold mb-1">
          Chapter {chapterNum} Complete · Day {dayNumber}
        </div>
        <h3 className="text-lg font-bold text-amber-300" style={{ fontFamily: 'Syne, serif' }}>
          {chapterTitle}
        </h3>
      </div>

      {/* Consequence text */}
      <div className="rounded-xl bg-white/5 border border-white/8 p-4">
        <div className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-2">What happened</div>
        <p className="text-sm text-white/80 leading-relaxed">{choiceMade.consequence}</p>
      </div>

      {/* Financial summary */}
      {deltas.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-2">Financial impact</div>
          <div className="grid grid-cols-2 gap-2">
            {deltas.map((d) => (
              <motion.div
                key={d.label}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-xl bg-white/5 border border-white/8 p-3 flex items-center gap-2"
              >
                <span className="text-lg">{d.emoji}</span>
                <div>
                  <div className="text-[9px] text-white/40 uppercase">{d.label}</div>
                  <div className="font-bold font-mono text-sm" style={{ color: d.color }}>
                    {d.value > 0 ? '+' : ''}{d.value} silver
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {/* XP reward */}
      <div className="flex items-center gap-3 rounded-xl bg-amber-500/10 border border-amber-500/25 p-3">
        <div className="w-10 h-10 rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-lg shrink-0">
          ⚔️
        </div>
        <div className="flex-1">
          <div className="text-xs text-amber-400/60 uppercase tracking-wider">XP Earned</div>
          <div className="font-bold text-amber-300">+{xpEarned} experience points</div>
        </div>
        <div className="text-right">
          <div className="text-[10px] text-white/30">Total XP</div>
          <div className="font-bold font-mono text-amber-400">{totalXp}</div>
        </div>
      </div>

      {/* Lesson */}
      <div className="rounded-xl bg-blue-500/8 border border-blue-400/20 p-4">
        <div className="flex items-start gap-2">
          <span className="text-blue-400 shrink-0 mt-0.5">💡</span>
          <div>
            <div className="text-[10px] text-blue-400/60 uppercase tracking-wider font-semibold mb-1">
              Insight
            </div>
            <p className="text-sm text-blue-100/80 leading-relaxed italic">"{choiceMade.lesson}"</p>
          </div>
        </div>
      </div>

      {/* Continue button */}
      <button
        onClick={onContinue}
        className="w-full py-3.5 rounded-xl bg-gradient-to-r from-amber-600 to-yellow-500 text-[#060B12] font-bold text-sm hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
      >
        Return to Ashmarket →
      </button>
    </motion.div>
  )
}

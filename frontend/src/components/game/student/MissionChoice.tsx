'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { Choice } from '@/lib/student-chapters'

interface MissionChoiceProps {
  choices: Choice[]
  onChoose: (choice: Choice) => void
  disabled?: boolean
}

export function MissionChoice({ choices, onChoose, disabled = false }: MissionChoiceProps) {
  const [selected, setSelected] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState(false)

  function handleSelect(choice: Choice) {
    if (disabled || confirmed) return
    setSelected(choice.id)
  }

  function handleConfirm() {
    if (!selected || confirmed) return
    const choice = choices.find((c) => c.id === selected)
    if (!choice) return
    setConfirmed(true)
    setTimeout(() => onChoose(choice), 600)
  }

  const selectedChoice = choices.find((c) => c.id === selected)

  return (
    <div className="space-y-3">
      <div className="text-xs font-semibold text-amber-400/80 uppercase tracking-widest mb-2">
        ⚔️ Your Decision
      </div>

      {/* Choice cards */}
      <div className="grid gap-2">
        {choices.map((choice, i) => {
          const isSelected = selected === choice.id
          const isOther = selected && !isSelected

          return (
            <motion.button
              key={choice.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: isOther && !confirmed ? 0.45 : 1, y: 0 }}
              transition={{ delay: i * 0.08 }}
              onClick={() => handleSelect(choice)}
              disabled={disabled || confirmed}
              className={`w-full text-left rounded-xl border p-3.5 transition-all duration-200 group ${
                isSelected
                  ? 'border-amber-500/50 bg-amber-500/10 scale-[1.01]'
                  : 'border-white/8 bg-white/3 hover:border-white/20 hover:bg-white/6'
              } ${disabled || confirmed ? 'cursor-not-allowed' : 'cursor-pointer'}`}
            >
              <div className="flex items-start gap-3">
                {/* Radio indicator */}
                <div className={`mt-0.5 w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center transition-all ${
                  isSelected ? 'border-amber-500 bg-amber-500' : 'border-white/20'
                }`}>
                  {isSelected && (
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      className="w-1.5 h-1.5 rounded-full bg-[#060B12]"
                    />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className={`text-sm font-semibold mb-1 ${
                    isSelected ? 'text-amber-200' : 'text-white/85'
                  }`}>
                    {choice.label}
                    {choice.isOptimal && (
                      <span className="ml-2 text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-bold">
                        WISE
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-white/45 leading-relaxed">{choice.description}</div>

                  {/* Consequence preview (only when selected) */}
                  <AnimatePresence>
                    {isSelected && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="mt-2.5 pt-2.5 border-t border-amber-500/20"
                      >
                        {/* Delta chips */}
                        <div className="flex flex-wrap gap-1.5 mb-2">
                          {choice.goldDelta !== 0 && (
                            <Chip color={choice.goldDelta > 0 ? '#00E5A0' : '#FF4757'}
                              label={`Gold ${choice.goldDelta > 0 ? '+' : ''}${choice.goldDelta}s`} />
                          )}
                          {choice.savingsDelta > 0 && (
                            <Chip color="#00D4FF" label={`Save +${choice.savingsDelta}s`} />
                          )}
                          {choice.emergencyDelta !== 0 && (
                            <Chip color="#ECCC68" label={`Reserve ${choice.emergencyDelta > 0 ? '+' : ''}${choice.emergencyDelta}s`} />
                          )}
                          {choice.debtDelta > 0 && (
                            <Chip color="#FF6B9D" label={`Debt +${choice.debtDelta}s`} />
                          )}
                          <Chip color="#C9A84C" label={`+${choice.xpReward} XP`} />
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </motion.button>
          )
        })}
      </div>

      {/* Confirm button */}
      <AnimatePresence>
        {selected && !confirmed && (
          <motion.button
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            onClick={handleConfirm}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-amber-600 to-amber-500 text-[#060B12] font-bold text-sm flex items-center justify-center gap-2 hover:opacity-90 transition-opacity"
          >
            ⚔️ Commit to this choice
          </motion.button>
        )}
      </AnimatePresence>

      {/* Confirmed state */}
      {confirmed && selectedChoice && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="rounded-xl border border-amber-500/30 bg-amber-500/8 p-3 text-center"
        >
          <div className="text-amber-400 font-bold text-sm mb-1">Decision made.</div>
          <div className="text-white/60 text-xs">{selectedChoice.label}</div>
        </motion.div>
      )}
    </div>
  )
}

function Chip({ color, label }: { color: string; label: string }) {
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold border"
      style={{ color, borderColor: `${color}40`, backgroundColor: `${color}15` }}
    >
      {label}
    </span>
  )
}

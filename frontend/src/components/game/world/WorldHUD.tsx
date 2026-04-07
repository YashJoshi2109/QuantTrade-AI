'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { Coins, PiggyBank, Zap, CalendarDays, AlertTriangle } from 'lucide-react'
import { useStudentStore } from '@/lib/student-store'
import { useEffect, useRef, useState } from 'react'

interface Toast { id: number; text: string; type: 'success' | 'warn' | 'info' }

export function useWorldToasts() {
  const [toasts, setToasts] = useState<Toast[]>([])
  const counter = useRef(0)

  function addToast(text: string, type: Toast['type'] = 'info') {
    const id = ++counter.current
    setToasts(prev => [...prev, { id, text, type }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000)
  }

  return { toasts, addToast }
}

interface WorldHUDProps {
  toasts: Toast[]
  nearBuilding: string | null
  onBuildingInteract: () => void
  dialogueActive?: boolean
}

const BUILDING_LABELS: Record<string, string> = {
  market_stall:   'Market Stall',
  treasury:       'Treasury',
  guild_hall:     'Guild Hall',
  home:           'Home',
  trade_caravan:  'Trade Caravan',
  counting_house: 'Counting House',
  trading_post:   'Trading Post',
  town_hall:      'Town Hall',
  apothecary:     'Apothecary',
}

export default function WorldHUD({ toasts, nearBuilding, onBuildingInteract, dialogueActive = false }: WorldHUDProps) {
  const { gold, savings, xp, level, dayNumber, debt } = useStudentStore()
  // XP thresholds per level: 100, 250, 500, 800, 1200
  const XP_THRESHOLDS = [0, 100, 250, 500, 800, 1200]
  const levelIdx = Math.min(level - 1, XP_THRESHOLDS.length - 1)
  const levelStart = XP_THRESHOLDS[levelIdx] ?? 0
  const levelEnd = XP_THRESHOLDS[levelIdx + 1] ?? levelStart + 200
  const xpInLevel = xp - levelStart
  const xpForLevel = levelEnd - levelStart
  const xpPct = Math.round((xpInLevel / xpForLevel) * 100)

  return (
    <>
      {/* Top-left stat panel */}
      <div className="absolute top-4 left-4 z-20 flex flex-col gap-2">
        <div className="bg-stone-900/85 backdrop-blur border border-amber-800/50 rounded-xl px-3 py-2 flex flex-col gap-1.5">
          <StatRow icon={<Coins size={14} className="text-yellow-400" />} label="Gold" value={gold} color="text-yellow-300" />
          <StatRow icon={<PiggyBank size={14} className="text-green-400" />} label="Savings" value={savings} color="text-green-300" />
          {debt > 0 && (
            <StatRow icon={<AlertTriangle size={14} className="text-red-400" />} label="Debt" value={debt} color="text-red-300" />
          )}
        </div>

        {/* XP bar */}
        <div className="bg-stone-900/85 backdrop-blur border border-purple-800/50 rounded-xl px-3 py-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-purple-300 text-xs flex items-center gap-1">
              <Zap size={12} />Lv. {level}
            </span>
            <span className="text-purple-400 text-xs">{xpInLevel}/{xpForLevel}</span>
          </div>
          <div className="h-1.5 bg-purple-900/60 rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-gradient-to-r from-purple-500 to-violet-400 rounded-full"
              animate={{ width: `${xpPct}%` }}
              transition={{ duration: 0.5 }}
            />
          </div>
        </div>

        {/* Day + streak */}
        <div className="bg-stone-900/85 backdrop-blur border border-stone-700/50 rounded-xl px-3 py-1.5 flex gap-3">
          <span className="text-stone-300 text-xs flex items-center gap-1">
            <CalendarDays size={12} />Day {dayNumber}
          </span>
        </div>
      </div>

      {/* Near-building prompt — hidden when dialogue is open */}
      <AnimatePresence>
        {nearBuilding && !dialogueActive && (
          <motion.div
            key={nearBuilding}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="absolute bottom-8 left-1/2 -translate-x-1/2 z-20"
          >
            <button
              onClick={onBuildingInteract}
              className="bg-amber-600 hover:bg-amber-500 text-stone-900 font-bold text-sm px-5 py-2.5 rounded-full shadow-lg border border-amber-400 transition-colors flex items-center gap-2"
            >
              <span>⚔️</span>
              Enter {BUILDING_LABELS[nearBuilding] ?? nearBuilding}
              <kbd className="bg-amber-700/60 text-xs px-1.5 py-0.5 rounded">E</kbd>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Toast notifications */}
      <div className="absolute top-4 right-4 z-30 flex flex-col gap-2 items-end">
        <AnimatePresence>
          {toasts.map(t => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, x: 40 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 40 }}
              className={`px-3 py-2 rounded-lg text-sm font-medium shadow-lg border ${
                t.type === 'success' ? 'bg-green-900/90 border-green-600 text-green-300' :
                t.type === 'warn'    ? 'bg-red-900/90 border-red-600 text-red-300' :
                                      'bg-stone-800/90 border-stone-600 text-stone-300'
              }`}
            >
              {t.text}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </>
  )
}

function StatRow({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number; color: string }) {
  const prevRef = useRef(value)
  const [flash, setFlash] = useState(false)

  useEffect(() => {
    if (value !== prevRef.current) {
      prevRef.current = value
      setFlash(true)
      const t = setTimeout(() => setFlash(false), 400)
      return () => clearTimeout(t)
    }
  }, [value])

  return (
    <div className="flex items-center gap-2">
      {icon}
      <span className="text-stone-400 text-xs w-12">{label}</span>
      <motion.span
        animate={flash ? { scale: [1, 1.3, 1] } : {}}
        className={`text-sm font-bold ${color}`}
      >
        {value}
      </motion.span>
    </div>
  )
}

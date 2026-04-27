'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import Link from 'next/link'
import { ArrowLeft, Swords, Star } from 'lucide-react'

import { IsometricTown } from '@/components/game/student/IsometricTown'
import { SavingsBuckets } from '@/components/game/student/SavingsBuckets'
import { Ledger } from '@/components/game/student/Ledger'
import { useStudentStore } from '@/lib/student-store'
import { CHAPTERS, getChapterStatus } from '@/lib/student-chapters'
import { useGameStore } from '@/lib/game-store'

export default function StudentWorldPage() {
  const router = useRouter()
  const { character } = useGameStore()
  const {
    completedChapters,
    currentChapterId,
    gold,
    savings,
    emergency,
    debt,
    xp,
    level,
    dayNumber,
    ledger,
    roofRepaired,
    currentGoalLabel,
    currentGoalSaved,
    currentGoalTarget,
  } = useStudentStore()

  const [sidePanel, setSidePanel] = useState<'chapters' | 'ledger' | 'finance'>('chapters')
  const [hoveredChapter, setHoveredChapter] = useState<string | null>(null)

  const xpToNext = level * 200
  const xpPct = Math.min(100, (xp % xpToNext) / xpToNext * 100)

  function handleBuildingClick(_key: string, chapterNum?: number) {
    if (!chapterNum) return
    const chId = `ch${chapterNum}`
    const status = getChapterStatus(chId, completedChapters)
    if (status === 'available' || status === 'active') {
      router.push(`/game/student/chapter/${chId}`)
    }
  }

  const availableCount = CHAPTERS.filter(
    (ch) => getChapterStatus(ch.id, completedChapters) === 'available'
  ).length

  return (
    <div className="min-h-screen bg-[#080810] text-white flex flex-col" style={{ fontFamily: 'DM Sans, system-ui' }}>
      {/* Google fonts */}
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap');`}</style>

      {/* ── Top Nav ── */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-line-subtle bg-[#080810]/90 backdrop-blur sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <Link href="/game/dashboard"
            className="flex items-center gap-1.5 text-white/40 hover:text-white/70 transition-colors text-sm">
            <ArrowLeft className="w-4 h-4" />
            <span>Back</span>
          </Link>
          <div className="h-4 w-px bg-white/10" />
          <div className="flex items-center gap-2">
            <Swords className="w-4 h-4 text-amber-400" />
            <span className="font-bold text-amber-300 text-sm" style={{ fontFamily: 'Syne, serif' }}>
              Ashmarket
            </span>
            <span className="text-white/30 text-xs">·</span>
            <span className="text-white/50 text-xs">Student Stage</span>
          </div>
        </div>

        {/* Character summary */}
        <div className="flex items-center gap-4">
          {/* Gold */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/20">
            <span className="text-sm">🪙</span>
            <span className="font-bold font-mono text-amber-300 text-sm">{gold}</span>
            <span className="text-amber-400/50 text-xs">silver</span>
          </div>
          {/* Day */}
          <div className="flex items-center gap-1.5 text-white/40 text-xs">
            <span>🌙</span>
            <span>Day {dayNumber}</span>
          </div>
          {/* Level */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/5 border border-line-default">
            <Star className="w-3 h-3 text-amber-400" />
            <span className="text-xs font-bold text-white/80">Lv.{level}</span>
            <div className="w-16 h-1.5 bg-white/10 rounded-full overflow-hidden">
              <div className="h-full bg-amber-400 rounded-full" style={{ width: `${xpPct}%` }} />
            </div>
          </div>
          {/* Character name */}
          <div className="text-xs text-white/50">
            {character?.name ?? 'Apprentice'}
          </div>
        </div>
      </header>

      {/* ── Main Layout ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Left Panel: Chapter list / Finance / Ledger ── */}
        <aside className="w-72 shrink-0 border-r border-line-subtle flex flex-col bg-[#060910]">
          {/* Panel tabs */}
          <div className="flex border-b border-line-subtle">
            {([
              { id: 'chapters', label: 'Quests', emoji: '⚔️' },
              { id: 'finance', label: 'Treasury', emoji: '💰' },
              { id: 'ledger', label: 'Ledger', emoji: '📜' },
            ] as const).map((tab) => (
              <button
                key={tab.id}
                onClick={() => setSidePanel(tab.id)}
                className={`flex-1 py-2.5 text-xs font-semibold flex items-center justify-center gap-1 transition-colors ${
                  sidePanel === tab.id
                    ? 'text-amber-300 border-b-2 border-amber-500'
                    : 'text-white/35 hover:text-white/60 border-b-2 border-transparent'
                }`}
              >
                <span>{tab.emoji}</span>
                <span>{tab.label}</span>
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            <AnimatePresence mode="wait">

              {/* Chapters panel */}
              {sidePanel === 'chapters' && (
                <motion.div
                  key="chapters"
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0 }}
                  className="space-y-2"
                >
                  {/* Available indicator */}
                  {availableCount > 0 && (
                    <div className="rounded-xl bg-amber-500/10 border border-amber-500/25 px-3 py-2 flex items-center gap-2 mb-3">
                      <span className="animate-pulse text-amber-400">●</span>
                      <span className="text-xs text-amber-300 font-medium">
                        {availableCount} quest{availableCount > 1 ? 's' : ''} available
                      </span>
                    </div>
                  )}

                  {CHAPTERS.map((ch, i) => {
                    const status = getChapterStatus(ch.id, completedChapters)
                    const isLocked = status === 'locked'
                    const isCompleted = status === 'completed'
                    const isAvailable = status === 'available'

                    return (
                      <motion.button
                        key={ch.id}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.04 }}
                        onHoverStart={() => setHoveredChapter(ch.id)}
                        onHoverEnd={() => setHoveredChapter(null)}
                        onClick={() => isAvailable && router.push(`/game/student/chapter/${ch.id}`)}
                        disabled={isLocked}
                        className={`w-full text-left rounded-xl border p-3 transition-all ${
                          isAvailable
                            ? 'border-amber-500/35 bg-amber-500/8 hover:bg-amber-500/15 cursor-pointer'
                            : isCompleted
                            ? 'border-emerald-500/25 bg-emerald-500/5 cursor-default'
                            : 'border-line-subtle bg-white/2 cursor-not-allowed opacity-50'
                        }`}
                      >
                        <div className="flex items-start gap-2.5">
                          {/* Status icon */}
                          <div className={`mt-0.5 w-5 h-5 rounded-full shrink-0 flex items-center justify-center text-[10px] font-bold border ${
                            isCompleted ? 'bg-emerald-500/30 border-emerald-500/50 text-emerald-300'
                            : isAvailable ? 'bg-amber-500/30 border-amber-500/50 text-amber-300'
                            : 'bg-white/5 border-line-default text-white/30'
                          }`}>
                            {isCompleted ? '✓' : isLocked ? '🔒' : ch.number}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className={`text-xs font-bold truncate ${
                              isAvailable ? 'text-amber-200' : isCompleted ? 'text-emerald-300' : 'text-white/40'
                            }`}>
                              {ch.title}
                            </div>
                            <div className="text-[10px] text-white/35 truncate">{ch.subtitle}</div>
                            {isAvailable && (
                              <div className="text-[9px] text-amber-400/70 mt-0.5 flex items-center gap-1">
                                <span>+{ch.xpReward} XP</span>
                                {ch.goldReward > 0 && <span>· +{ch.goldReward}s</span>}
                                <span>· {ch.location}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </motion.button>
                    )
                  })}

                  {/* Progress summary */}
                  <div className="pt-3 border-t border-line-subtle">
                    <div className="flex items-center justify-between text-xs text-white/40 mb-2">
                      <span>Progress</span>
                      <span>{completedChapters.length} / {CHAPTERS.length}</span>
                    </div>
                    <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-amber-500 to-yellow-400 rounded-full transition-all duration-500"
                        style={{ width: `${(completedChapters.length / CHAPTERS.length) * 100}%` }}
                      />
                    </div>
                  </div>
                </motion.div>
              )}

              {/* Finance panel */}
              {sidePanel === 'finance' && (
                <motion.div
                  key="finance"
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0 }}
                >
                  <SavingsBuckets
                    gold={gold}
                    savings={savings}
                    emergency={emergency}
                    debt={debt}
                    goalLabel={currentGoalLabel}
                  />

                  {/* Goal meter mini */}
                  {currentGoalTarget > 0 && (
                    <div className="mt-4 rounded-xl bg-white/3 border border-line-subtle p-3">
                      <div className="flex items-center justify-between text-xs mb-2">
                        <span className="text-white/50">{currentGoalLabel}</span>
                        <span className="font-mono text-white/70">{currentGoalSaved}/{currentGoalTarget}s</span>
                      </div>
                      <div className="h-2.5 bg-white/5 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-sky-500 to-cyan-400 rounded-full"
                          style={{ width: `${Math.min(100, (currentGoalSaved / currentGoalTarget) * 100)}%` }}
                        />
                      </div>
                      {roofRepaired && (
                        <div className="mt-2 text-center text-xs text-emerald-400">🏠 Roof repaired!</div>
                      )}
                    </div>
                  )}
                </motion.div>
              )}

              {/* Ledger panel */}
              {sidePanel === 'ledger' && (
                <motion.div
                  key="ledger"
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0 }}
                >
                  <Ledger entries={ledger} maxRows={12} />
                </motion.div>
              )}

            </AnimatePresence>
          </div>
        </aside>

        {/* ── Center: Isometric Town ── */}
        <main className="flex-1 flex flex-col relative overflow-hidden">
          {/* Ambient effects */}
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute top-0 left-1/3 w-96 h-48 bg-amber-600/6 rounded-full blur-3xl" />
            <div className="absolute bottom-0 right-1/4 w-80 h-64 bg-blue-900/8 rounded-full blur-3xl" />
          </div>

          {/* Town instruction overlay */}
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/40 backdrop-blur-sm border border-line-default text-xs text-white/50">
              <span className="text-amber-400 animate-pulse">●</span>
              Click glowing buildings to begin a chapter
            </div>
          </div>

          {/* Isometric town */}
          <div className="flex-1 relative">
            <IsometricTown
              completedChapters={completedChapters}
              currentChapterId={currentChapterId}
              onBuildingClick={handleBuildingClick}
              className="absolute inset-0"
            />
          </div>

          {/* Bottom NPC hint bar */}
          {hoveredChapter && (() => {
            const ch = CHAPTERS.find((c) => c.id === hoveredChapter)
            if (!ch) return null
            return (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-3 px-4 py-2.5 rounded-2xl bg-[#0D1828]/95 border border-amber-500/30 backdrop-blur"
              >
                <span className="text-2xl">{ch.npcAvatar}</span>
                <div>
                  <div className="text-xs font-bold text-amber-300">{ch.title}</div>
                  <div className="text-[11px] text-white/50">{ch.npc} · {ch.location}</div>
                </div>
                <div className="ml-2 flex items-center gap-2">
                  <span className="text-xs text-amber-400/70">+{ch.xpReward} XP</span>
                  {ch.goldReward > 0 && <span className="text-xs text-yellow-400/70">+{ch.goldReward}s</span>}
                </div>
              </motion.div>
            )
          })()}
        </main>

        {/* ── Right Panel: Chapter detail / NPC info ── */}
        <aside className="w-64 shrink-0 border-l border-line-subtle bg-[#060910] p-4 flex flex-col gap-4">
          {/* Stage info */}
          <div className="rounded-xl bg-amber-500/8 border border-amber-500/20 p-3">
            <div className="text-[9px] text-amber-400/60 uppercase tracking-widest font-semibold mb-1">
              Current Stage
            </div>
            <div className="font-bold text-amber-300 text-sm" style={{ fontFamily: 'Syne, serif' }}>
              The Apprentice
            </div>
            <div className="text-[11px] text-amber-400/50 mt-0.5">Ages 0–18 · Ashmarket</div>
          </div>

          {/* XP progress */}
          <div className="rounded-xl bg-white/3 border border-line-subtle p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-white/50">Experience</span>
              <span className="font-mono text-xs text-amber-400">{xp} XP</span>
            </div>
            <div className="h-2 bg-white/5 rounded-full overflow-hidden mb-1">
              <div className="h-full bg-gradient-to-r from-amber-600 to-yellow-400 rounded-full transition-all"
                style={{ width: `${xpPct}%` }} />
            </div>
            <div className="flex justify-between text-[9px] text-white/30">
              <span>Level {level}</span>
              <span>{xpToNext - (xp % xpToNext)} to Lv.{level + 1}</span>
            </div>
          </div>

          {/* NPC directory */}
          <div>
            <div className="text-[9px] text-white/30 uppercase tracking-widest font-semibold mb-2">
              Ashmarket NPCs
            </div>
            <div className="space-y-1.5">
              {[
                { name: 'Merchant Rafiq', role: 'Trade & Pricing', emoji: '🧔', color: '#C27B2A' },
                { name: 'Master Elowen', role: 'Banking & Saving', emoji: '🏦', color: '#3A6BA8' },
                { name: 'Guild Tutor Sera', role: 'Budgeting & Education', emoji: '📚', color: '#3A7A50' },
                { name: 'Street Peddler Varn', role: 'Risk & Scams', emoji: '🦹', color: '#6A3A80' },
                { name: 'Miller Oswin', role: 'Investing & Ownership', emoji: '⚙️', color: '#8B6A3A' },
                { name: 'Headmaster Aldus', role: 'Graduation', emoji: '🎓', color: '#C9A84C' },
              ].map((npc) => (
                <div key={npc.name}
                  className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-white/3 border border-line-subtle">
                  <span className="text-base">{npc.emoji}</span>
                  <div className="min-w-0">
                    <div className="text-[10px] font-semibold text-white/70 truncate">{npc.name}</div>
                    <div className="text-[9px] text-white/35 truncate">{npc.role}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Achievements */}
          <div>
            <div className="text-[9px] text-white/30 uppercase tracking-widest font-semibold mb-2">
              Milestones
            </div>
            <div className="space-y-1">
              {[
                { label: 'Roof repaired', done: roofRepaired, emoji: '🏠' },
                { label: 'Guild Vault opened', done: completedChapters.includes('ch4'), emoji: '🏦' },
                { label: 'Scam rejected', done: completedChapters.includes('ch7'), emoji: '🛡️' },
                { label: 'First asset owned', done: completedChapters.includes('ch8'), emoji: '⚙️' },
                { label: 'Portfolio diversified', done: completedChapters.includes('ch9'), emoji: '📊' },
              ].map((m) => (
                <div key={m.label}
                  className={`flex items-center gap-2 text-[10px] px-2 py-1 rounded-lg ${
                    m.done ? 'text-emerald-400' : 'text-white/25'
                  }`}>
                  <span>{m.done ? '✓' : '○'}</span>
                  <span>{m.emoji}</span>
                  <span>{m.label}</span>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}

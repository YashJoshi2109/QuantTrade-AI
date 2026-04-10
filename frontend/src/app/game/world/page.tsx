'use client'

/**
 * Ashmarket World — Unified 3D Game + Story Experience
 * The world IS the story. Walk to NPCs, interact, make decisions.
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import dynamic from 'next/dynamic'
import { motion, AnimatePresence } from 'framer-motion'
import { useStudentStore } from '@/lib/student-store'
import { CHAPTERS } from '@/lib/student-chapters'
import { getAvailableChapter } from '@/components/game/world/BuildingMeshes'
import WorldHUD, { useWorldToasts } from '@/components/game/world/WorldHUD'
import { useFXSystem } from '@/components/game/world/FXSystem'
import { BUILDING_CONFIGS } from '@/components/game/world/BuildingMeshes'
import { NPC_CONFIGS } from '@/components/game/world/Characters'
import { X, ChevronRight, Scroll } from 'lucide-react'
import * as THREE from 'three'
import { playGameVoiceover, stopVoiceover, playGameSfx } from '@/lib/game-audio'

// Dynamic import — Three.js cannot run server-side
const AshmarketScene = dynamic(
  () => import('@/components/game/world/AshmarketScene'),
  { ssr: false, loading: () => <SceneLoader /> }
)

// ── Helpers ───────────────────────────────────────────────────────────────────

function getAvailableBuildings(completed: string[]): string[] {
  return BUILDING_CONFIGS
    .filter(b => getAvailableChapter(b.id, completed) !== null)
    .map(b => b.id)
}

function getBuildingPosition(buildingId: string): THREE.Vector3 {
  const b = BUILDING_CONFIGS.find(b => b.id === buildingId)
  return b ? new THREE.Vector3(b.position[0], b.position[1], b.position[2]) : new THREE.Vector3()
}

// ── Typewriter ────────────────────────────────────────────────────────────────

function TypewriterText({ text, speed = 38, onDone }: { text: string; speed?: number; onDone?: () => void }) {
  const [displayed, setDisplayed] = useState('')
  const idx = useRef(0)
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone

  useEffect(() => {
    idx.current = 0
    setDisplayed('')
    const interval = setInterval(() => {
      idx.current++
      setDisplayed(text.slice(0, idx.current))
      if (idx.current >= text.length) {
        clearInterval(interval)
        onDoneRef.current?.()
      }
    }, speed)
    return () => clearInterval(interval)
  }, [text, speed])

  const done = displayed.length >= text.length

  return (
    <p className="text-stone-100 text-sm leading-relaxed tracking-wide">
      {displayed}
      {!done && <span className="animate-pulse text-amber-400 ml-0.5">▌</span>}
    </p>
  )
}

// ── Dialogue overlay ──────────────────────────────────────────────────────────

interface DialogueState {
  chapter: (typeof CHAPTERS)[0]
  lineIndex: number
  phase: 'story' | 'lesson' | 'choices'
  npcLabel: string
  npcEmoji: string
}

function DialogueOverlay({
  state,
  onAdvance,
  onChoose,
  onClose,
}: {
  state: DialogueState
  onAdvance: () => void
  onChoose: (idx: number) => void
  onClose: () => void
}) {
  const { chapter, lineIndex, phase, npcLabel, npcEmoji } = state
  const [typeDone, setTypeDone] = useState(false)
  const [typeSpeed, setTypeSpeed] = useState(38) // ms per char, synced to audio
  const lastSpoken = useRef<string>('')

  useEffect(() => { setTypeDone(false) }, [lineIndex, phase])

  // Play Voiceover + sync typewriter speed to audio duration
  useEffect(() => {
    const text = phase === 'story' ? chapter.storyLines[lineIndex]?.text : chapter.lesson
    if (!text) return
    const cacheKey = `${chapter.id}-${phase}-${lineIndex}`

    // Prevent strict-mode double-fire
    if (lastSpoken.current === cacheKey) return
    lastSpoken.current = cacheKey

    // Stop any previous voice before starting new one
    stopVoiceover()

    const voiceRole = phase === 'story' ? 'character' as const : 'narrator' as const
    const avatarStyle = phase === 'story' ? 'sage' : undefined

    playGameVoiceover({ text, role: voiceRole, avatarStyle })
      .then((durationMs) => {
        // Sync: typewriter should finish just before audio ends
        // speed = duration / num_chars, with min/max bounds
        const charSpeed = Math.max(25, Math.min(65, Math.floor(durationMs / text.length)))
        setTypeSpeed(charSpeed)
      })
      .catch(() => {
        setTypeSpeed(38) // Fallback speed
      })

    return () => { stopVoiceover() }
  }, [chapter.id, lineIndex, phase]) // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault()
        if (phase !== 'choices') onAdvance()
      }
      if (e.code === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, onAdvance, onClose])

  const currentLine = chapter.storyLines[lineIndex]
  const progressPct = phase === 'choices' ? 100
    : Math.round(((lineIndex + (phase === 'lesson' ? chapter.storyLines.length : 0)) /
      (chapter.storyLines.length + 1)) * 100)

  return (
    <motion.div
      initial={{ opacity: 0, y: 80, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 60, scale: 0.97 }}
      transition={{ type: 'spring', damping: 22, stiffness: 280 }}
      className="absolute inset-x-0 bottom-0 z-40 p-4 md:p-6"
    >
      <div className="max-w-xl mx-auto" style={{ filter: 'drop-shadow(0 -4px 40px rgba(0,0,0,0.8))' }}>
        {/* Progress bar */}
        <div className="h-0.5 bg-stone-800 rounded-full mb-2 mx-1">
          <motion.div
            className="h-full bg-gradient-to-r from-amber-600 to-amber-400 rounded-full"
            animate={{ width: `${progressPct}%` }}
            transition={{ duration: 0.4 }}
          />
        </div>

        <div className="bg-stone-950/98 backdrop-blur-md border border-amber-900/40 rounded-2xl overflow-hidden shadow-2xl">
          {/* Header */}
          <div className="flex items-center gap-3 px-5 py-3 border-b border-stone-800/80 bg-stone-900/60">
            <span className="text-2xl leading-none">{npcEmoji}</span>
            <div className="flex-1 min-w-0">
              <p className="text-amber-300 font-bold text-sm leading-none">{npcLabel}</p>
              <p className="text-stone-500 text-xs mt-0.5 truncate">
                {chapter.location} · {chapter.title}
              </p>
            </div>
            <button onClick={onClose} className="text-stone-600 hover:text-stone-400 transition-colors p-1">
              <X size={14} />
            </button>
          </div>

          {/* Dialogue content */}
          <div className="px-5 py-4 min-h-[88px]">
            {phase === 'story' && currentLine && (
              <div>
                {currentLine.npc !== npcLabel && (
                  <p className="text-amber-500/70 text-xs mb-1 font-medium">{currentLine.npc}</p>
                )}
                <TypewriterText
                  key={`${chapter.id}-${lineIndex}-story`}
                  text={currentLine.text}
                  speed={typeSpeed}
                  onDone={() => setTypeDone(true)}
                />
              </div>
            )}
            {phase === 'lesson' && (
              <div className="flex gap-3">
                <div className="flex-shrink-0 mt-0.5">
                  <Scroll size={16} className="text-amber-400" />
                </div>
                <TypewriterText
                  key={`${chapter.id}-lesson`}
                  text={chapter.lesson}
                  speed={typeSpeed}
                  onDone={() => setTypeDone(true)}
                />
              </div>
            )}
            {phase === 'choices' && (
              <p className="text-amber-400/80 text-xs font-medium uppercase tracking-widest">
                What will you do?
              </p>
            )}
          </div>

          {/* Action area */}
          {phase !== 'choices' ? (
            <div
              className="px-5 pb-4 flex items-center justify-between cursor-pointer"
              onClick={onAdvance}
            >
              <p className="text-stone-600 text-xs">Space / Click to continue</p>
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.96 }}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold transition-all ${
                  typeDone
                    ? 'bg-amber-700 hover:bg-amber-600 text-stone-100'
                    : 'bg-stone-800 text-stone-500'
                }`}
              >
                {phase === 'story' && lineIndex >= chapter.storyLines.length - 1 ? 'The Lesson' : 'Continue'}
                <ChevronRight size={14} />
              </motion.button>
            </div>
          ) : (
            <div className="px-4 pb-4 space-y-2">
              {chapter.choices.map((choice, idx) => (
                <motion.button
                  key={choice.id}
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.08 }}
                  whileHover={{ scale: 1.015, x: 3 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => onChoose(idx)}
                  className={`w-full text-left px-4 py-3 rounded-xl border text-sm transition-all group ${
                    choice.isOptimal
                      ? 'border-green-800/60 bg-green-950/50 text-green-200 hover:bg-green-900/60 hover:border-green-700/70'
                      : 'border-stone-700/50 bg-stone-900/50 text-stone-300 hover:bg-stone-800/60 hover:border-stone-600/60'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 text-xs opacity-50 font-mono">{String.fromCharCode(65 + idx)}</span>
                    <span>{choice.label}</span>
                  </div>
                </motion.button>
              ))}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  )
}

// ── Outcome flash ─────────────────────────────────────────────────────────────

function OutcomeFlash({ data, onDone }: { data: { xp: number; gold: number; optimal: boolean } | null; onDone: () => void }) {
  useEffect(() => {
    if (!data) return
    const t = setTimeout(onDone, 2800)
    return () => clearTimeout(t)
  }, [data, onDone])

  if (!data) return null

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9, y: -10 }}
      className="absolute inset-0 flex items-center justify-center z-50 pointer-events-none"
    >
      <div className={`text-center px-8 py-6 rounded-3xl border shadow-2xl ${
        data.optimal
          ? 'bg-green-950/90 border-green-700/60'
          : 'bg-stone-900/90 border-stone-700/60'
      }`}>
        <motion.div
          initial={{ scale: 0.5 }}
          animate={{ scale: [0.5, 1.2, 1] }}
          transition={{ duration: 0.4 }}
          className="text-5xl mb-3"
        >
          {data.optimal ? '⭐' : '✓'}
        </motion.div>
        <p className={`font-black text-lg ${data.optimal ? 'text-green-300' : 'text-stone-300'}`}>
          {data.optimal ? 'Optimal Choice!' : 'Decision Made'}
        </p>
        <div className="flex gap-4 mt-3 justify-center">
          {data.xp > 0 && (
            <span className="text-purple-300 font-bold">+{data.xp} XP</span>
          )}
          {data.gold !== 0 && (
            <span className={data.gold > 0 ? 'text-yellow-300 font-bold' : 'text-red-300 font-bold'}>
              {data.gold > 0 ? '+' : ''}{data.gold} 🪙
            </span>
          )}
        </div>
      </div>
    </motion.div>
  )
}

// ── Main world page ───────────────────────────────────────────────────────────

export default function WorldPage() {
  const {
    completedChapters,
    setCurrentChapter,
    applyChoiceResult,
    completeChapter,
    advanceDay,
  } = useStudentStore()

  const [dialogue, setDialogue] = useState<DialogueState | null>(null)
  const [nearBuilding, setNearBuilding] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<{ xp: number; gold: number; optimal: boolean } | null>(null)
  const { toasts, addToast } = useWorldToasts()
  const fxRef = useRef<ReturnType<typeof useFXSystem> | null>(null)
  
  const availableBuildings = getAvailableBuildings(completedChapters)

  // ── Enter World / Ambient Sound ─────────────────────────────────────────────
  useEffect(() => {
    playGameSfx('welcome').catch(() => {})
    const t = setTimeout(() => {
      playGameSfx('ambient').catch(() => {})
    }, 2000)
    return () => clearTimeout(t)
  }, [])

  // ── Start chapter ───────────────────────────────────────────────────────────

  const startChapter = useCallback((buildingId: string) => {
    const chId = getAvailableChapter(buildingId, completedChapters)
    if (!chId) return
    const chapter = CHAPTERS.find(c => c.id === chId)
    if (!chapter) return

    // Find NPC for this building
    const npcConf = NPC_CONFIGS.find(n => n.buildingId === buildingId)
    const npcLabel = npcConf?.label ?? chapter.npc
    const npcEmoji = chapter.npcAvatar

    setCurrentChapter(chId)
    setDialogue({ chapter, lineIndex: 0, phase: 'story', npcLabel, npcEmoji })
  }, [completedChapters, setCurrentChapter])

  // ── Advance dialogue ────────────────────────────────────────────────────────

  const handleAdvance = useCallback(() => {
    if (!dialogue) return

    if (dialogue.phase === 'story') {
      const nextLine = dialogue.lineIndex + 1
      if (nextLine < dialogue.chapter.storyLines.length) {
        setDialogue(prev => prev ? { ...prev, lineIndex: nextLine } : null)
      } else {
        setDialogue(prev => prev ? { ...prev, phase: 'lesson' } : null)
      }
    } else if (dialogue.phase === 'lesson') {
      setDialogue(prev => prev ? { ...prev, phase: 'choices' } : null)
    }
  }, [dialogue])

  // ── Make choice ─────────────────────────────────────────────────────────────

  const handleChoose = useCallback((choiceIdx: number) => {
    if (!dialogue) return
    const { chapter } = dialogue
    const choice = chapter.choices[choiceIdx]
    if (!choice) return

    applyChoiceResult({
      chapterId: chapter.id,
      goldDelta: choice.goldDelta,
      savingsDelta: choice.savingsDelta,
      emergencyDelta: choice.emergencyDelta,
      debtDelta: choice.debtDelta,
      xpReward: choice.xpReward,
      label: choice.label,
    })
    completeChapter(chapter.id)
    advanceDay()
    setCurrentChapter(null)

    // Spawn FX at building position
    const buildingId = NPC_CONFIGS.find(n => n.label === dialogue.npcLabel)?.buildingId
    const buildingPos = buildingId ? getBuildingPosition(buildingId) : new THREE.Vector3()
    fxRef.current?.spawnCoinBurst(buildingPos, choice.goldDelta > 0 ? 12 : 4)
    fxRef.current?.spawnXPText(buildingPos, choice.xpReward)
    if (!choice.isOptimal) fxRef.current?.spawnWarning(buildingPos)

    setOutcome({ xp: choice.xpReward, gold: choice.goldDelta, optimal: choice.isOptimal })
    setDialogue(null)
    addToast(`+${choice.xpReward} XP — ${chapter.title} complete!`, 'success')
    if (choice.isOptimal) addToast('Optimal choice! Great thinking.', 'success')
  }, [dialogue, applyChoiceResult, completeChapter, advanceDay, setCurrentChapter, addToast])

  // ── Near building interact (E key) ──────────────────────────────────────────

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.code === 'KeyE' && nearBuilding && !dialogue) {
        startChapter(nearBuilding)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [nearBuilding, dialogue, startChapter])

  return (
    <div className="relative w-full h-screen bg-stone-950 overflow-hidden" style={{ fontFamily: "'Palatino Linotype', Georgia, serif" }}>
      {/* 3D Canvas */}
      <AshmarketScene
        completedChapters={completedChapters}
        availableBuildings={availableBuildings}
        onBuildingClick={startChapter}
        onNPCClick={startChapter}
        onNearBuilding={setNearBuilding}
        fxRef={fxRef}
      />

      {/* HUD */}
      <WorldHUD
        toasts={toasts}
        nearBuilding={nearBuilding}
        onBuildingInteract={() => nearBuilding && startChapter(nearBuilding)}
        dialogueActive={dialogue !== null}
      />

      {/* Dialogue overlay */}
      <AnimatePresence>
        {dialogue && (
          <DialogueOverlay
            state={dialogue}
            onAdvance={handleAdvance}
            onChoose={handleChoose}
            onClose={() => { setDialogue(null); setCurrentChapter(null) }}
          />
        )}
      </AnimatePresence>

      {/* Outcome flash */}
      <AnimatePresence>
        {outcome && (
          <OutcomeFlash data={outcome} onDone={() => setOutcome(null)} />
        )}
      </AnimatePresence>

      {/* Keyboard hints (fade after 5s) */}
      <KeyboardHints />
    </div>
  )
}

function KeyboardHints() {
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    const t = setTimeout(() => setVisible(false), 6000)
    return () => clearTimeout(t)
  }, [])

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          className="absolute bottom-6 right-5 z-10 flex flex-col gap-1.5 items-end"
        >
          {[
            ['Click ground', 'Move'],
            ['E key / Click NPC', 'Interact'],
            ['Scroll', 'Zoom'],
          ].map(([key, action]) => (
            <div key={key} className="flex items-center gap-2 text-xs">
              <kbd className="bg-stone-800/80 text-stone-400 border border-stone-700 px-1.5 py-0.5 rounded text-[10px]">{key}</kbd>
              <span className="text-stone-500">{action}</span>
            </div>
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function SceneLoader() {
  return (
    <div className="w-full h-screen bg-stone-950 flex flex-col items-center justify-center gap-4">
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
        className="text-5xl"
      >
        ⚔️
      </motion.div>
      <div className="text-center">
        <p className="text-amber-400 font-bold text-lg">Summoning Ashmarket…</p>
        <p className="text-stone-500 text-sm mt-1">Lighting lanterns and waking merchants</p>
      </div>
    </div>
  )
}

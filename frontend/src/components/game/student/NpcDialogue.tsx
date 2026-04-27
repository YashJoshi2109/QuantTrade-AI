'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { NpcLine } from '@/lib/student-chapters'

interface NpcDialogueProps {
  lines: NpcLine[]
  npcColor: string
  onComplete: () => void
  autoAdvance?: boolean
}

const EMOTION_STYLES: Record<string, { border: string; bg: string; textColor: string }> = {
  neutral:    { border: 'border-line-default', bg: 'bg-white/5',         textColor: 'text-slate-200' },
  happy:      { border: 'border-amber-500/30', bg: 'bg-amber-500/8', textColor: 'text-amber-100' },
  warning:    { border: 'border-red-500/30',   bg: 'bg-red-500/8',   textColor: 'text-red-100'   },
  wise:       { border: 'border-blue-400/30',  bg: 'bg-blue-400/8',  textColor: 'text-blue-100'  },
  suspicious: { border: 'border-purple-500/30',bg: 'bg-purple-500/8',textColor: 'text-purple-100'},
}

function useTypewriter(text: string, speed = 28) {
  const [displayed, setDisplayed] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => {
    setDisplayed('')
    setDone(false)
    let i = 0
    const t = setInterval(() => {
      i++
      setDisplayed(text.slice(0, i))
      if (i >= text.length) {
        clearInterval(t)
        setDone(true)
      }
    }, speed)
    return () => clearInterval(t)
  }, [text, speed])

  return { displayed, done }
}

export function NpcDialogue({ lines, npcColor, onComplete, autoAdvance = false }: NpcDialogueProps) {
  const [lineIndex, setLineIndex] = useState(0)
  const currentLine = lines[lineIndex]!
  const { displayed, done } = useTypewriter(currentLine.text)
  const style = EMOTION_STYLES[currentLine.emotion] ?? EMOTION_STYLES.neutral!
  const isLast = lineIndex === lines.length - 1

  function advance() {
    if (!done) return // wait for typewriter
    if (isLast) {
      onComplete()
    } else {
      setLineIndex((i) => i + 1)
    }
  }

  useEffect(() => {
    if (autoAdvance && done) {
      const t = setTimeout(advance, 1800)
      return () => clearTimeout(t)
    }
  }, [done, autoAdvance])

  return (
    <div className="space-y-3">
      {/* Progress dots */}
      {lines.length > 1 && (
        <div className="flex items-center gap-1.5 justify-center">
          {lines.map((_, i) => (
            <div
              key={i}
              className={`h-1 rounded-full transition-all duration-300 ${
                i === lineIndex ? 'w-6 bg-amber-400' : i < lineIndex ? 'w-2 bg-amber-400/40' : 'w-2 bg-white/10'
              }`}
            />
          ))}
        </div>
      )}

      <AnimatePresence mode="wait">
        <motion.div
          key={lineIndex}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.3 }}
          className={`rounded-2xl border p-4 ${style.border} ${style.bg}`}
        >
          {/* NPC header */}
          <div className="flex items-center gap-2.5 mb-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0 border border-line-default"
              style={{ backgroundColor: `${npcColor}30` }}
            >
              {currentLine.avatar}
            </div>
            <div>
              <div className="text-xs font-bold uppercase tracking-widest" style={{ color: npcColor }}>
                {currentLine.npc}
              </div>
              <div className="text-[10px] text-white/30 capitalize">{currentLine.emotion}</div>
            </div>
            {/* Emotion indicator */}
            <div className="ml-auto flex items-center gap-1">
              {currentLine.emotion === 'warning' && <span className="text-red-400 text-sm">⚠️</span>}
              {currentLine.emotion === 'wise'    && <span className="text-blue-400 text-sm">💡</span>}
              {currentLine.emotion === 'happy'   && <span className="text-amber-400 text-sm">✨</span>}
              {currentLine.emotion === 'suspicious' && <span className="text-purple-400 text-sm">👁️</span>}
            </div>
          </div>

          {/* Dialogue text with typewriter */}
          <p className={`text-sm leading-relaxed min-h-[3rem] ${style.textColor}`}
             style={{ fontFamily: 'DM Sans, system-ui, sans-serif' }}>
            "{displayed}
            {!done && <span className="animate-pulse">|</span>}"
          </p>

          {/* Advance button */}
          <div className="mt-3 flex justify-end">
            <button
              onClick={advance}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                done
                  ? 'bg-amber-500/20 border border-amber-500/40 text-amber-300 hover:bg-amber-500/30 cursor-pointer'
                  : 'bg-white/5 border border-line-default text-white/30 cursor-wait'
              }`}
            >
              {!done ? (
                <span className="animate-pulse">Reading...</span>
              ) : isLast ? (
                <>Continue <span>→</span></>
              ) : (
                <>Next <span>→</span></>
              )}
            </button>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

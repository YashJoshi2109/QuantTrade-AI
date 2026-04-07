'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { useGameStore } from '@/lib/game-store'
import { gameApi } from '@/lib/game-api'
import { playGameSfx, playGameVoiceover } from '@/lib/game-audio'

const AVATARS = [
  { id: 'knight', emoji: '🛡️', label: 'Knight', desc: 'Disciplined warrior of the markets' },
  { id: 'scholar', emoji: '📜', label: 'Scholar', desc: 'Student of financial wisdom' },
  { id: 'merchant', emoji: '🪙', label: 'Merchant', desc: 'Master of trade and commerce' },
  { id: 'noble', emoji: '👑', label: 'Noble', desc: 'Ruler of a growing empire' },
  { id: 'sage', emoji: '🔮', label: 'Sage', desc: 'Ancient keeper of wealth secrets' },
]

const STAGE_META: Record<string, { color: string; realm: string; tagline: string }> = {
  student: { color: '#6ea4d8', realm: 'Schoolyard Kingdom', tagline: 'Every legend begins with a single coin.' },
  college: { color: '#48bb78', realm: "Merchant's Crossing", tagline: 'Your first paycheck is your first quest.' },
  early_career: { color: '#c9a84c', realm: 'Trade Citadel', tagline: 'Build your fortress of wealth.' },
  family: { color: '#e07b54', realm: 'Shire of Stability', tagline: 'Protect the realm you have built.' },
  mastery: { color: '#9b59b6', realm: 'Citadel of Mastery', tagline: 'Wisdom is the ultimate asset.' },
}

export default function OnboardingPage() {
  const router = useRouter()
  const { character, stageDisplay, stage, realm, storyArc, setBootstrap } = useGameStore()
  const [step, setStep] = useState(0)
  const [name, setName] = useState(character?.name || '')
  const [selectedAvatar, setSelectedAvatar] = useState(character?.avatar_style || 'knight')
  const [saving, setSaving] = useState(false)

  const meta = STAGE_META[stage] || STAGE_META.college

  const steps = [
    'welcome',
    'stage_reveal',
    'avatar',
    'name',
    'ready',
  ]

  const playNarration = async (text: string) => {
    try {
      await playGameVoiceover({ text, role: 'narrator', avatarStyle: selectedAvatar })
    } catch {
      // Optional enhancement; do not block onboarding.
    }
  }

  const handleFinish = async () => {
    setSaving(true)
    try {
      await gameApi.updateCharacter({ name, avatar_style: selectedAvatar })
      // Re-bootstrap to get fresh state
      const fresh = await gameApi.bootstrap()
      setBootstrap(fresh)
      router.replace('/game/dashboard')
    } catch {
      router.replace('/game/dashboard')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6">
      {/* Progress dots */}
      <div className="fixed top-8 flex gap-2">
        {steps.map((_, i) => (
          <div
            key={i}
            className="w-2 h-2 rounded-full transition-all duration-300"
            style={{ backgroundColor: i <= step ? meta.color : '#374151' }}
          />
        ))}
      </div>

      <AnimatePresence mode="wait">
        {/* Step 0: Welcome */}
        {step === 0 && (
          <motion.div
            key="welcome"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -30 }}
            className="text-center max-w-xl"
          >
            <div className="text-8xl mb-6">⚔️</div>
            <h1 className="text-4xl font-bold text-white mb-3">
              Welcome to <span style={{ color: meta.color }}>CoinRealm</span>
            </h1>
            <p className="text-gray-400 text-lg mb-3">
              "The Sims + Duolingo + AI Hedge Fund Mentor" for Finance
            </p>
            <p className="text-gray-500 text-sm mb-10">
              Build wealth, survive market storms, and master your financial destiny — one quest at a time.
            </p>
            <button
              onClick={() => {
                playGameSfx('loading').catch(() => {})
                setStep(1)
              }}
              className="px-8 py-4 rounded-xl text-black font-bold text-lg transition-all hover:scale-105 active:scale-95"
              style={{ backgroundColor: meta.color }}
            >
              Begin Your Adventure →
            </button>
          </motion.div>
        )}

        {/* Step 1: Stage reveal */}
        {step === 1 && (
          <motion.div
            key="stage"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.1 }}
            className="text-center max-w-xl"
          >
            <div className="text-sm tracking-widest uppercase mb-4" style={{ color: meta.color }}>
              Your Realm
            </div>
            <div
              className="inline-block px-6 py-3 rounded-xl mb-6 border"
              style={{ borderColor: `${meta.color}40`, backgroundColor: `${meta.color}10` }}
            >
              <span className="text-2xl font-bold" style={{ color: meta.color }}>
                {stageDisplay || 'The Apprentice'}
              </span>
            </div>
            <h2 className="text-3xl font-bold text-white mb-3">{realm || meta.realm}</h2>
            <p className="text-gray-400 text-lg mb-4 italic">"{meta.tagline}"</p>
            <div className="bg-white/5 border border-white/10 rounded-xl p-5 mb-10 text-left">
              <div className="text-xs text-gray-500 uppercase tracking-widest mb-2">Your Opening Scroll</div>
              <p className="text-gray-300 text-sm leading-relaxed">
                {storyArc?.narrative || 'Your financial adventure begins. Every great fortune starts with a single wise decision.'}
              </p>
            </div>
            <div className="flex gap-3 justify-center">
              <button onClick={() => setStep(0)} className="px-6 py-3 rounded-xl border border-white/10 text-gray-400 hover:text-white transition">
                ← Back
              </button>
              <button
                onClick={() => {
                  playGameSfx('click').catch(() => {})
                  setStep(2)
                }}
                className="px-8 py-3 rounded-xl text-black font-bold transition-all hover:scale-105"
                style={{ backgroundColor: meta.color }}
              >
                Choose Your Avatar →
              </button>
              <button onClick={() => playNarration(storyArc?.narrative || meta.tagline)} className="px-6 py-3 rounded-xl border border-white/10 text-gray-300 hover:text-white transition">
                🔊 Hear Story
              </button>
            </div>
          </motion.div>
        )}

        {/* Step 2: Avatar selection */}
        {step === 2 && (
          <motion.div
            key="avatar"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -30 }}
            className="text-center max-w-2xl w-full"
          >
            <h2 className="text-3xl font-bold text-white mb-2">Choose Your Avatar</h2>
            <p className="text-gray-500 mb-8">Who will walk the halls of wealth on your behalf?</p>
            <div className="grid grid-cols-5 gap-4 mb-10">
              {AVATARS.map((av) => (
                <button
                  key={av.id}
                  onClick={() => {
                    setSelectedAvatar(av.id as any)
                    playGameSfx('click').catch(() => {})
                    playGameVoiceover({
                      text: `${av.label} selected. ${av.desc}`,
                      role: 'character',
                      avatarStyle: av.id,
                    }).catch(() => {})
                  }}
                  className="flex flex-col items-center p-4 rounded-xl border-2 transition-all hover:scale-105"
                  style={{
                    borderColor: selectedAvatar === av.id ? meta.color : '#374151',
                    backgroundColor: selectedAvatar === av.id ? `${meta.color}15` : '#111827',
                  }}
                >
                  <div className="text-4xl mb-2">{av.emoji}</div>
                  <div className="text-xs font-bold text-white mb-1">{av.label}</div>
                  <div className="text-xs text-gray-500 leading-tight">{av.desc}</div>
                </button>
              ))}
            </div>
            <div className="flex gap-3 justify-center">
              <button onClick={() => setStep(1)} className="px-6 py-3 rounded-xl border border-white/10 text-gray-400 hover:text-white transition">
                ← Back
              </button>
              <button
                onClick={() => setStep(3)}
                className="px-8 py-3 rounded-xl text-black font-bold transition-all hover:scale-105"
                style={{ backgroundColor: meta.color }}
              >
                Name Your Hero →
              </button>
            </div>
          </motion.div>
        )}

        {/* Step 3: Name */}
        {step === 3 && (
          <motion.div
            key="name"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -30 }}
            className="text-center max-w-md w-full"
          >
            <div className="text-6xl mb-6">
              {AVATARS.find((a) => a.id === selectedAvatar)?.emoji || '⚔️'}
            </div>
            <h2 className="text-3xl font-bold text-white mb-2">Name Your Legend</h2>
            <p className="text-gray-500 mb-8">This name will be inscribed in the Hall of Wealth.</p>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter your hero's name..."
              maxLength={50}
              className="w-full px-5 py-4 rounded-xl bg-white/5 border border-white/10 text-white text-lg text-center placeholder-gray-600 focus:outline-none focus:border-amber-500/50 mb-10"
            />
            <div className="flex gap-3 justify-center">
              <button onClick={() => setStep(2)} className="px-6 py-3 rounded-xl border border-white/10 text-gray-400 hover:text-white transition">
                ← Back
              </button>
              <button
                onClick={() => setStep(4)}
                disabled={!name.trim()}
                className="px-8 py-3 rounded-xl text-black font-bold transition-all hover:scale-105 disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ backgroundColor: meta.color }}
              >
                Continue →
              </button>
            </div>
          </motion.div>
        )}

        {/* Step 4: Ready */}
        {step === 4 && (
          <motion.div
            key="ready"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="text-center max-w-md"
          >
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
              className="text-8xl mb-6"
            >
              {AVATARS.find((a) => a.id === selectedAvatar)?.emoji || '⚔️'}
            </motion.div>
            <h2 className="text-3xl font-bold text-white mb-2">
              Arise, <span style={{ color: meta.color }}>{name || 'Adventurer'}</span>!
            </h2>
            <p className="text-gray-400 mb-3">
              The realm of <strong style={{ color: meta.color }}>{realm || meta.realm}</strong> awaits.
            </p>
            <p className="text-gray-500 text-sm mb-10">
              Your treasury is stocked. Your first quests are assigned. The markets shall test your mettle.
            </p>
            <button
              onClick={handleFinish}
              disabled={saving}
              className="w-full py-4 rounded-xl text-black font-bold text-lg transition-all hover:scale-105 active:scale-95 disabled:opacity-60"
              style={{ backgroundColor: meta.color }}
            >
              {saving ? 'Entering the Realm...' : 'Enter the Kingdom ⚔️'}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

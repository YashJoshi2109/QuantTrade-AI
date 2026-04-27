'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { useGameStore } from '@/lib/game-store'
import { gameApi } from '@/lib/game-api'

const STAGE_COLORS: Record<string, string> = {
  student: '#6ea4d8',
  college: '#48bb78',
  early_career: '#c9a84c',
  family: '#e07b54',
  mastery: '#9b59b6',
}

const AVATAR_EMOJI: Record<string, string> = {
  knight: '🛡️', scholar: '📜', merchant: '🪙', noble: '👑', sage: '🔮',
}

const STAGE_DISPLAY: Record<string, { label: string; focus: string; systems: string }> = {
  student: { label: 'The Apprentice', focus: 'Awareness', systems: 'Earning basics' },
  college: { label: 'The Young Merchant', focus: 'First income', systems: 'Budgeting + investing' },
  early_career: { label: 'The Rising Knight', focus: 'Growth', systems: 'Portfolio building' },
  family: { label: 'The Lord of the Manor', focus: 'Stability', systems: 'Risk management' },
  mastery: { label: 'The Grand Archmage', focus: 'Optimization', systems: 'Advanced strategies' },
}

export default function CharacterPage() {
  const router = useRouter()
  const { bootstrapped, character, stage, stageDisplay, realm, setBootstrap, setLoading } = useGameStore()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (bootstrapped) return
    setLoading(true)
    gameApi.bootstrap().then(setBootstrap).catch((err: Error) => {
      if (err.message === 'UNAUTHENTICATED') router.replace('/auth?redirect=/game')
    })
  }, [])

  useEffect(() => {
    if (character?.name) setName(character.name)
  }, [character?.name])

  const accent = STAGE_COLORS[stage] || '#c9a84c'
  const stageMeta = STAGE_DISPLAY[stage] || STAGE_DISPLAY.college

  const handleSaveName = async () => {
    if (!name.trim()) return
    setSaving(true)
    try {
      await gameApi.updateCharacter({ name: name.trim() })
    } finally {
      setSaving(false)
      setEditing(false)
    }
  }

  const traits = character
    ? [
        { label: 'Financial Confidence', value: character.financial_confidence, icon: '💪', desc: 'How boldly you approach financial decisions' },
        { label: 'Discipline Score', value: character.discipline_score, icon: '⚖️', desc: 'Consistency and long-term thinking' },
        { label: 'Risk Appetite', value: character.risk_appetite, icon: '🎲', desc: 'Tolerance for market volatility' },
        { label: 'Savings Habit', value: character.savings_habit, icon: '🏦', desc: 'Tendency to save before spending' },
        { label: 'Emotional Resilience', value: character.emotional_resilience, icon: '🔰', desc: 'Ability to hold through drawdowns' },
        { label: 'Diversification', value: character.diversification_score, icon: '🌐', desc: 'Spread of assets across classes' },
      ]
    : []

  return (
    <div className="min-h-screen">
      <header className="border-b border-line-subtle bg-black/30 backdrop-blur-md px-6 py-4 flex items-center gap-4 sticky top-0 z-30">
        <Link href="/game/dashboard" className="text-fg-muted hover:text-fg-primary transition text-sm">← Dashboard</Link>
        <span className="text-fg-muted">|</span>
        <span style={{ color: accent }} className="font-bold text-sm">Character Scroll</span>
      </header>

      <div className="max-w-4xl mx-auto px-6 py-10">
        {/* Hero */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl p-8 mb-8 border relative overflow-hidden"
          style={{ borderColor: `${accent}30`, background: `linear-gradient(135deg, ${accent}08, transparent)` }}
        >
          <div className="absolute top-0 right-0 w-48 h-48 rounded-full blur-3xl opacity-15" style={{ backgroundColor: accent }} />
          <div className="flex items-center gap-8 relative">
            <div
              className="w-28 h-28 rounded-2xl flex items-center justify-center text-6xl border-2 shrink-0"
              style={{ borderColor: `${accent}40`, backgroundColor: `${accent}10` }}
            >
              {AVATAR_EMOJI[character?.avatar_style || 'knight']}
            </div>
            <div className="flex-1">
              {editing ? (
                <div className="flex items-center gap-3 mb-2">
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={50}
                    className="bg-white/5 border border-line-default rounded-lg px-4 py-2 text-white text-xl font-bold focus:outline-none focus:border-amber-500/50"
                  />
                  <button onClick={handleSaveName} disabled={saving} className="px-4 py-2 text-sm rounded-lg font-bold text-black" style={{ backgroundColor: accent }}>
                    {saving ? '...' : 'Save'}
                  </button>
                  <button onClick={() => setEditing(false)} className="px-4 py-2 text-sm rounded-lg border border-line-default text-fg-muted hover:text-fg-primary">
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-3 mb-2">
                  <h1 className="text-3xl font-bold text-white">{character?.name || 'Adventurer'}</h1>
                  <button onClick={() => setEditing(true)} className="text-fg-muted hover:text-fg-muted text-xs border border-line-default px-2 py-0.5 rounded">
                    edit
                  </button>
                </div>
              )}
              <div className="text-sm font-medium mb-1" style={{ color: accent }}>{stageMeta.label}</div>
              <div className="text-fg-muted text-xs mb-4">{realm}</div>
              <div className="flex gap-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-white">{character?.level}</div>
                  <div className="text-xs text-fg-muted">Level</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-white">{character?.streak_days}</div>
                  <div className="text-xs text-fg-muted">Day Streak 🔥</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold" style={{ color: accent }}>{character?.xp}</div>
                  <div className="text-xs text-fg-muted">XP Earned</div>
                </div>
              </div>
            </div>
          </div>
          {/* XP bar */}
          <div className="mt-6">
            <div className="flex justify-between text-xs mb-2 text-fg-muted">
              <span>XP Progress</span>
              <span>{character?.xp} / {character?.xp_to_next_level}</span>
            </div>
            <div className="h-2 bg-white/5 rounded-full overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(100, ((character?.xp ?? 0) / (character?.xp_to_next_level ?? 1)) * 100)}%` }}
                transition={{ duration: 1.2, ease: 'easeOut' }}
                className="h-full rounded-full"
                style={{ backgroundColor: accent }}
              />
            </div>
          </div>
        </motion.div>

        {/* Stage info */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          {[
            { label: 'Life Stage', value: stageMeta.label, icon: '🗡️' },
            { label: 'Gameplay Focus', value: stageMeta.focus, icon: '🎯' },
            { label: 'Core Systems', value: stageMeta.systems, icon: '⚙️' },
          ].map((card) => (
            <motion.div
              key={card.label}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white/3 border border-white/8 rounded-xl p-5 text-center"
            >
              <div className="text-2xl mb-2">{card.icon}</div>
              <div className="text-xs text-fg-muted mb-1">{card.label}</div>
              <div className="text-sm font-semibold text-white">{card.value}</div>
            </motion.div>
          ))}
        </div>

        {/* Trait radar */}
        <div className="bg-white/3 border border-white/8 rounded-2xl p-6">
          <h2 className="text-white font-bold text-lg mb-6 flex items-center gap-2">
            <span>🔮</span> Behavioral Profile
          </h2>
          <div className="grid grid-cols-2 gap-5">
            {traits.map((trait) => (
              <div key={trait.label}>
                <div className="flex justify-between items-center mb-1">
                  <div className="flex items-center gap-2">
                    <span>{trait.icon}</span>
                    <span className="text-sm text-fg-secondary">{trait.label}</span>
                  </div>
                  <span className="text-sm font-mono font-bold" style={{ color: accent }}>
                    {trait.value.toFixed(0)}/100
                  </span>
                </div>
                <div className="h-2 bg-white/5 rounded-full overflow-hidden mb-1">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${trait.value}%` }}
                    transition={{ duration: 1, ease: 'easeOut', delay: 0.1 }}
                    className="h-full rounded-full"
                    style={{ backgroundColor: accent }}
                  />
                </div>
                <p className="text-xs text-fg-muted">{trait.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Behavioral flags */}
        {character?.behavioral_profile && Object.keys(character.behavioral_profile).length > 0 && (
          <div className="mt-6 bg-white/3 border border-white/8 rounded-2xl p-6">
            <h2 className="text-white font-bold mb-4 flex items-center gap-2">
              <span>🧠</span> AI Behavior Patterns
            </h2>
            <div className="grid grid-cols-3 gap-4">
              {Object.entries(character.behavioral_profile).map(([key, val]) => (
                <div key={key} className="text-center p-3 bg-white/3 rounded-xl border border-line-subtle">
                  <div className="text-xl font-bold text-white mb-1">{Number(val).toFixed(0)}</div>
                  <div className="text-xs text-fg-muted capitalize">{key.replace(/_/g, ' ')}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

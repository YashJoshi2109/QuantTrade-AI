'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { useGameStore } from '@/lib/game-store'
import { gameApi } from '@/lib/game-api'
import { AssetGenerator } from '@/components/game/student/AssetGenerator'
import { playGameSfx, playGameVoiceover } from '@/lib/game-audio'

const STAGE_COLORS: Record<string, string> = {
  student: '#6ea4d8',
  college: '#48bb78',
  early_career: '#c9a84c',
  family: '#e07b54',
  mastery: '#9b59b6',
}

const AVATAR_EMOJI: Record<string, string> = {
  knight: '🛡️',
  scholar: '📜',
  merchant: '🪙',
  noble: '👑',
  sage: '🔮',
}

const CATEGORY_ICON: Record<string, string> = {
  saving: '💰',
  investing: '📈',
  budgeting: '📊',
  education: '📚',
  community: '🏰',
}

function formatCurrency(n: number): string {
  if (n >= 1_00_00_000) return `₹${(n / 1_00_00_000).toFixed(1)}Cr`
  if (n >= 1_00_000) return `₹${(n / 1_00_000).toFixed(1)}L`
  if (n >= 1_000) return `₹${(n / 1_000).toFixed(1)}K`
  return `₹${n.toFixed(0)}`
}

export default function GameDashboard() {
  const router = useRouter()
  const {
    bootstrapped, loading, error,
    character, wallet, missions, storyArc,
    stage, stageDisplay, realm,
    setBootstrap, setLoading, setError,
    awardXP, awardGold, updateMission,
  } = useGameStore()

  const [completing, setCompleting] = useState<number | null>(null)
  const [flashMsg, setFlashMsg] = useState<string | null>(null)

  // Bootstrap if not yet loaded
  useEffect(() => {
    if (bootstrapped) return
    playGameSfx('loading').catch(() => {})
    setLoading(true)
    gameApi.bootstrap()
      .then(setBootstrap)
      .catch((err: Error) => {
        if (err.message === 'UNAUTHENTICATED') router.replace('/auth?redirect=/game')
        else setError(err.message)
      })
  }, [])

  const accent = STAGE_COLORS[stage] || '#c9a84c'
  const activeMissions = missions.filter((m) => m.status === 'active')
  const xpPct = character ? Math.min(100, (character.xp / character.xp_to_next_level) * 100) : 0

  const handleComplete = async (missionId: number) => {
    setCompleting(missionId)
    try {
      const res = await gameApi.completeMission(missionId)
      updateMission(missionId, { status: 'completed', progress_pct: 100 })
      awardXP(res.xp_awarded)
      awardGold(res.gold_awarded)
      const msg = res.leveled_up
        ? `Level Up! You are now Level ${res.new_level}! +${res.xp_awarded} XP +${res.gold_awarded} Gold`
        : `Quest complete! +${res.xp_awarded} XP +${res.gold_awarded} Gold`
      setFlashMsg(msg)
      playGameSfx('mission_complete').catch(() => {})
      playGameVoiceover({
        text: msg,
        role: 'character',
        avatarStyle: character?.avatar_style,
      }).catch(() => {})
      setTimeout(() => setFlashMsg(null), 4000)
    } catch {
      // silently fail
    } finally {
      setCompleting(null)
    }
  }

  if (loading || !bootstrapped) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-2 border-t-amber-400 border-amber-500/20 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-amber-400/60 text-sm tracking-widest">Loading Kingdom...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-400 mb-4">{error}</p>
          <button onClick={() => window.location.reload()} className="px-6 py-2 bg-amber-600 rounded-lg text-black font-bold">
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      {/* Flash notification */}
      {flashMsg && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-6 py-3 rounded-xl border text-sm font-medium"
          style={{ backgroundColor: `${accent}20`, borderColor: `${accent}50`, color: accent }}
        >
          ✨ {flashMsg}
        </motion.div>
      )}

      {/* Top navigation bar */}
      <header className="border-b border-white/5 bg-black/30 backdrop-blur-md px-6 py-4 flex items-center justify-between sticky top-0 z-30">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-fg-muted hover:text-fg-primary transition text-sm">
            ← QuantTrade
          </Link>
          <span className="text-gray-700">|</span>
          <div className="flex items-center gap-2">
            <span style={{ color: accent }} className="text-lg">⚔️</span>
            <span className="font-bold text-white text-sm">CoinRealm</span>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <Link href="/game/character" className="text-fg-muted hover:text-fg-primary text-sm transition">
            Character
          </Link>
          <Link href="/game/community" className="text-fg-muted hover:text-fg-primary text-sm transition">
            Guild
          </Link>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10">
            <span className="text-yellow-400 text-sm">🪙</span>
            <span className="text-yellow-300 text-sm font-mono font-bold">{wallet?.gold_coins ?? 0}</span>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-8 grid grid-cols-12 gap-6">

        {/* ── Left: Character Card ─────────────────────────────── */}
        <div className="col-span-12 lg:col-span-3">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="bg-white/3 border border-white/8 rounded-2xl p-6 sticky top-24"
          >
            {/* Avatar */}
            <div className="text-center mb-5">
              <div
                className="w-20 h-20 mx-auto rounded-2xl flex items-center justify-center text-4xl mb-3 border-2"
                style={{ borderColor: `${accent}40`, backgroundColor: `${accent}10` }}
              >
                {AVATAR_EMOJI[character?.avatar_style || 'knight']}
              </div>
              <h2 className="text-white font-bold text-lg">{character?.name}</h2>
              <p className="text-xs tracking-widest uppercase mt-1" style={{ color: accent }}>
                {stageDisplay}
              </p>
              <p className="text-fg-muted text-xs mt-0.5">{realm}</p>
            </div>

            {/* Level + XP */}
            <div className="mb-5">
              <div className="flex justify-between text-xs mb-1">
                <span className="text-fg-muted">Level {character?.level}</span>
                <span className="text-fg-muted">{character?.xp} / {character?.xp_to_next_level} XP</span>
              </div>
              <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${xpPct}%` }}
                  transition={{ duration: 1, ease: 'easeOut' }}
                  className="h-full rounded-full"
                  style={{ backgroundColor: accent }}
                />
              </div>
            </div>

            {/* Trait bars */}
            {[
              { label: 'Confidence', value: character?.financial_confidence ?? 0, icon: '💪' },
              { label: 'Discipline', value: character?.discipline_score ?? 0, icon: '⚖️' },
              { label: 'Risk Appetite', value: character?.risk_appetite ?? 0, icon: '🎲' },
              { label: 'Savings Habit', value: character?.savings_habit ?? 0, icon: '🏦' },
              { label: 'Resilience', value: character?.emotional_resilience ?? 0, icon: '🔰' },
            ].map((trait) => (
              <div key={trait.label} className="mb-3">
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-fg-muted">{trait.icon} {trait.label}</span>
                  <span className="text-fg-muted">{trait.value.toFixed(0)}</span>
                </div>
                <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${trait.value}%`, backgroundColor: accent }}
                  />
                </div>
              </div>
            ))}

            {/* Streak */}
            <div className="mt-5 pt-4 border-t border-white/5 flex items-center justify-between text-xs">
              <span className="text-fg-muted">🔥 Streak</span>
              <span className="text-orange-400 font-bold">{character?.streak_days ?? 0} days</span>
            </div>
          </motion.div>
        </div>

        {/* ── Center: Main content ──────────────────────────────── */}
        <div className="col-span-12 lg:col-span-6 space-y-6">

          {/* Life Stages Progress */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl bg-white/3 border border-white/8 p-5"
          >
            <div className="text-xs tracking-widest uppercase text-fg-muted mb-4">Your Life Journey · 5 Stages</div>
            <div className="grid grid-cols-5 gap-2">
              {[
                { id: 'student', label: 'Apprentice', ages: '13–17', emoji: '📜', color: '#6ea4d8', href: '/game/world', live: true },
                { id: 'college', label: 'Young Merchant', ages: '18–25', emoji: '🪙', color: '#48bb78', href: null, live: false },
                { id: 'early_career', label: 'Guild Trader', ages: '26–35', emoji: '⚔️', color: '#c9a84c', href: null, live: false },
                { id: 'family', label: 'House Steward', ages: '36–45', emoji: '🏰', color: '#e07b54', href: null, live: false },
                { id: 'mastery', label: 'Royal Treasurer', ages: '46–65', emoji: '👑', color: '#9b59b6', href: null, live: false },
              ].map((s) => {
                const isCurrent = stage === s.id
                return (
                  <div
                    key={s.id}
                    className={`relative flex flex-col items-center p-3 rounded-xl border transition-all ${
                      s.live
                        ? 'border-white/15 bg-white/5 hover:border-white/25 cursor-pointer'
                        : 'border-white/5 bg-white/2 opacity-50'
                    } ${isCurrent ? 'ring-1 ring-offset-0' : ''}`}
                    style={isCurrent ? { borderColor: s.color } : {}}
                    onClick={() => s.href && (window.location.href = s.href)}
                  >
                    <span className="text-2xl mb-1.5">{s.emoji}</span>
                    <span className="text-[10px] font-bold text-white/70 text-center leading-tight">{s.label}</span>
                    <span className="text-[9px] text-white/30 mt-0.5">{s.ages}</span>
                    {s.live ? (
                      <span className="mt-1.5 text-[8px] px-1.5 py-0.5 rounded-full font-bold" style={{ backgroundColor: `${s.color}25`, color: s.color }}>
                        PLAY
                      </span>
                    ) : (
                      <span className="mt-1.5 text-[8px] px-1.5 py-0.5 rounded-full bg-white/5 text-white/25 font-bold">
                        SOON
                      </span>
                    )}
                  </div>
                )
              })}
            </div>

            {/* CTA to enter world */}
            <Link
              href="/game/world"
              className="mt-4 flex items-center justify-center gap-2 w-full py-3.5 rounded-xl font-bold text-sm transition-all hover:opacity-90 hover:scale-[1.01]"
              style={{ background: 'linear-gradient(135deg, #c9a84c, #e5b94e)', color: '#060B12' }}
            >
              ⚔️ Enter Ashmarket — Apprentice World
            </Link>
          </motion.div>

          {/* Story Arc Banner */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl p-6 border relative overflow-hidden"
            style={{ borderColor: `${accent}30`, backgroundColor: `${accent}08` }}
          >
            <div className="absolute top-0 right-0 w-32 h-32 rounded-full blur-3xl opacity-20" style={{ backgroundColor: accent }} />
            <div className="text-xs tracking-widest uppercase mb-2" style={{ color: accent }}>Active Story Arc</div>
            <h3 className="text-white text-xl font-bold mb-2">
              {storyArc?.id?.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) || 'The Beginning'}
            </h3>
            <p className="text-fg-muted text-sm leading-relaxed">
              {storyArc?.narrative || 'Your financial adventure begins.'}
            </p>
            <button
              onClick={() =>
                playGameVoiceover({
                  text: storyArc?.narrative || 'Your financial adventure begins.',
                  role: 'narrator',
                  avatarStyle: character?.avatar_style,
                }).catch(() => {})
              }
              className="mt-3 px-3 py-1.5 rounded-lg border border-white/10 text-xs text-gray-300 hover:text-fg-primary transition"
            >
              🔊 Play Story Voice
            </button>
          </motion.div>

          {/* Quests */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white font-bold text-lg flex items-center gap-2">
                <span>⚔️</span> Active Quests
              </h3>
              <span className="text-xs text-fg-muted bg-white/5 px-3 py-1 rounded-full border border-white/5">
                {activeMissions.length} active
              </span>
            </div>
            <div className="space-y-3">
              {activeMissions.length === 0 && (
                <div className="text-center py-10 text-fg-muted border border-dashed border-white/5 rounded-xl">
                  All quests complete! Check back tomorrow for new challenges.
                </div>
              )}
              {activeMissions.map((mission, i) => (
                <motion.div
                  key={mission.id}
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.08 }}
                  className="bg-white/3 border border-white/8 rounded-xl p-5 hover:border-white/15 transition-all"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-start gap-3 flex-1">
                      <div className="text-2xl mt-0.5">
                        {CATEGORY_ICON[mission.category] || '📋'}
                      </div>
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-white text-sm font-semibold">{mission.title}</span>
                          <span
                            className="text-xs px-2 py-0.5 rounded-full"
                            style={{ backgroundColor: `${accent}20`, color: accent }}
                          >
                            {mission.mission_type}
                          </span>
                        </div>
                        <p className="text-fg-muted text-xs leading-relaxed">{mission.description}</p>
                      </div>
                    </div>
                  </div>
                  {/* Progress */}
                  <div className="mb-3">
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-fg-muted">Progress</span>
                      <span style={{ color: accent }}>{mission.progress_pct}%</span>
                    </div>
                    <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{ width: `${mission.progress_pct}%`, backgroundColor: accent }}
                      />
                    </div>
                  </div>
                  {/* Footer */}
                  <div className="flex items-center justify-between">
                    <div className="flex gap-3 text-xs text-fg-muted">
                      <span>✨ {mission.xp_reward} XP</span>
                      <span>🪙 {mission.gold_reward} Gold</span>
                    </div>
                    <button
                      onClick={() => handleComplete(mission.id)}
                      disabled={completing === mission.id || mission.progress_pct < 100}
                      className="px-4 py-1.5 rounded-lg text-xs font-bold transition-all hover:scale-105 active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
                      style={{ backgroundColor: `${accent}30`, color: accent, border: `1px solid ${accent}40` }}
                    >
                      {completing === mission.id ? '...' : 'Complete'}
                    </button>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Right: Treasury ───────────────────────────────────── */}
        <div className="col-span-12 lg:col-span-3 space-y-4">
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="bg-white/3 border border-white/8 rounded-2xl p-5"
          >
            <div className="text-xs tracking-widest uppercase text-fg-muted mb-4">Royal Treasury</div>

            <div className="text-center mb-5">
              <div className="text-3xl font-bold text-white mb-0.5">
                {formatCurrency(wallet?.net_worth ?? 0)}
              </div>
              <div className="text-xs text-fg-muted">Net Worth</div>
            </div>

            <div className="space-y-3 text-sm">
              {[
                { label: 'Cash', value: wallet?.cash_balance ?? 0, icon: '💵', positive: true },
                { label: 'Invested', value: wallet?.total_invested ?? 0, icon: '📈', positive: true },
                { label: 'Emergency Fund', value: wallet?.emergency_fund ?? 0, icon: '🛡️', positive: true },
                { label: 'Monthly Income', value: wallet?.salary_monthly ?? 0, icon: '💼', positive: true },
                { label: 'Monthly Expenses', value: wallet?.monthly_expenses ?? 0, icon: '🏠', positive: false },
              ].map((row) => (
                <div key={row.label} className="flex justify-between items-center py-2 border-b border-white/5 last:border-0">
                  <span className="text-fg-muted text-xs">{row.icon} {row.label}</span>
                  <span className={`text-xs font-mono font-medium ${row.positive ? 'text-green-400' : 'text-red-400'}`}>
                    {formatCurrency(row.value)}
                  </span>
                </div>
              ))}
            </div>

            {/* Savings rate */}
            {wallet && wallet.salary_monthly > 0 && (
              <div className="mt-4 pt-4 border-t border-white/5">
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-fg-muted">Savings Rate</span>
                  <span style={{ color: accent }}>
                    {(((wallet.salary_monthly - wallet.monthly_expenses) / wallet.salary_monthly) * 100).toFixed(0)}%
                  </span>
                </div>
                <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.max(0, Math.min(100, ((wallet.salary_monthly - wallet.monthly_expenses) / wallet.salary_monthly) * 100))}%`,
                      backgroundColor: accent,
                    }}
                  />
                </div>
              </div>
            )}
          </motion.div>

          {/* AI Asset Generator */}
          <AssetGenerator compact />

          {/* Quick links */}
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Character', href: '/game/character', icon: '🛡️' },
              { label: 'Guild', href: '/game/community', icon: '🏰' },
            ].map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex flex-col items-center gap-2 p-4 bg-white/3 border border-white/8 rounded-xl hover:border-white/15 hover:bg-white/5 transition-all text-center"
              >
                <span className="text-2xl">{item.icon}</span>
                <span className="text-xs text-fg-muted font-medium">{item.label}</span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

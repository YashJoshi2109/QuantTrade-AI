'use client'

import { useEffect } from 'react'
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

const ICON_MAP: Record<string, string> = {
  scroll: '📜', coins: '🪙', sword: '⚔️', shield: '🛡️', crown: '👑', globe: '🌐',
}

export default function CommunityPage() {
  const router = useRouter()
  const { bootstrapped, communityGroups, stage, stageDisplay, character, setBootstrap, setLoading } = useGameStore()
  const accent = STAGE_COLORS[stage] || '#c9a84c'

  useEffect(() => {
    if (bootstrapped) return
    setLoading(true)
    gameApi.bootstrap().then(setBootstrap).catch((err: Error) => {
      if (err.message === 'UNAUTHENTICATED') router.replace('/auth?redirect=/game')
    })
  }, [])

  const stageGroup = communityGroups.find((g) => !g.is_global)
  const globalGroup = communityGroups.find((g) => g.is_global)

  return (
    <div className="min-h-screen">
      <header className="border-b border-line-subtle bg-black/30 backdrop-blur-md px-6 py-4 flex items-center gap-4 sticky top-0 z-30">
        <Link href="/game/dashboard" className="text-fg-muted hover:text-fg-primary transition text-sm">← Dashboard</Link>
        <span className="text-gray-700">|</span>
        <span style={{ color: accent }} className="font-bold text-sm">Guild Hall</span>
      </header>

      <div className="max-w-4xl mx-auto px-6 py-10">

        {/* Header */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-10">
          <div className="text-5xl mb-4">🏰</div>
          <h1 className="text-3xl font-bold text-white mb-2">The Guild Hall</h1>
          <p className="text-fg-muted text-sm max-w-md mx-auto">
            Every great knight learns from the fellowship. Share strategies, earn reputation, and grow together.
          </p>
        </motion.div>

        {/* My guilds */}
        <div className="space-y-4 mb-10">
          <h2 className="text-white font-bold text-lg flex items-center gap-2">
            <span>⚜️</span> Your Guilds
          </h2>
          {communityGroups.length === 0 && (
            <div className="text-center py-8 text-fg-muted border border-dashed border-line-subtle rounded-xl">
              Loading your guild memberships...
            </div>
          )}
          {communityGroups.map((group, i) => (
            <motion.div
              key={group.id}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
              className="bg-white/3 border border-line-subtle rounded-2xl p-6 hover:border-line-default transition-all"
            >
              <div className="flex items-start gap-5">
                {/* Icon */}
                <div
                  className="w-14 h-14 rounded-xl flex items-center justify-center text-2xl shrink-0 border"
                  style={{ borderColor: `${group.color}40`, backgroundColor: `${group.color}15` }}
                >
                  {ICON_MAP[group.icon] || '🏰'}
                </div>

                {/* Info */}
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-1">
                    <h3 className="text-white font-bold text-lg">{group.name}</h3>
                    {group.is_global && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-white/5 text-fg-muted border border-line-default">
                        Global
                      </span>
                    )}
                    {!group.is_global && (
                      <span className="text-xs px-2 py-0.5 rounded-full border" style={{ color: accent, borderColor: `${accent}40`, backgroundColor: `${accent}10` }}>
                        Your Stage
                      </span>
                    )}
                  </div>
                  <p className="text-fg-muted text-sm mb-4">{group.description}</p>
                  <div className="flex items-center gap-6 text-xs text-fg-muted">
                    <span>👥 {group.member_count} members</span>
                    {group.my_reputation !== undefined && (
                      <span>⭐ {group.my_reputation} reputation</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Guild features (coming soon) */}
              <div className="mt-5 pt-4 border-t border-line-subtle grid grid-cols-3 gap-3">
                {[
                  { label: 'Strategy Posts', icon: '📋', status: 'Soon' },
                  { label: 'Portfolio Share', icon: '📊', status: 'Soon' },
                  { label: 'Leaderboard', icon: '🏆', status: 'Soon' },
                ].map((feat) => (
                  <div
                    key={feat.label}
                    className="text-center p-3 bg-white/3 rounded-xl border border-line-subtle opacity-60"
                  >
                    <div className="text-lg mb-1">{feat.icon}</div>
                    <div className="text-xs text-fg-muted">{feat.label}</div>
                    <div className="text-xs text-gray-700 mt-0.5">{feat.status}</div>
                  </div>
                ))}
              </div>
            </motion.div>
          ))}
        </div>

        {/* All guilds directory */}
        <div>
          <h2 className="text-white font-bold text-lg mb-4 flex items-center gap-2">
            <span>📜</span> Guild Directory
          </h2>
          <div className="grid grid-cols-2 gap-4">
            {[
              { name: 'Apprentice Guild', stage: 'student', icon: '📜', color: '#6ea4d8', members: 0 },
              { name: "Merchant's Circle", stage: 'college', icon: '🪙', color: '#48bb78', members: 0 },
              { name: 'Knights of Capital', stage: 'early_career', icon: '⚔️', color: '#c9a84c', members: 0 },
              { name: 'The Noble Council', stage: 'family', icon: '🛡️', color: '#e07b54', members: 0 },
              { name: 'Archmage Conclave', stage: 'mastery', icon: '👑', color: '#9b59b6', members: 0 },
              { name: 'The Grand Tavern', stage: 'global', icon: '🌐', color: '#718096', members: 0 },
            ].map((g) => {
              const isMember = communityGroups.some((cg) => cg.name === g.name)
              return (
                <div
                  key={g.name}
                  className="bg-white/3 border border-line-subtle rounded-xl p-4 flex items-center gap-4"
                >
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center text-lg border shrink-0"
                    style={{ borderColor: `${g.color}40`, backgroundColor: `${g.color}15` }}
                  >
                    {g.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-white truncate">{g.name}</div>
                    <div className="text-xs text-fg-muted capitalize">{g.stage.replace(/_/g, ' ')}</div>
                  </div>
                  {isMember && (
                    <span className="text-xs text-green-400 border border-green-500/30 px-2 py-0.5 rounded-full shrink-0">
                      Joined
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* AI Community Bot teaser */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="mt-8 rounded-2xl p-6 border border-purple-500/20 bg-purple-900/8"
        >
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-purple-900/30 border border-purple-500/30 flex items-center justify-center text-2xl">
              🤖
            </div>
            <div>
              <h3 className="text-white font-bold mb-1">AI Community Moderator</h3>
              <p className="text-fg-muted text-sm">
                Financial misinformation filtering, strategy validation, and peer learning — powered by Claude.
                <span className="text-purple-400 ml-2">Coming in v1.1</span>
              </p>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  )
}

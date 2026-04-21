'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Users, Shield, Crown, Loader2 } from 'lucide-react'
import AppLayout from '@/components/AppLayout'

const API_URL = process.env.NEXT_PUBLIC_API_URL || ''

interface Member {
  user_id: number
  username: string
  avatar_url?: string | null
  role: string
  joined_at: string
}

const roleBadge: Record<string, { label: string; color: string; icon: typeof Crown }> = {
  owner: { label: 'Owner', color: 'text-amber-400 bg-amber-500/10', icon: Crown },
  moderator: { label: 'Mod', color: 'text-blue-400 bg-blue-500/10', icon: Shield },
  member: { label: 'Member', color: 'text-slate-400 bg-slate-500/10', icon: Users },
}

export default function CommunityMembersPage() {
  const { slug } = useParams<{ slug: string }>()
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [communityName, setCommunityName] = useState('')

  useEffect(() => {
    if (!slug) return
    setLoading(true)

    Promise.all([
      fetch(`${API_URL}/api/v1/communities/${slug}`, { credentials: 'include' })
        .then(r => r.ok ? r.json() : null)
        .catch(() => null),
      fetch(`${API_URL}/api/v1/communities/${slug}/members?limit=100`, { credentials: 'include' })
        .then(r => r.ok ? r.json() : { members: [] })
        .catch(() => ({ members: [] })),
    ]).then(([comm, data]) => {
      if (comm) setCommunityName(comm.name || slug)
      setMembers(data.items || data.members || [])
    }).finally(() => setLoading(false))
  }, [slug])

  const sorted = [...members].sort((a, b) => {
    const order: Record<string, number> = { owner: 0, moderator: 1, member: 2 }
    return (order[a.role] ?? 3) - (order[b.role] ?? 3)
  })

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto px-4 py-6">
        <Link
          href={`/community/${slug}`}
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-300 transition-colors mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to c/{communityName || slug}
        </Link>

        <div className="flex items-center gap-3 mb-6">
          <Users className="w-5 h-5 text-blue-400" />
          <h1 className="text-xl font-bold text-white">Members</h1>
          <span className="text-sm text-slate-500">({members.length})</span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 text-slate-500 animate-spin" />
          </div>
        ) : sorted.length === 0 ? (
          <div className="text-center py-16 text-slate-500 text-sm">
            No members found
          </div>
        ) : (
          <div className="space-y-1">
            {sorted.map((m) => {
              const badge = roleBadge[m.role] || roleBadge.member
              const Icon = badge.icon
              return (
                <Link
                  key={m.user_id}
                  href={`/community/user/${m.username}`}
                  className="flex items-center gap-3 px-4 py-3 rounded-xl bg-[#131820] hover:bg-[#161d27] transition-colors group"
                >
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500/30 to-cyan-500/30 flex items-center justify-center text-sm font-bold text-blue-400 shrink-0">
                    {m.username?.charAt(0).toUpperCase() || '?'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-slate-200 group-hover:text-white transition-colors truncate">
                      {m.username}
                    </div>
                    <div className="text-[10px] text-slate-600">
                      Joined {new Date(m.joined_at).toLocaleDateString()}
                    </div>
                  </div>
                  <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-md ${badge.color}`}>
                    <Icon className="w-3 h-3" />
                    {badge.label}
                  </span>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </AppLayout>
  )
}

'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { Plus, Users, ChevronRight, Loader2 } from 'lucide-react'
import { fetchCommunities, type Community } from '@/lib/api'

export default function CommunitySidebar() {
  const [communities, setCommunities] = useState<Community[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchCommunities()
      .then((data) => setCommunities(data.communities || []))
      .catch(() => setCommunities([]))
      .finally(() => setLoading(false))
  }, [])

  const myCommunities = communities.filter((c) => c.is_member)
  const suggested = communities.filter((c) => !c.is_member).slice(0, 5)

  return (
    <motion.div
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-4"
    >
      {/* My Communities */}
      <div className="bg-[#0D1117] border border-white/[0.06] rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">
            My Communities
          </h3>
          <Link
            href="/community/create"
            className="p-1 rounded-lg text-slate-500 hover:text-blue-400 hover:bg-blue-500/10 transition-colors"
            title="Create Community"
          >
            <Plus className="w-4 h-4" />
          </Link>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="w-5 h-5 text-slate-500 animate-spin" />
          </div>
        ) : myCommunities.length === 0 ? (
          <p className="text-xs text-slate-500 py-3 text-center">
            You haven&apos;t joined any communities yet.
          </p>
        ) : (
          <div className="space-y-1">
            {myCommunities.map((community) => (
              <Link
                key={community.slug}
                href={`/community/${community.slug}`}
                className="flex items-center gap-2.5 px-2 py-2 rounded-lg text-sm text-slate-300 hover:bg-white/[0.03] hover:text-white transition-colors group"
              >
                <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                <span className="truncate flex-1">{community.name}</span>
                <ChevronRight className="w-3.5 h-3.5 text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity" />
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Discover Communities */}
      {suggested.length > 0 && (
        <div className="bg-[#0D1117] border border-white/[0.06] rounded-xl p-4">
          <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider mb-3">
            Discover
          </h3>
          <div className="space-y-1">
            {suggested.map((community) => (
              <Link
                key={community.slug}
                href={`/community/${community.slug}`}
                className="flex items-center gap-2.5 px-2 py-2 rounded-lg text-sm text-slate-400 hover:bg-white/[0.03] hover:text-slate-200 transition-colors"
              >
                <Users className="w-4 h-4 text-slate-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="truncate">{community.name}</div>
                  <div className="text-xs text-slate-600">{community.member_count.toLocaleString()} members</div>
                </div>
              </Link>
            ))}
          </div>
          <Link
            href="/community/discover"
            className="block mt-3 text-center text-xs text-blue-400 hover:text-blue-300 transition-colors"
          >
            Browse all communities
          </Link>
        </div>
      )}
    </motion.div>
  )
}

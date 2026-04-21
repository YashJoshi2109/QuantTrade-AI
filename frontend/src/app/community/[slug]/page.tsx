'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { motion } from 'framer-motion'
import Link from 'next/link'
import { Users, Shield, ArrowLeft, Calendar, Settings } from 'lucide-react'
import { fetchCommunity, joinCommunity, leaveCommunity, normalizePosts, type Community, type CommunityPost } from '@/lib/api'
import PostCard from '@/components/community/PostCard'
import { FeedSkeleton } from '@/components/community/Skeletons'

const API_URL = process.env.NEXT_PUBLIC_API_URL || ''

export default function CommunityDetailPage() {
  const { slug } = useParams<{ slug: string }>()
  const [community, setCommunity] = useState<Community | null>(null)
  const [posts, setPosts] = useState<CommunityPost[]>([])
  const [loading, setLoading] = useState(true)
  const [joining, setJoining] = useState(false)

  useEffect(() => {
    if (!slug) return
    setLoading(true)
    Promise.all([
      fetchCommunity(slug),
      fetch(`${API_URL}/api/v1/communities/${slug}/posts?limit=20`, { credentials: 'include' })
        .then(r => r.ok ? r.json() : { items: [] })
        .catch(() => ({ items: [] }))
    ]).then(([comm, feedData]) => {
      setCommunity(comm)
      setPosts(normalizePosts(feedData.posts || feedData.items || []))
    }).finally(() => setLoading(false))
  }, [slug])

  const handleJoinLeave = async () => {
    if (!community) return
    setJoining(true)
    try {
      if (community.is_member) {
        await leaveCommunity(community.slug)
        setCommunity({ ...community, is_member: false, member_count: community.member_count - 1 })
      } else {
        await joinCommunity(community.slug)
        setCommunity({ ...community, is_member: true, member_count: community.member_count + 1 })
      }
    } catch { /* silent */ }
    setJoining(false)
  }

  if (loading) return (
    <div className="min-h-screen bg-[#0A0E14]">
      <div className="max-w-4xl mx-auto px-4 py-8"><FeedSkeleton /></div>
    </div>
  )

  if (!community) return (
    <div className="min-h-screen bg-[#0A0E14] flex items-center justify-center">
      <div className="text-center">
        <h2 className="text-xl font-bold text-slate-200 mb-2">Community not found</h2>
        <Link href="/community" className="text-cyan-400 hover:text-cyan-300 text-sm">Back to feed</Link>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-[#0A0E14]">
      {/* Banner */}
      <div className="h-28 bg-gradient-to-r from-cyan-900/20 to-blue-900/20 relative">
        {community.banner_url && (
          <img src={community.banner_url} alt="" className="w-full h-full object-cover" />
        )}
      </div>

      <div className="max-w-5xl mx-auto px-4 -mt-6">
        <div className="flex flex-col lg:flex-row gap-5">
          {/* Main Feed */}
          <div className="flex-1 min-w-0">
            {/* Community Header Card */}
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-[#131820] rounded-2xl p-5 mb-3"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-2">
                    <Link href="/community" className="text-slate-500 hover:text-slate-300 transition-colors">
                      <ArrowLeft className="w-4 h-4" />
                    </Link>
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-cyan-500/30 to-blue-500/30 flex items-center justify-center text-lg font-bold text-cyan-400 shrink-0">
                      {community.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <h1 className="text-xl font-bold text-white">c/{community.name}</h1>
                      <div className="flex items-center gap-3 text-xs text-slate-500 mt-0.5">
                        <span className="flex items-center gap-1">
                          <Users className="w-3 h-3" />
                          {community.member_count.toLocaleString()} members
                        </span>
                        <span className="px-1.5 py-0.5 bg-slate-800/60 rounded text-[10px]">{community.category}</span>
                        {community.ticker_focus && (
                          <span className="text-cyan-400 font-mono font-semibold">${community.ticker_focus}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  {community.description && (
                    <p className="text-sm text-slate-400 mt-2 ml-[52px]">{community.description}</p>
                  )}
                </div>
                <button
                  onClick={handleJoinLeave}
                  disabled={joining}
                  className={`px-5 py-2 rounded-full text-sm font-medium transition-all shrink-0 ${
                    community.is_member
                      ? 'bg-[#1a2130] text-slate-300 hover:bg-red-500/15 hover:text-red-400 border border-white/10'
                      : 'bg-blue-500 text-white hover:bg-blue-400'
                  }`}
                >
                  {joining ? '...' : community.is_member ? 'Joined' : 'Join'}
                </button>
              </div>
            </motion.div>

            {/* Posts */}
            {posts.length === 0 ? (
              <div className="text-center py-16 text-slate-500 bg-[#131820] rounded-2xl">
                <p className="text-sm">No posts yet in this community</p>
                <p className="text-xs text-slate-600 mt-1">Be the first to share something</p>
              </div>
            ) : (
              <div className="space-y-2">
                {posts.map(post => (
                  <PostCard key={post.id} post={post} />
                ))}
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="w-full lg:w-[300px] space-y-4">
            {/* About */}
            <div className="bg-[#131820] rounded-2xl p-4">
              <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-3 flex items-center gap-2">
                <Shield className="w-4 h-4 text-blue-400" /> About
              </h3>
              <p className="text-sm text-slate-400 mb-3">{community.description || 'No description'}</p>
              <div className="flex items-center gap-3 text-xs text-slate-500 mb-3">
                <span className="flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  Created {community.created_at ? new Date(community.created_at).toLocaleDateString() : 'recently'}
                </span>
              </div>
              <div className="flex items-center gap-3 text-xs text-slate-500 pt-3 border-t border-white/[0.06]">
                <div className="flex-1 text-center">
                  <div className="text-lg font-bold text-slate-200">{community.member_count.toLocaleString()}</div>
                  <div className="text-[10px] text-slate-500">Members</div>
                </div>
                <div className="flex-1 text-center">
                  <div className="text-lg font-bold text-slate-200">{posts.length}</div>
                  <div className="text-[10px] text-slate-500">Posts</div>
                </div>
              </div>
            </div>

            {/* Links */}
            <div className="bg-[#131820] rounded-2xl p-4 space-y-1">
              <Link href={`/community/${slug}/members`} className="block text-sm text-slate-400 hover:text-slate-200 py-1.5 transition-colors">
                View Members
              </Link>
              {community.is_member && (
                <>
                  <Link href="/community/moderation" className="block text-sm text-slate-400 hover:text-slate-200 py-1.5 transition-colors">
                    Moderation
                  </Link>
                  <Link href={`/community/${slug}/settings`} className="flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200 py-1.5 transition-colors">
                    <Settings className="w-3.5 h-3.5" /> Community Settings
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

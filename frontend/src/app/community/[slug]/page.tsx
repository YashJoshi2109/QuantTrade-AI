'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { motion } from 'framer-motion'
import Link from 'next/link'
import { Users, Shield, ArrowLeft, Calendar } from 'lucide-react'
import { fetchCommunity, joinCommunity, leaveCommunity, type Community, type CommunityPost } from '@/lib/api'
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
        .then(r => r.ok ? r.json() : { posts: [] })
        .catch(() => ({ posts: [] }))
    ]).then(([comm, feedData]) => {
      setCommunity(comm)
      setPosts(feedData.posts || [])
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
      <div className="h-32 bg-gradient-to-r from-cyan-900/30 to-blue-900/30 border-b border-white/[0.06]">
        {community.banner_url && (
          <img src={community.banner_url} alt="" className="w-full h-full object-cover" />
        )}
      </div>

      <div className="max-w-5xl mx-auto px-4 -mt-8">
        <div className="flex flex-col lg:flex-row gap-6">
          {/* Main Feed */}
          <div className="flex-1 min-w-0">
            {/* Community Header */}
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-[#0D1117] border border-white/[0.06] rounded-xl p-6 mb-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <Link href="/community" className="text-slate-500 hover:text-slate-300">
                      <ArrowLeft className="w-4 h-4" />
                    </Link>
                    <h1 className="text-2xl font-bold text-slate-100">{community.name}</h1>
                  </div>
                  <p className="text-sm text-slate-400 mb-3">{community.description}</p>
                  <div className="flex items-center gap-4 text-xs text-slate-500">
                    <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" /> {community.member_count.toLocaleString()} members</span>
                    <span className="px-2 py-0.5 bg-slate-800/50 rounded-full">{community.category}</span>
                    {community.ticker_focus && (
                      <span className="text-cyan-400 font-mono">${community.ticker_focus}</span>
                    )}
                  </div>
                </div>
                <button
                  onClick={handleJoinLeave}
                  disabled={joining}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    community.is_member
                      ? 'bg-slate-800 text-slate-300 hover:bg-red-500/20 hover:text-red-400 border border-white/10'
                      : 'bg-cyan-500 text-white hover:bg-cyan-400'
                  }`}
                >
                  {joining ? '...' : community.is_member ? 'Joined' : 'Join'}
                </button>
              </div>
            </motion.div>

            {/* Posts */}
            {posts.length === 0 ? (
              <div className="text-center py-12 text-slate-500">No posts yet in this community</div>
            ) : (
              <div className="space-y-3">
                {posts.map(post => (
                  <PostCard key={post.id} post={post} />
                ))}
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="w-full lg:w-72 space-y-4">
            {/* About */}
            <div className="bg-[#0D1117] border border-white/[0.06] rounded-xl p-4">
              <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider mb-3 flex items-center gap-2">
                <Shield className="w-4 h-4 text-blue-400" /> About
              </h3>
              <p className="text-sm text-slate-400 mb-3">{community.description || 'No description'}</p>
              <div className="flex items-center gap-1 text-xs text-slate-500">
                <Calendar className="w-3 h-3" />
                <span>Created {community.created_at ? new Date(community.created_at).toLocaleDateString() : 'recently'}</span>
              </div>
            </div>

            {/* Links */}
            <div className="bg-[#0D1117] border border-white/[0.06] rounded-xl p-4">
              <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider mb-2">Links</h3>
              <Link href={`/community/${slug}/members`} className="block text-sm text-slate-400 hover:text-slate-200 py-1">
                View Members ({community.member_count})
              </Link>
              {community.is_member && (
                <Link href="/community/moderation" className="block text-sm text-slate-400 hover:text-slate-200 py-1">
                  Moderation
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Bookmark, ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { fetchBookmarks, type CommunityPost } from '@/lib/api'
import PostCard from '@/components/community/PostCard'
import { FeedSkeleton } from '@/components/community/Skeletons'
import EmptyState from '@/components/community/EmptyStates'

export default function BookmarksPage() {
  const [posts, setPosts] = useState<CommunityPost[]>([])
  const [loading, setLoading] = useState(true)
  const [cursor, setCursor] = useState<number | null>(null)
  const [hasMore, setHasMore] = useState(true)

  const loadBookmarks = useCallback(async (nextCursor?: number) => {
    try {
      const data = await fetchBookmarks(nextCursor)
      if (nextCursor) {
        setPosts(prev => [...prev, ...data.posts])
      } else {
        setPosts(data.posts)
      }
      setCursor(data.next_cursor)
      setHasMore(!!data.next_cursor)
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadBookmarks() }, [loadBookmarks])

  return (
    <div className="min-h-screen bg-[#0A0E14]">
      <div className="max-w-3xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Link href="/community" className="text-slate-400 hover:text-slate-200 transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <Bookmark className="w-5 h-5 text-cyan-400" />
          <h1 className="text-xl font-bold text-slate-100">Saved Posts</h1>
        </div>

        {/* Content */}
        {loading ? (
          <FeedSkeleton />
        ) : posts.length === 0 ? (
          <EmptyState variant="no-posts" />
        ) : (
          <div className="space-y-3">
            {posts.map((post) => (
              <motion.div
                key={post.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <PostCard post={post} />
              </motion.div>
            ))}
            {hasMore && (
              <button
                onClick={() => cursor && loadBookmarks(cursor)}
                className="w-full py-3 text-sm text-slate-400 hover:text-slate-200 transition-colors"
              >
                Load more
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

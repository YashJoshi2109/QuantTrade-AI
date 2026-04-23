'use client'

import { useState, useCallback, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { ArrowLeft, Search, Loader2, X, MessageSquare, TrendingUp, TrendingDown, Minus, Clock } from 'lucide-react'
import AppLayout from '@/components/AppLayout'
import MobileLayout from '@/components/layout/MobileLayout'
import PostCard from '@/components/community/PostCard'
import { searchCommunity, fetchCommunities, type CommunityPost, type Community } from '@/lib/api'

function MobileCommunitySearchContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const initialQuery = searchParams?.get('q') || ''
  
  const [query, setQuery] = useState(initialQuery)
  const [loading, setLoading] = useState(false)
  const [posts, setPosts] = useState<CommunityPost[]>([])
  const [communities, setCommunities] = useState<Community[]>([])
  const [allCommunities, setAllCommunities] = useState<Community[]>([])
  const [hasSearched, setHasSearched] = useState(false)
  const [activeTab, setActiveTab] = useState<'posts' | 'communities'>('posts')

  // Load all communities for empty state
  useEffect(() => {
    fetchCommunities().then((d) => setAllCommunities(d.communities || [])).catch(() => {})
  }, [])

  const performSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setPosts([])
      setCommunities([])
      setHasSearched(false)
      return
    }
    setLoading(true)
    setHasSearched(true)
    
    // Update URL without full reload
    const url = new URL(window.location.href)
    url.searchParams.set('q', q)
    window.history.replaceState({}, '', url)

    try {
      const data = await searchCommunity(q)
      setPosts(data.posts || [])
      setCommunities(data.communities || [])
    } catch (err) {
      console.error('Search failed', err)
      setPosts([])
      setCommunities([])
    } finally {
      setLoading(false)
    }
  }, [])

  // Auto search on mount if ?q= is present
  useEffect(() => {
    if (initialQuery) {
      performSearch(initialQuery)
    }
  }, [initialQuery, performSearch])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    performSearch(query)
  }

  const content = (
    <div className="min-h-screen bg-[#0A0E1A] pb-safe flex flex-col">
        
        {/* Header / Search Bar */}
        <header className="sticky top-0 z-30 bg-[#0A0E1A]/95 backdrop-blur-xl border-b border-white/10 pt-safe">
          <div className="flex items-center gap-3 px-3 py-2.5">
            <button 
              onClick={() => router.back()}
              className="p-1.5 rounded-full text-slate-400 hover:text-white transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <form onSubmit={handleSubmit} className="flex-1 relative">
              <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                <Search className="w-4 h-4 text-slate-500" />
              </div>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search QuantTrade..."
                autoFocus
                className="w-full h-10 bg-[#1A2332] border border-white/10 rounded-full pl-9 pr-10 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => { setQuery(''); setPosts([]); setCommunities([]); setHasSearched(false) }}
                  className="absolute inset-y-0 right-3 flex items-center text-slate-500 hover:text-slate-300"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </form>
          </div>

          {/* Tabs */}
          {hasSearched && (
            <div className="flex px-4 mt-1 border-b border-white/5">
              <button
                onClick={() => setActiveTab('posts')}
                className={`flex-1 pb-3 text-sm font-medium transition-colors border-b-2 ${
                  activeTab === 'posts' ? 'border-blue-500 text-white' : 'border-transparent text-slate-400'
                }`}
              >
                Posts
              </button>
              <button
                onClick={() => setActiveTab('communities')}
                className={`flex-1 pb-3 text-sm font-medium transition-colors border-b-2 ${
                  activeTab === 'communities' ? 'border-blue-500 text-white' : 'border-transparent text-slate-400'
                }`}
              >
                Communities
              </button>
            </div>
          )}
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto px-2 pt-3">
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
            </div>
          ) : !hasSearched ? (
            <div className="space-y-3 pb-8">
              <h3 className="text-sm font-bold text-slate-300 px-2 uppercase tracking-wider mt-2">
                Browse Communities
              </h3>
              <div className="space-y-2 px-2">
                {allCommunities.length > 0 ? (
                  allCommunities.map((c) => (
                    <Link 
                      key={c.slug} 
                      href={`/community/${c.slug}`}
                      className="flex items-center gap-3 p-3 bg-[#131820] rounded-xl border border-white/5 active:bg-white/5"
                    >
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500/20 to-purple-500/20 flex items-center justify-center text-sm font-bold text-blue-400 shrink-0">
                        {c.icon || c.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-bold text-slate-200 truncate">c/{c.name}</h4>
                        <p className="text-xs text-slate-500 mt-0.5">{c.member_count.toLocaleString()} members</p>
                      </div>
                    </Link>
                  ))
                ) : (
                  <div className="flex justify-center py-8">
                    <Loader2 className="w-6 h-6 text-slate-600 animate-spin" />
                  </div>
                )}
              </div>
            </div>
          ) : (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              {activeTab === 'posts' && (
                <div className="space-y-2">
                  {posts.length > 0 ? (
                    posts.map((post, i) => (
                      <PostCard key={post.id} post={post} index={i} focused={false} />
                    ))
                  ) : (
                    <div className="text-center py-12 text-slate-400 text-sm">
                      No posts found for "{query}"
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'communities' && (
                <div className="space-y-2 px-2">
                  {communities.length > 0 ? (
                    communities.map((c) => (
                      <Link 
                        key={c.slug} 
                        href={`/community/${c.slug}`}
                        className="flex items-center gap-3 p-3 bg-[#131820] rounded-xl border border-white/5 active:bg-white/5"
                      >
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex items-center justify-center text-sm font-bold text-purple-400 shrink-0">
                          {c.icon || c.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="text-sm font-bold text-slate-200 truncate">c/{c.name}</h4>
                          <p className="text-xs text-slate-500 mt-0.5">{c.member_count.toLocaleString()} members</p>
                        </div>
                      </Link>
                    ))
                  ) : (
                    <div className="text-center py-12 text-slate-400 text-sm">
                      No communities found for "{query}"
                    </div>
                  )}
                </div>
              )}
            </motion.div>
          )}
        </main>
      </div>
  )

  return (
    <>
      <div className="hidden md:block">
        <AppLayout>{content}</AppLayout>
      </div>
      <div className="md:hidden">
        <MobileLayout>{content}</MobileLayout>
      </div>
    </>
  )
}

export default function MobileCommunitySearch() {
  return (
    <Suspense fallback={null}>
      <MobileCommunitySearchContent />
    </Suspense>
  )
}

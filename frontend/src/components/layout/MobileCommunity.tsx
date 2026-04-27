'use client'

import { useState, useCallback, useEffect, useRef, useMemo, Suspense } from 'react'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Flame, Clock, TrendingUp, Zap, Users, PenSquare,
  X, Loader2, Send, Search, MessageCircle,
  UserPlus, UserCheck, Hash, CheckCircle2,
  ImagePlus, ChevronDown, Eye, Pencil,
} from 'lucide-react'
import PostCard from '@/components/community/PostCard'
import { FeedSkeleton } from '@/components/community/Skeletons'
import EmptyState from '@/components/community/EmptyStates'
import { useToast } from '@/components/Toast'
import {
  fetchFeed,
  fetchPopularFeed,
  fetchCommunities,
  createPost,
  uploadImage,
  followUser,
  unfollowUser,
  joinCommunity,
  type CommunityPost,
  type Community,
} from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'

type SortTab = 'hot' | 'new' | 'top' | 'rising' | 'following'

const SORT_TABS: { key: SortTab; label: string; Icon: typeof Flame }[] = [
  { key: 'hot', label: '🔥 Hot', Icon: Flame },
  { key: 'new', label: '⚡ New', Icon: Clock },
  { key: 'top', label: '📈 Top', Icon: TrendingUp },
  { key: 'rising', label: '🚀 Rising', Icon: Zap },
  { key: 'following', label: '👥 Following', Icon: Users },
]

const MAX_BODY = 10_000
const DRAFT_KEY = 'qt:community:mobile:draft'

function extractTickers(text: string): string[] {
  const matches = text.match(/\$([A-Z]{1,5})/g) || []
  return Array.from(new Set(matches.map((m) => m.replace('$', ''))))
}

function renderMarkdownPreview(text: string): string {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong class="text-fg-primary">$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code class="px-1 py-0.5 bg-surface-raised rounded text-cyan-400 text-xs">$1</code>')
    .replace(/\n/g, '<br/>')
    .replace(/\$([A-Z]{1,5})/g, '<span class="px-1 py-0.5 text-xs font-mono font-semibold text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 rounded inline-block">$$1</span>')
}

export default function MobileCommunity() {
  const { success: toastSuccess, error: toastError } = useToast()
  const { user } = useAuth()

  // Feed state
  const [sort, setSort] = useState<SortTab>('hot')
  const [timeFilter, setTimeFilter] = useState('all')
  const [posts, setPosts] = useState<CommunityPost[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [cursor, setCursor] = useState<number | null>(null)
  const [hasMore, setHasMore] = useState(true)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const cursorRef = useRef<number | null>(null)

  // Create post sheet state
  const [showCreate, setShowCreate] = useState(false)
  const [createTitle, setCreateTitle] = useState('')
  const [createBody, setCreateBody] = useState('')
  const [createCommunity, setCreateCommunity] = useState('')
  const [createSentiment, setCreateSentiment] = useState('')
  const [creating, setCreating] = useState(false)
  const [communities, setCommunities] = useState<Community[]>([])
  const [bodyTab, setBodyTab] = useState<'write' | 'preview'>('write')
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Follow state
  const [followedUsers, setFollowedUsers] = useState<Set<number>>(new Set())
  const [followingUserId, setFollowingUserId] = useState<number | null>(null)

  const autoTickers = useMemo(() => extractTickers(createBody), [createBody])

  // Draft persistence
  useEffect(() => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY)
      if (saved) {
        const d = JSON.parse(saved)
        if (d.title) setCreateTitle(d.title)
        if (d.body) setCreateBody(d.body)
        if (d.community) setCreateCommunity(d.community)
        if (d.sentiment) setCreateSentiment(d.sentiment)
      }
    } catch {}
  }, [])

  useEffect(() => {
    if (!createTitle && !createBody) return
    const t = setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ title: createTitle, body: createBody, community: createCommunity, sentiment: createSentiment }))
      } catch {}
    }, 500)
    return () => clearTimeout(t)
  }, [createTitle, createBody, createCommunity, createSentiment])

  // Load communities
  useEffect(() => {
    fetchCommunities().then((d) => setCommunities(d.communities || [])).catch(() => {})
  }, [])

  // Load feed
  const loadFeed = useCallback(async (sortKey: SortTab, reset = true, time = 'all') => {
    if (reset) {
      setLoading(true); setPosts([]); setCursor(null); cursorRef.current = null; setHasMore(true)
    } else {
      setLoadingMore(true)
    }
    try {
      const c = reset ? undefined : (cursorRef.current ?? undefined)
      const data = sortKey === 'following'
        ? await fetchFeed('hot', c, 15, time)
        : await fetchPopularFeed(c, 15, sortKey, time)
      const newPosts = data.posts || []
      if (reset) setPosts(newPosts)
      else setPosts((prev) => [...prev, ...newPosts])
      cursorRef.current = data.next_cursor
      setCursor(data.next_cursor)
      setHasMore(!!data.next_cursor)
    } catch {
      toastError('Failed to load posts')
    } finally {
      setLoading(false); setLoadingMore(false)
    }
  }, [toastError])

  useEffect(() => { loadFeed(sort, true, timeFilter) }, [sort, timeFilter])

  // Infinite scroll
  useEffect(() => {
    if (!sentinelRef.current) return
    const obs = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && hasMore && !loadingMore && !loading) {
        loadFeed(sort, false, timeFilter)
      }
    }, { rootMargin: '200px' })
    obs.observe(sentinelRef.current)
    return () => obs.disconnect()
  }, [hasMore, loadingMore, loading, sort, timeFilter, loadFeed])

  const handleFollowUser = useCallback(async (userId: number) => {
    const isFollowing = followedUsers.has(userId)
    setFollowingUserId(userId)
    setFollowedUsers((prev) => { const n = new Set(prev); isFollowing ? n.delete(userId) : n.add(userId); return n })
    try {
      const ok = isFollowing ? await unfollowUser(userId) : await followUser(userId)
      if (!ok) {
        setFollowedUsers((prev) => { const n = new Set(prev); isFollowing ? n.add(userId) : n.delete(userId); return n })
        toastError('Failed to update follow status')
      } else {
        toastSuccess(isFollowing ? 'Unfollowed' : 'Now following!')
      }
    } catch {
      setFollowedUsers((prev) => { const n = new Set(prev); isFollowing ? n.add(userId) : n.delete(userId); return n })
      toastError('Failed to update follow status')
    } finally {
      setFollowingUserId(null)
    }
  }, [followedUsers, toastSuccess, toastError])

  const handleCreate = async () => {
    if (!createTitle.trim() || !createCommunity) return
    setCreating(true)
    try {
      // Auto-join community if not a member
      try { await joinCommunity(createCommunity) } catch {}

      let mediaUrls: string[] | undefined
      if (imageFile) {
        const uploaded = await uploadImage(imageFile)
        mediaUrls = [uploaded.url]
      }
      const newPost = await createPost({
        title: createTitle.trim(),
        body: createBody.trim(),
        community_slug: createCommunity,
        tickers: autoTickers.length > 0 ? autoTickers : undefined,
        sentiment: createSentiment || undefined,
        ...(mediaUrls ? { media_urls: mediaUrls } : {}),
      } as any)
      setPosts((prev) => [newPost, ...prev])
      toastSuccess('Post created!')
      setShowCreate(false)
      setCreateTitle(''); setCreateBody(''); setCreateCommunity(''); setCreateSentiment('')
      setImageFile(null); setImagePreview(null); setBodyTab('write')
      try { localStorage.removeItem(DRAFT_KEY) } catch {}
    } catch {
      toastError('Failed to create post. Please try again.')
    } finally {
      setCreating(false)
    }
  }

  const handleToast = useCallback((msg: string, type?: string) => {
    type === 'error' ? toastError(msg) : toastSuccess(msg)
  }, [toastSuccess, toastError])

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImageFile(file)
    const reader = new FileReader()
    reader.onload = (ev) => setImagePreview(ev.target?.result as string)
    reader.readAsDataURL(file)
  }

  return (
    <div className="space-y-0 pb-4">
      {/* ── Sticky Header ── */}
      <header className="sticky top-0 z-30 bg-surface-base/95 backdrop-blur-xl border-b border-line-subtle pt-safe">
        <div className="flex items-center justify-between px-4 py-2.5">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-500/20 to-purple-500/20 border border-blue-500/20 flex items-center justify-center">
              <MessageCircle className="w-4 h-4 text-blue-400" />
            </div>
            <div>
              <h1 className="text-[16px] font-bold text-fg-primary leading-tight">Community</h1>
              <p className="text-[10px] text-fg-muted leading-none">Financial discussions & ideas</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/community/search"
              className="w-8 h-8 rounded-full bg-surface-raised border border-line-subtle flex items-center justify-center text-fg-secondary active:scale-90"
            >
              <Search className="w-4 h-4" />
            </Link>
            <Link
              href="/community/messages"
              className="w-8 h-8 rounded-full bg-surface-raised border border-line-subtle flex items-center justify-center text-fg-secondary active:scale-90"
            >
              <MessageCircle className="w-4 h-4" />
            </Link>
            <button
              onClick={() => setShowCreate(true)}
              className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white shadow-lg shadow-blue-500/25 active:scale-90"
            >
              <PenSquare className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Sort Tabs */}
        <div className="flex gap-2 px-4 pb-2.5 overflow-x-auto scrollbar-hide">
          {SORT_TABS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => { setSort(key); if (key !== 'top') setTimeFilter('all') }}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-[11px] font-medium border transition-all active:scale-95 ${
                sort === key
                  ? 'bg-blue-500 text-white border-blue-500 shadow-sm shadow-blue-500/30'
                  : 'bg-surface-raised text-fg-secondary border-line-subtle'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Time filter for Top */}
        {sort === 'top' && (
          <div className="flex gap-1.5 px-4 pb-2 overflow-x-auto scrollbar-hide">
            {[
              { value: 'day', label: 'Today' }, { value: 'week', label: 'Week' },
              { value: 'month', label: 'Month' }, { value: 'year', label: 'Year' }, { value: 'all', label: 'All Time' }
            ].map((opt) => (
              <button
                key={opt.value}
                onClick={() => setTimeFilter(opt.value)}
                className={`flex-shrink-0 px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors ${
                  timeFilter === opt.value ? 'bg-blue-500/15 text-blue-400' : 'text-fg-muted'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </header>

      {/* ── Feed ── */}
      <section className="px-2 pt-3 space-y-2">
        {loading ? (
          <FeedSkeleton count={4} />
        ) : posts.length === 0 ? (
          <EmptyState variant="no-posts" ctaLabel="Create the first post" onCta={() => setShowCreate(true)} />
        ) : (
          <>
            {posts.map((post, i) => (
              <div key={post.id} className="relative group/postrow">
                <PostCard post={post} index={i} focused={false} toastFn={handleToast} />
                {/* Floating follow button — pointer-events-none on wrapper so post links work */}
                {user?.id !== post.author.id && (
                  <div className="absolute top-3 right-3 z-10 pointer-events-none">
                    <button
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleFollowUser(post.author.id) }}
                    disabled={followingUserId === post.author.id}
                    className={`pointer-events-auto flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border backdrop-blur-sm transition-all ${
                      followedUsers.has(post.author.id)
                        ? 'bg-blue-500/10 border-blue-500/30 text-blue-400'
                        : 'bg-surface-base border-line-subtle text-fg-secondary'
                    }`}
                  >
                    {followingUserId === post.author.id
                      ? <Loader2 className="w-2.5 h-2.5 animate-spin" />
                      : followedUsers.has(post.author.id)
                        ? <UserCheck className="w-2.5 h-2.5" />
                        : <UserPlus className="w-2.5 h-2.5" />}
                    </button>
                  </div>
                )}
              </div>
            ))}
            <div ref={sentinelRef} className="h-px" />
            {loadingMore && (
              <div className="flex justify-center py-4">
                <Loader2 className="w-5 h-5 text-fg-muted animate-spin" />
              </div>
            )}
            {!hasMore && posts.length > 0 && (
              <p className="text-center text-[11px] text-fg-muted py-6">You've reached the end of the feed</p>
            )}
          </>
        )}
      </section>

      {/* ── Create Post Bottom Sheet ── */}
      <AnimatePresence>
        {showCreate && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end"
            onClick={() => setShowCreate(false)}
          >
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 26, stiffness: 320 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full bg-surface-base border-t border-line-subtle rounded-t-3xl overflow-hidden"
              style={{ maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}
            >
              {/* Handle */}
              <div className="flex justify-center pt-2.5 pb-1 shrink-0">
                <div className="w-10 h-1 rounded-full bg-surface-raised" />
              </div>

              {/* Sheet Header */}
              <div className="flex items-center justify-between px-4 py-2 border-b border-line-subtle shrink-0">
                <h3 className="text-[15px] font-bold text-fg-primary">Create Post</h3>
                <button onClick={() => setShowCreate(false)} className="w-7 h-7 rounded-full bg-surface-raised border border-line-subtle flex items-center justify-center text-fg-secondary active:scale-90">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Scrollable Body */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {/* Community */}
                <div>
                  <label className="block text-[11px] text-fg-secondary mb-1.5 uppercase tracking-wider">Community</label>
                  <select
                    value={createCommunity}
                    onChange={(e) => setCreateCommunity(e.target.value)}
                    className="w-full h-10 rounded-xl bg-surface-raised border border-line-subtle px-3 text-[13px] text-fg-primary focus:outline-none focus:ring-1 focus:ring-blue-500/60"
                  >
                    <option value="">Select a community...</option>
                    {communities.map((c) => (
                      <option key={c.slug} value={c.slug}>c/{c.name} ({c.member_count.toLocaleString()} members)</option>
                    ))}
                  </select>
                </div>

                {/* Title */}
                <div>
                  <label className="block text-[11px] text-fg-secondary mb-1.5 uppercase tracking-wider">Title</label>
                  <input
                    type="text"
                    value={createTitle}
                    onChange={(e) => setCreateTitle(e.target.value)}
                    placeholder="What's your post about?"
                    maxLength={300}
                    className="w-full h-10 rounded-xl bg-surface-raised border border-line-subtle px-3 text-[13px] text-fg-primary placeholder:text-fg-muted focus:outline-none focus:ring-1 focus:ring-blue-500/60"
                  />
                  <span className="text-[10px] text-fg-muted float-right mt-1">{createTitle.length}/300</span>
                </div>

                {/* Body — Write/Preview tabs */}
                <div>
                  <div className="flex items-center gap-2 mb-1.5">
                    <label className="text-[11px] text-fg-secondary uppercase tracking-wider">Body</label>
                    <div className="ml-auto flex gap-1">
                      {(['write', 'preview'] as const).map((tab) => (
                        <button
                          key={tab}
                          onClick={() => setBodyTab(tab)}
                          className={`flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-md transition-colors ${
                            bodyTab === tab ? 'bg-surface-hover text-fg-primary' : 'text-fg-muted'
                          }`}
                        >
                          {tab === 'write' ? <Pencil className="w-2.5 h-2.5" /> : <Eye className="w-2.5 h-2.5" />}
                          {tab.charAt(0).toUpperCase() + tab.slice(1)}
                        </button>
                      ))}
                    </div>
                  </div>
                  {bodyTab === 'write' ? (
                    <textarea
                      value={createBody}
                      onChange={(e) => { if (e.target.value.length <= MAX_BODY) setCreateBody(e.target.value) }}
                      placeholder={"Share analysis, ideas... Use $AAPL to tag tickers.\nSupports **bold**, *italic*, `code`"}
                      rows={5}
                      className="w-full rounded-xl bg-surface-raised border border-line-subtle px-3 py-2.5 text-[13px] text-fg-primary placeholder:text-fg-muted resize-none focus:outline-none focus:ring-1 focus:ring-blue-500/60 font-mono leading-relaxed"
                    />
                  ) : (
                    <div
                      className="min-h-[120px] rounded-xl bg-surface-raised border border-line-subtle px-3 py-2.5 text-[13px] text-fg-secondary leading-relaxed"
                      dangerouslySetInnerHTML={{ __html: renderMarkdownPreview(createBody) || '<span class="text-fg-muted italic">Nothing to preview yet...</span>' }}
                    />
                  )}
                  <div className="text-[10px] text-fg-muted mt-1">{createBody.length.toLocaleString()}/{MAX_BODY.toLocaleString()}</div>
                </div>

                {/* Image upload */}
                <div>
                  <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageSelect} />
                  {imagePreview ? (
                    <div className="relative rounded-xl overflow-hidden border border-line-subtle">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={imagePreview} alt="Preview" className="w-full h-32 object-cover" />
                      <button
                        onClick={() => { setImageFile(null); setImagePreview(null) }}
                        className="absolute top-2 right-2 w-6 h-6 rounded-full bg-black/60 flex items-center justify-center text-fg-primary"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full h-10 rounded-xl bg-surface-raised border border-dashed border-line-default flex items-center justify-center gap-2 text-[12px] text-fg-muted"
                    >
                      <ImagePlus className="w-4 h-4" />
                      Add image (optional)
                    </button>
                  )}
                </div>

                {/* Sentiment */}
                <div>
                  <label className="block text-[11px] text-fg-secondary mb-1.5 uppercase tracking-wider">Sentiment</label>
                  <div className="grid grid-cols-4 gap-2">
                    {[
                      { value: '', label: 'None', cls: '' },
                      { value: 'Bullish', label: '📈 Bullish', cls: 'bullish' },
                      { value: 'Bearish', label: '📉 Bearish', cls: 'bearish' },
                      { value: 'Neutral', label: '➡️ Neutral', cls: 'neutral' },
                    ].map((s) => (
                      <button
                        key={s.value}
                        onClick={() => setCreateSentiment(s.value)}
                        className={`py-2 rounded-xl text-[10px] font-medium border transition-all active:scale-95 ${
                          createSentiment === s.value
                            ? s.value === 'Bullish' ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                              : s.value === 'Bearish' ? 'bg-red-500/15 border-red-500/40 text-red-300'
                              : s.value === 'Neutral' ? 'bg-surface-raised/15 border-line-subtle text-fg-secondary'
                              : 'bg-surface-raised border-blue-500/40 text-blue-300'
                            : 'bg-surface-raised border-line-subtle text-fg-muted'
                        }`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Auto-detected tickers */}
                {autoTickers.length > 0 && (
                  <div>
                    <label className="block text-[11px] text-fg-secondary mb-1.5 uppercase tracking-wider">Detected Tickers</label>
                    <div className="flex flex-wrap gap-1.5">
                      {autoTickers.map((t) => (
                        <span key={t} className="px-2 py-0.5 text-[10px] rounded font-mono bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">${t}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Footer CTA */}
              <div className="p-4 border-t border-line-subtle pb-safe shrink-0">
                <button
                  onClick={handleCreate}
                  disabled={creating || !createTitle.trim() || !createCommunity}
                  className="w-full h-12 rounded-full bg-gradient-to-r from-blue-500 to-blue-600 text-white font-bold text-[14px] flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-40 disabled:active:scale-100 shadow-lg shadow-blue-500/20"
                >
                  {creating ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
                  {creating ? 'Posting...' : 'Post to Community'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

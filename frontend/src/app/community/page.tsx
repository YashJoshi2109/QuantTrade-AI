'use client'

import { useState, useEffect, useCallback, useRef, useMemo, Suspense } from 'react'
import AppLayout from '@/components/AppLayout'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Flame,
  Clock,
  TrendingUp,
  Zap,
  Users,
  PenSquare,
  X,
  Loader2,
  Send,
  Hash,
  ChevronDown,
  Eye,
  Pencil,
  Search,
  CheckCircle2,
  Keyboard,
  ImagePlus,
} from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import PostCard from '@/components/community/PostCard'
import CommunitySidebar from '@/components/community/CommunitySidebar'
import TrendingSidebar from '@/components/community/TrendingSidebar'
import EmptyState from '@/components/community/EmptyStates'
import { FeedSkeleton } from '@/components/community/Skeletons'
import { useKeyboardShortcuts, ShortcutHelpModal } from '@/components/community/KeyboardShortcuts'
import { useToast } from '@/components/Toast'
import {
  fetchFeed,
  fetchPopularFeed,
  fetchCommunities,
  createPost,
  uploadImage,
  type CommunityPost,
  type Community,
} from '@/lib/api'

type SortTab = 'hot' | 'new' | 'top' | 'rising' | 'following'

const SORT_TABS: { key: SortTab; label: string; icon: typeof Flame }[] = [
  { key: 'hot', label: 'Hot', icon: Flame },
  { key: 'new', label: 'New', icon: Clock },
  { key: 'top', label: 'Top', icon: TrendingUp },
  { key: 'rising', label: 'Rising', icon: Zap },
  { key: 'following', label: 'Following', icon: Users },
]

const DRAFT_KEY = 'qt:community:draft'
const MAX_BODY_LENGTH = 10_000

// ── Simple markdown-to-HTML preview ───────────────────────────────
function renderMarkdownPreview(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/^### (.+)$/gm, '<h3 class="text-base font-semibold text-slate-200 mt-3 mb-1">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-lg font-semibold text-slate-100 mt-3 mb-1">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="text-xl font-bold text-slate-100 mt-3 mb-1">$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong class="text-slate-100">$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code class="px-1.5 py-0.5 bg-slate-800 rounded text-cyan-400 text-xs">$1</code>')
    .replace(/\n/g, '<br/>')
    .replace(
      /\$([A-Z]{1,5})/g,
      '<span class="px-1.5 py-0.5 text-xs font-mono font-semibold text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 rounded-md inline-block">$$1</span>'
    )
}

// ── Extract tickers from body text ────────────────────────────────
function extractTickers(text: string): string[] {
  const matches = text.match(/\$([A-Z]{1,5})/g) || []
  return Array.from(new Set(matches.map((m) => m.replace('$', ''))))
}

export default function CommunityPage() {
  return (
    <Suspense fallback={<AppLayout><div className="flex items-center justify-center h-screen"><div className="animate-spin rounded-full h-8 w-8 border-t-2 border-blue-500" /></div></AppLayout>}>
      <CommunityPageInner />
    </Suspense>
  )
}

function CommunityPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { success: toastSuccess, error: toastError } = useToast()

  const sortParam = (searchParams.get('sort') as SortTab) || 'hot'
  const timeParam = searchParams.get('time') || 'all'
  const [sort, setSort] = useState<SortTab>(sortParam)
  const [timeFilter, setTimeFilter] = useState<string>(timeParam)

  // Sync URL params when sort/time change
  useEffect(() => {
    const params = new URLSearchParams()
    if (sort !== 'hot') params.set('sort', sort)
    if (sort === 'top' && timeFilter !== 'all') params.set('time', timeFilter)
    const qs = params.toString()
    router.replace(`/community${qs ? `?${qs}` : ''}`, { scroll: false })
  }, [sort, timeFilter, router])

  const [posts, setPosts] = useState<CommunityPost[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [cursor, setCursor] = useState<number | null>(null)
  const [hasMore, setHasMore] = useState(true)
  const sentinelRef = useRef<HTMLDivElement>(null)

  // Create post modal
  const [showCreate, setShowCreate] = useState(false)
  const [createTitle, setCreateTitle] = useState('')
  const [createBody, setCreateBody] = useState('')
  const [createCommunity, setCreateCommunity] = useState('')
  const [createTickers, setCreateTickers] = useState('')
  const [createSentiment, setCreateSentiment] = useState<string>('')
  const [creating, setCreating] = useState(false)
  const [createSuccess, setCreateSuccess] = useState(false)
  const [communities, setCommunities] = useState<Community[]>([])
  const [bodyTab, setBodyTab] = useState<'write' | 'preview'>('write')
  const [communitySearch, setCommunitySearch] = useState('')
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)

  // Keyboard focus
  const [focusedIndex, setFocusedIndex] = useState(-1)
  const postRefs = useRef<(HTMLDivElement | null)[]>([])

  // Auto-extract tickers from body
  const autoTickers = useMemo(() => extractTickers(createBody), [createBody])

  // Merge auto-detected with manually entered tickers
  const mergedTickersDisplay = useMemo(() => {
    const manual = createTickers
      .split(/[,\s]+/)
      .map((t) => t.replace('$', '').toUpperCase())
      .filter(Boolean)
    return Array.from(new Set([...manual, ...autoTickers]))
  }, [createTickers, autoTickers])

  // Community search filter
  const filteredCommunities = useMemo(() => {
    if (!communitySearch.trim()) return communities
    const q = communitySearch.toLowerCase()
    return communities.filter(
      (c) => c.name.toLowerCase().includes(q) || c.slug.toLowerCase().includes(q)
    )
  }, [communities, communitySearch])

  const selectedCommunityName = useMemo(
    () => communities.find((c) => c.slug === createCommunity)?.name,
    [communities, createCommunity]
  )

  // ── Draft auto-save ─────────────────────────────────────────────
  useEffect(() => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY)
      if (saved) {
        const draft = JSON.parse(saved)
        if (draft.title) setCreateTitle(draft.title)
        if (draft.body) setCreateBody(draft.body)
        if (draft.community) setCreateCommunity(draft.community)
        if (draft.tickers) setCreateTickers(draft.tickers)
        if (draft.sentiment) setCreateSentiment(draft.sentiment)
      }
    } catch {}
  }, [])

  useEffect(() => {
    if (!createTitle && !createBody && !createCommunity) return
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(
          DRAFT_KEY,
          JSON.stringify({
            title: createTitle,
            body: createBody,
            community: createCommunity,
            tickers: createTickers,
            sentiment: createSentiment,
          })
        )
      } catch {}
    }, 500)
    return () => clearTimeout(timer)
  }, [createTitle, createBody, createCommunity, createTickers, createSentiment])

  const clearDraft = () => {
    try { localStorage.removeItem(DRAFT_KEY) } catch {}
  }

  // Load communities for the create modal
  useEffect(() => {
    fetchCommunities().then((d) => setCommunities(d.communities || []))
  }, [])

  // Load feed
  const loadFeed = useCallback(async (sortKey: SortTab, resetCursor?: boolean, time?: string) => {
    const isReset = resetCursor ?? true
    if (isReset) {
      setLoading(true)
      setPosts([])
      setCursor(null)
      setHasMore(true)
    } else {
      setLoadingMore(true)
    }

    try {
      const c = isReset ? undefined : (cursor ?? undefined)
      const feedSort = sortKey === 'following' ? 'hot' : sortKey
      const data = sortKey === 'following'
        ? await fetchFeed('hot', c, 20, time)
        : await fetchPopularFeed(c, 20, feedSort, time)

      const newPosts = data.posts || []

      if (isReset) {
        setPosts(newPosts)
      } else {
        setPosts((prev) => [...prev, ...newPosts])
      }

      setCursor(data.next_cursor)
      setHasMore(!!data.next_cursor)
    } catch {
      toastError('Failed to load posts')
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [cursor, toastError])

  // Initial load and sort changes
  useEffect(() => {
    loadFeed(sort, true, timeFilter)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort, timeFilter])

  // Infinite scroll
  useEffect(() => {
    if (!sentinelRef.current) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMore && !loading) {
          loadFeed(sort, false, timeFilter)
        }
      },
      { rootMargin: '200px' }
    )
    observer.observe(sentinelRef.current)
    return () => observer.disconnect()
  }, [hasMore, loadingMore, loading, sort, loadFeed])

  // Create post handler with animated submit
  const handleCreate = async () => {
    if (!createTitle.trim() || !createCommunity) return
    setCreating(true)
    try {
      const tickers = mergedTickersDisplay

      // Upload image first if present
      let mediaUrls: string[] | undefined
      if (imageFile) {
        try {
          const uploaded = await uploadImage(imageFile)
          mediaUrls = [uploaded.url]
        } catch (err) {
          toastError(err instanceof Error ? err.message : 'Image upload failed')
          setCreating(false)
          return
        }
      }

      const newPost = await createPost({
        title: createTitle.trim(),
        body: createBody.trim(),
        community_slug: createCommunity,
        tickers: tickers.length > 0 ? tickers : undefined,
        sentiment: createSentiment || undefined,
        ...(mediaUrls ? { media_urls: mediaUrls } : {}),
      } as any)

      // Show success state
      setCreateSuccess(true)
      toastSuccess('Post created successfully!')
      clearDraft()

      setTimeout(() => {
        setPosts((prev) => [newPost, ...prev])
        setShowCreate(false)
        setCreateSuccess(false)
        setCreateTitle('')
        setCreateBody('')
        setCreateCommunity('')
        setCreateTickers('')
        setCreateSentiment('')
        setBodyTab('write')
        setCommunitySearch('')
        setImageFile(null)
        setImagePreview(null)
      }, 800)
    } catch {
      toastError('Failed to create post. Please try again.')
    } finally {
      setCreating(false)
    }
  }

  // ── Keyboard shortcuts ──────────────────────────────────────────
  const scrollToPost = useCallback((index: number) => {
    const el = postRefs.current[index]
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [])

  const { showHelp, setShowHelp } = useKeyboardShortcuts({
    onCreatePost: () => setShowCreate(true),
    onNavigate: (direction) => {
      setFocusedIndex((prev) => {
        const next = direction === 'next'
          ? Math.min(prev + 1, posts.length - 1)
          : Math.max(prev - 1, 0)
        scrollToPost(next)
        return next
      })
    },
    onOpenPost: () => {
      if (focusedIndex >= 0 && focusedIndex < posts.length) {
        router.push(`/community/post/${posts[focusedIndex].id}`)
      }
    },
    onUpvote: () => {
      if (focusedIndex >= 0 && focusedIndex < posts.length) {
        // Trigger vote on the focused post card
        const postCard = postRefs.current[focusedIndex]
        const upBtn = postCard?.querySelector('[data-vote="up"]') as HTMLButtonElement
        upBtn?.click()
      }
    },
    onDownvote: () => {
      if (focusedIndex >= 0 && focusedIndex < posts.length) {
        const postCard = postRefs.current[focusedIndex]
        const downBtn = postCard?.querySelector('[data-vote="down"]') as HTMLButtonElement
        downBtn?.click()
      }
    },
    onCloseModal: () => {
      if (showCreate) setShowCreate(false)
    },
    isModalOpen: showCreate,
  })

  // Toast callback for PostCard
  const handleToast = useCallback((msg: string, type?: string) => {
    switch (type) {
      case 'success': toastSuccess(msg); break
      case 'error': toastError(msg); break
      default: toastSuccess(msg)
    }
  }, [toastSuccess, toastError])

  return (
    <AppLayout>
    <div className="min-h-screen pb-safe">
      <div className="max-w-[1400px] mx-auto px-3 sm:px-6 py-4 sm:py-6">
        {/* 3-Column Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr_300px] gap-5">
          {/* Left Sidebar - Navigation + Communities */}
          <div className="hidden lg:block">
            <div className="sticky top-20">
              <CommunitySidebar />
            </div>
          </div>

          {/* Center - Feed */}
          <div className="min-w-0">
            {/* Create Post Bar */}
            <div className="flex items-center gap-3 bg-[#131820] rounded-2xl px-4 py-2.5 mb-3">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500/20 to-cyan-500/20 flex items-center justify-center text-xs font-bold text-blue-400 shrink-0">
                U
              </div>
              <button
                onClick={() => setShowCreate(true)}
                className="flex-1 text-left px-4 py-2 bg-[#1a2130] rounded-full text-sm text-slate-500 hover:bg-[#1f2937] hover:text-slate-400 transition-colors"
              >
                Create a post
              </button>
              <button
                onClick={() => setShowCreate(true)}
                className="p-2 rounded-full text-slate-400 hover:text-blue-400 hover:bg-blue-500/10 transition-colors"
              >
                <PenSquare className="w-5 h-5" />
              </button>
            </div>

            {/* Sort Tabs */}
            <div className="bg-[#131820] rounded-2xl p-1 mb-3 flex gap-0.5">
              {SORT_TABS.map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  onClick={() => {
                    setSort(key)
                    if (key !== 'top') setTimeFilter('all')
                  }}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition-colors flex-1 justify-center ${
                    sort === key
                      ? 'bg-white/[0.08] text-white'
                      : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.03]'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span className="hidden sm:inline">{label}</span>
                </button>
              ))}
            </div>

            {/* Time filter — only visible when Top sort is active */}
            {sort === 'top' && (
              <div className="flex items-center gap-2 mb-3 px-1">
                <span className="text-[11px] text-slate-500 uppercase tracking-wider">Period</span>
                <select
                  value={timeFilter}
                  onChange={(e) => setTimeFilter(e.target.value)}
                  className="bg-[#131820] border border-white/10 rounded-lg px-3 py-1.5 text-xs text-slate-400 focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
                >
                  <option value="day">Today</option>
                  <option value="week">This Week</option>
                  <option value="month">This Month</option>
                  <option value="year">This Year</option>
                  <option value="all">All Time</option>
                </select>
              </div>
            )}

            {/* Posts */}
            {loading ? (
              <FeedSkeleton count={5} />
            ) : posts.length === 0 ? (
              <EmptyState
                variant="no-posts"
                ctaLabel="Create the first post"
                onCta={() => setShowCreate(true)}
              />
            ) : (
              <div className="space-y-2">
                {posts.map((post, i) => (
                  <PostCard
                    key={post.id}
                    ref={(el) => { postRefs.current[i] = el }}
                    post={post}
                    index={i}
                    focused={focusedIndex === i}
                    toastFn={handleToast}
                  />
                ))}
              </div>
            )}

            {/* Infinite scroll sentinel */}
            <div ref={sentinelRef} className="h-px" />

            {loadingMore && (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="w-5 h-5 text-slate-600 animate-spin" />
              </div>
            )}

            {!hasMore && posts.length > 0 && (
              <p className="text-center text-xs text-slate-600 py-6">
                You&apos;ve reached the end
              </p>
            )}
          </div>

          {/* Right Sidebar - Trending + Communities */}
          <div className="hidden lg:block">
            <div className="sticky top-20">
              <TrendingSidebar />
            </div>
          </div>
        </div>
      </div>

      {/* Keyboard Shortcuts Help Modal */}
      <ShortcutHelpModal open={showHelp} onClose={() => setShowHelp(false)} />

      {/* Create Post Modal - Enhanced */}
      <AnimatePresence>
        {showCreate && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            onClick={() => setShowCreate(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ duration: 0.2 }}
              className="w-full max-w-xl bg-[#131820] border border-white/[0.08] rounded-none sm:rounded-2xl shadow-2xl overflow-hidden fixed inset-0 sm:relative sm:inset-auto flex flex-col max-h-screen sm:max-h-[90vh]"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal header */}
              <div className="flex items-center justify-between px-4 sm:px-5 py-3 sm:py-4 border-b border-white/[0.06] shrink-0">
                <div>
                  <h2 className="text-lg font-semibold text-slate-100">Create Post</h2>
                  {selectedCommunityName && (
                    <motion.p
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="text-xs text-slate-500 mt-0.5"
                    >
                      Posting to <span className="text-cyan-400 font-medium">c/{selectedCommunityName}</span>
                    </motion.p>
                  )}
                </div>
                <button
                  onClick={() => setShowCreate(false)}
                  className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-white/[0.05] transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Modal body */}
              <div className="p-4 sm:p-5 space-y-4 flex-1 overflow-y-auto">
                {/* Community selector with search */}
                <div className="relative">
                  <div className="relative">
                    <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none z-10" />
                    <input
                      type="text"
                      placeholder="Search communities..."
                      value={communitySearch}
                      onChange={(e) => setCommunitySearch(e.target.value)}
                      className="w-full bg-[#161b22] border border-white/[0.08] rounded-t-xl pl-9 pr-4 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500/40"
                    />
                  </div>
                  <select
                    value={createCommunity}
                    onChange={(e) => {
                      setCreateCommunity(e.target.value)
                      setCommunitySearch('')
                    }}
                    className="w-full bg-[#161b22] border border-white/[0.08] border-t-0 rounded-b-xl px-4 py-2.5 text-sm text-slate-200 appearance-none cursor-pointer focus:outline-none focus:border-blue-500/40"
                  >
                    <option value="">Select a community</option>
                    {filteredCommunities.map((c) => (
                      <option key={c.slug} value={c.slug}>
                        c/{c.name} ({c.member_count.toLocaleString()} members)
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="w-4 h-4 text-slate-500 absolute right-3 bottom-3 pointer-events-none" />
                </div>

                {/* Title */}
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Post title"
                    value={createTitle}
                    onChange={(e) => setCreateTitle(e.target.value)}
                    className="w-full bg-[#161b22] border border-white/[0.08] rounded-xl px-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500/40"
                    maxLength={300}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-600 tabular-nums">
                    {createTitle.length}/300
                  </span>
                </div>

                {/* Body with Write/Preview tabs */}
                <div>
                  <div className="flex gap-1 mb-1.5">
                    <button
                      onClick={() => setBodyTab('write')}
                      className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-colors ${
                        bodyTab === 'write'
                          ? 'bg-white/[0.06] text-slate-200'
                          : 'text-slate-500 hover:text-slate-300'
                      }`}
                    >
                      <Pencil className="w-3 h-3" />
                      Write
                    </button>
                    <button
                      onClick={() => setBodyTab('preview')}
                      className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-colors ${
                        bodyTab === 'preview'
                          ? 'bg-white/[0.06] text-slate-200'
                          : 'text-slate-500 hover:text-slate-300'
                      }`}
                    >
                      <Eye className="w-3 h-3" />
                      Preview
                    </button>
                  </div>

                  <AnimatePresence mode="wait">
                    {bodyTab === 'write' ? (
                      <motion.div
                        key="write"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        className="relative"
                      >
                        <textarea
                          placeholder="What's on your mind? Share analysis, ideas, or questions... Use $AAPL syntax to tag tickers. Supports **bold**, *italic*, `code`, and # headings."
                          value={createBody}
                          onChange={(e) => {
                            if (e.target.value.length <= MAX_BODY_LENGTH) {
                              setCreateBody(e.target.value)
                            }
                          }}
                          rows={6}
                          className="w-full bg-[#161b22] border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-slate-100 placeholder-slate-500 resize-none focus:outline-none focus:border-blue-500/40 leading-relaxed min-h-[140px] sm:min-h-0 font-mono"
                        />
                        <div className="absolute right-3 bottom-3 flex items-center gap-2">
                          <span
                            className={`text-[10px] tabular-nums ${
                              createBody.length > MAX_BODY_LENGTH * 0.9
                                ? 'text-amber-400'
                                : 'text-slate-600'
                            }`}
                          >
                            {createBody.length.toLocaleString()}/{MAX_BODY_LENGTH.toLocaleString()}
                          </span>
                        </div>
                      </motion.div>
                    ) : (
                      <motion.div
                        key="preview"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        className="w-full bg-[#161b22] border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-slate-300 leading-relaxed min-h-[140px] overflow-y-auto"
                      >
                        {createBody ? (
                          <div
                            className="prose prose-invert prose-sm max-w-none"
                            dangerouslySetInnerHTML={{
                              __html: renderMarkdownPreview(createBody),
                            }}
                          />
                        ) : (
                          <p className="text-slate-600 italic">Nothing to preview yet...</p>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Image attach */}
                  <div className="flex items-center gap-2 mt-2">
                    <label className="cursor-pointer flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors">
                      <ImagePlus className="w-4 h-4" />
                      <span>Add Image</span>
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/gif"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0]
                          if (f) {
                            if (f.size > 5 * 1024 * 1024) {
                              alert('Image must be under 5MB')
                              return
                            }
                            setImageFile(f)
                            setImagePreview(URL.createObjectURL(f))
                          }
                        }}
                      />
                    </label>
                    {imagePreview && (
                      <div className="relative">
                        {/* eslint-disable-next-line @next/next/no-img-element -- blob URL from createObjectURL is safe */}
                        <img src={imagePreview} alt="Preview" className="h-12 w-12 object-cover rounded border border-white/10" />
                        <button
                          type="button"
                          onClick={() => { setImageFile(null); setImagePreview(null) }}
                          className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full text-white text-[10px] flex items-center justify-center"
                        >
                          &times;
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Auto-detected tickers display */}
                {mergedTickersDisplay.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    className="flex flex-wrap items-center gap-1.5"
                  >
                    <span className="text-[10px] text-slate-600 uppercase tracking-wider mr-1">Tickers:</span>
                    {mergedTickersDisplay.map((t) => (
                      <span
                        key={t}
                        className="px-2 py-0.5 text-xs font-mono font-semibold text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 rounded-md"
                      >
                        ${t}
                      </span>
                    ))}
                  </motion.div>
                )}

                {/* Tickers + Sentiment */}
                <div className="flex flex-col sm:flex-row gap-3">
                  <div className="flex-1 relative">
                    <Hash className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      placeholder="Extra tickers (e.g. AAPL, TSLA)"
                      value={createTickers}
                      onChange={(e) => setCreateTickers(e.target.value)}
                      className="w-full bg-[#161b22] border border-white/[0.08] rounded-xl pl-9 pr-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500/40"
                    />
                  </div>
                  <select
                    value={createSentiment}
                    onChange={(e) => setCreateSentiment(e.target.value)}
                    className="bg-[#161b22] border border-white/[0.08] rounded-xl px-3 py-2.5 text-sm text-slate-200 appearance-none cursor-pointer focus:outline-none focus:border-blue-500/40 min-w-[120px]"
                  >
                    <option value="">Sentiment</option>
                    <option value="bullish">Bullish</option>
                    <option value="bearish">Bearish</option>
                    <option value="neutral">Neutral</option>
                  </select>
                </div>
              </div>

              {/* Modal footer */}
              <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3 sm:py-4 border-t border-white/[0.06] shrink-0">
                <p className="text-[10px] text-slate-600 hidden sm:block">
                  Draft auto-saved
                </p>
                <div className="flex items-center gap-3 ml-auto">
                  <button
                    onClick={() => setShowCreate(false)}
                    className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200 transition-colors"
                  >
                    Cancel
                  </button>
                  <motion.button
                    onClick={handleCreate}
                    disabled={!createTitle.trim() || !createCommunity || creating || createSuccess}
                    whileTap={{ scale: 0.97 }}
                    className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-all disabled:cursor-not-allowed min-w-[100px] justify-center ${
                      createSuccess
                        ? 'bg-emerald-500 text-white'
                        : 'bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-40'
                    }`}
                  >
                    <AnimatePresence mode="wait">
                      {createSuccess ? (
                        <motion.div
                          key="success"
                          initial={{ scale: 0, rotate: -90 }}
                          animate={{ scale: 1, rotate: 0 }}
                          className="flex items-center gap-2"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          Posted!
                        </motion.div>
                      ) : creating ? (
                        <motion.div
                          key="loading"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          className="flex items-center gap-2"
                        >
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Posting...
                        </motion.div>
                      ) : (
                        <motion.div
                          key="idle"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          className="flex items-center gap-2"
                        >
                          <Send className="w-4 h-4" />
                          Post
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
    </AppLayout>
  )
}

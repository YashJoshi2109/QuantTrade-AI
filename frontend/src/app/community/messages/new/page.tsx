'use client'

import { useState, useEffect, useRef, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import AppLayout from '@/components/AppLayout'
import { useAuth } from '@/contexts/AuthContext'
import { createDMConversation } from '@/lib/api'
import {
  ArrowLeft,
  Search,
  Send,
  Loader2,
  MessageCircle,
  X,
  CheckCircle2,
} from 'lucide-react'

const API = process.env.NEXT_PUBLIC_API_URL || ''

interface UserResult {
  id: number
  username: string
  full_name?: string | null
  avatar_url?: string | null
  reputation?: number
}

const AVATAR_GRADIENTS = [
  'from-blue-500 to-cyan-400',
  'from-purple-500 to-pink-400',
  'from-emerald-500 to-teal-400',
  'from-amber-500 to-orange-400',
  'from-rose-500 to-red-400',
  'from-indigo-500 to-violet-400',
]

function UserAvatar({ username, size = 'md' }: { username: string; size?: 'sm' | 'md' | 'lg' }) {
  const sizeMap = { sm: 'w-8 h-8 text-xs', md: 'w-10 h-10 text-sm', lg: 'w-14 h-14 text-lg' }
  const gradIdx = username.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_GRADIENTS.length
  return (
    <div className={`${sizeMap[size]} rounded-full bg-gradient-to-br ${AVATAR_GRADIENTS[gradIdx]} flex items-center justify-center font-bold text-white shrink-0`}>
      {username.charAt(0).toUpperCase()}
    </div>
  )
}

function ReputationBadge({ rep }: { rep?: number }) {
  if (!rep || rep === 0) return null
  const label = rep >= 1000 ? '🏆' : rep >= 500 ? '⭐' : rep >= 100 ? '✦' : null
  if (!label) return null
  return <span className="text-[10px] text-slate-500">{label} {rep}</span>
}

function NewMessageContent() {
  const { user, isAuthenticated } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()

  const [searchQuery, setSearchQuery] = useState(searchParams?.get('new') || '')
  const [searchResults, setSearchResults] = useState<UserResult[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const [selectedUser, setSelectedUser] = useState<UserResult | null>(null)
  const [message, setMessage] = useState(searchParams?.get('message') || '')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)

  const searchTimeout = useRef<NodeJS.Timeout | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const messageRef = useRef<HTMLTextAreaElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    searchInputRef.current?.focus()
  }, [])

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // Search users — debounced, fires from 1 char
  useEffect(() => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current)

    const q = searchQuery.trim()
    if (q.length < 1) {
      setSearchResults([])
      setShowDropdown(false)
      return
    }

    setSearchLoading(true)
    searchTimeout.current = setTimeout(async () => {
      try {
        // Primary: dedicated users/search endpoint (returns { users: [...] } directly)
        const res = await fetch(`${API}/api/v1/users/search?q=${encodeURIComponent(q)}&limit=8`, {
          credentials: 'include',
        })
        if (res.ok) {
          const data = await res.json()
          const users: UserResult[] = (data.users || []).filter(
            (u: UserResult) => u.id !== user?.id
          )
          setSearchResults(users)
          setShowDropdown(true)
        } else {
          // Fallback: unified search endpoint
          const res2 = await fetch(`${API}/api/v1/search?q=${encodeURIComponent(q)}&type=users&limit=8`, {
            credentials: 'include',
          })
          if (res2.ok) {
            const data2 = await res2.json()
            // Unified search nests users under results.users
            const users: UserResult[] = (data2.results?.users || []).filter(
              (u: UserResult) => u.id !== user?.id
            )
            setSearchResults(users)
            setShowDropdown(true)
          } else {
            setSearchResults([])
            setShowDropdown(false)
          }
        }
      } catch {
        setSearchResults([])
        setShowDropdown(false)
      } finally {
        setSearchLoading(false)
      }
    }, 250)

    return () => {
      if (searchTimeout.current) clearTimeout(searchTimeout.current)
    }
  }, [searchQuery, user?.id])

  const selectUser = useCallback((u: UserResult) => {
    setSelectedUser(u)
    setSearchQuery('')
    setSearchResults([])
    setShowDropdown(false)
    setTimeout(() => messageRef.current?.focus(), 100)
  }, [])

  const handleSend = async () => {
    if (!selectedUser || !message.trim() || sending) return
    setSending(true)
    setError('')
    try {
      const result = await createDMConversation(selectedUser.id, message.trim())
      if (result.error) {
        setError(result.error)
      } else {
        setSent(true)
        setTimeout(() => router.push('/community/messages'), 900)
      }
    } catch {
      setError('Failed to send message. Please try again.')
    } finally {
      setSending(false)
    }
  }

  if (!isAuthenticated) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <MessageCircle className="w-12 h-12 text-slate-600 mx-auto mb-3" />
            <p className="text-slate-400">Sign in to send messages</p>
          </div>
        </div>
      </AppLayout>
    )
  }

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto px-3 sm:px-6 py-4 sm:py-8">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => router.push('/community/messages')}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.05] transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-lg font-bold text-white">New Message</h1>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-[#0D1117] border border-white/[0.06] rounded-xl overflow-visible"
        >
          {/* To: field — recipient selection */}
          <div className="px-4 py-3 border-b border-white/[0.06]">
            <div className="flex items-center gap-2 flex-wrap min-h-[2.5rem]">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider shrink-0">To:</span>

              {/* Selected user chip */}
              {selectedUser && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.85 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="flex items-center gap-1.5 px-2 py-1 bg-blue-500/15 border border-blue-500/30 rounded-full"
                >
                  <UserAvatar username={selectedUser.username} size="sm" />
                  <span className="text-xs font-medium text-blue-300">{selectedUser.username}</span>
                  <button
                    onClick={() => setSelectedUser(null)}
                    className="text-blue-400/60 hover:text-blue-300 ml-0.5"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </motion.div>
              )}

              {/* Search input */}
              {!selectedUser && (
                <div ref={dropdownRef} className="relative flex-1 min-w-[160px]">
                  <input
                    ref={searchInputRef}
                    type="text"
                    placeholder="Search by username..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onFocus={() => searchResults.length > 0 && setShowDropdown(true)}
                    className="w-full px-3 py-1.5 bg-transparent text-sm text-white placeholder-slate-500 focus:outline-none"
                  />

                  {/* Dropdown */}
                  <AnimatePresence>
                    {showDropdown && (
                      <motion.div
                        initial={{ opacity: 0, y: -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        transition={{ duration: 0.12 }}
                        className="absolute top-full left-0 right-0 z-50 mt-1 bg-[#0D1117] border border-white/[0.10] rounded-xl shadow-2xl shadow-black/50 overflow-hidden min-w-[280px]"
                      >
                        {searchLoading ? (
                          <div className="flex items-center justify-center py-6">
                            <Loader2 className="w-4 h-4 text-slate-500 animate-spin" />
                          </div>
                        ) : searchResults.length > 0 ? (
                          <div className="py-1 max-h-72 overflow-y-auto">
                            {searchResults.map((u) => (
                              <button
                                key={u.id}
                                onMouseDown={(e) => { e.preventDefault(); selectUser(u) }}
                                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.05] transition-colors text-left group"
                              >
                                <UserAvatar username={u.username} size="sm" />
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <p className="text-sm font-medium text-white truncate group-hover:text-blue-300 transition-colors">
                                      {u.username}
                                    </p>
                                    <ReputationBadge rep={u.reputation} />
                                  </div>
                                  {u.full_name && (
                                    <p className="text-xs text-slate-500 truncate">{u.full_name}</p>
                                  )}
                                </div>
                              </button>
                            ))}
                          </div>
                        ) : searchQuery.trim().length > 0 ? (
                          <div className="py-6 px-4 text-center">
                            <p className="text-xs text-slate-500">No users found matching &ldquo;{searchQuery}&rdquo;</p>
                          </div>
                        ) : null}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}

              {/* Search icon / loading spinner */}
              {!selectedUser && (
                <div className="shrink-0 ml-auto">
                  {searchLoading
                    ? <Loader2 className="w-4 h-4 text-slate-500 animate-spin" />
                    : <Search className="w-4 h-4 text-slate-600" />
                  }
                </div>
              )}
            </div>
          </div>

          {/* Message area (shown once recipient selected) */}
          <AnimatePresence>
            {selectedUser && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
              >
                {/* Recipient info banner */}
                <div className="flex items-center gap-3 px-4 py-3 bg-blue-500/[0.04] border-b border-white/[0.04]">
                  <UserAvatar username={selectedUser.username} size="md" />
                  <div>
                    <p className="text-sm font-semibold text-white">{selectedUser.username}</p>
                    {selectedUser.full_name && (
                      <p className="text-xs text-slate-400">{selectedUser.full_name}</p>
                    )}
                  </div>
                </div>

                <div className="p-4">
                  <textarea
                    ref={messageRef}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSend()
                    }}
                    placeholder="Write your message... (⌘Enter to send)"
                    rows={5}
                    className="w-full px-3 py-2.5 bg-[#1a2130] border border-white/[0.06] rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/40 resize-none leading-relaxed"
                  />

                  {error && (
                    <motion.p
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="text-xs text-red-400 mt-2"
                    >
                      {error}
                    </motion.p>
                  )}

                  <div className="flex items-center justify-between mt-3">
                    <p className="text-[10px] text-slate-600">{message.length} / 5000</p>
                    <button
                      onClick={handleSend}
                      disabled={!message.trim() || sending || sent}
                      className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                        sent
                          ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/30'
                          : message.trim() && !sending
                            ? 'bg-blue-600 text-white hover:bg-blue-500 shadow-lg shadow-blue-500/20 active:scale-95'
                            : 'bg-[#1a2130] text-slate-600 cursor-not-allowed'
                      }`}
                    >
                      {sent ? (
                        <><CheckCircle2 className="w-4 h-4" /> Sent!</>
                      ) : sending ? (
                        <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</>
                      ) : (
                        <><Send className="w-4 h-4" /> Send Message</>
                      )}
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Empty state — no recipient selected */}
          {!selectedUser && !searchQuery && (
            <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-500/10 to-cyan-500/10 border border-blue-500/20 flex items-center justify-center mb-4">
                <Search className="w-6 h-6 text-blue-400" />
              </div>
              <p className="text-sm font-medium text-slate-400 mb-1">Find a trader to message</p>
              <p className="text-xs text-slate-600">Start typing a username to search</p>
            </div>
          )}
        </motion.div>
      </div>
    </AppLayout>
  )
}

export default function NewMessagePage() {
  return (
    <Suspense fallback={null}>
      <NewMessageContent />
    </Suspense>
  )
}

'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import AppLayout from '@/components/AppLayout'
import { useAuth } from '@/contexts/AuthContext'
import { createDMConversation } from '@/lib/api'
import {
  ArrowLeft,
  Search,
  Send,
  Loader2,
  MessageCircle,
  Users,
} from 'lucide-react'

const API = process.env.NEXT_PUBLIC_API_URL || ''

interface UserResult {
  id: number
  username: string
  full_name?: string | null
  avatar_url?: string | null
}

function Avatar({ username, size = 'md' }: { username: string; size?: 'sm' | 'md' | 'lg' }) {
  const sizes = { sm: 'w-8 h-8 text-xs', md: 'w-10 h-10 text-sm', lg: 'w-12 h-12 text-base' }
  const colors = [
    'from-blue-500 to-cyan-500',
    'from-purple-500 to-pink-500',
    'from-emerald-500 to-teal-500',
    'from-amber-500 to-orange-500',
    'from-rose-500 to-red-500',
    'from-indigo-500 to-violet-500',
  ]
  const colorIdx = username.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % colors.length
  return (
    <div className={`${sizes[size]} rounded-full bg-gradient-to-br ${colors[colorIdx]} flex items-center justify-center font-bold text-white shrink-0`}>
      {username.charAt(0).toUpperCase()}
    </div>
  )
}

export default function NewMessagePage() {
  const { user, isAuthenticated } = useAuth()
  const router = useRouter()

  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<UserResult[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [selectedUser, setSelectedUser] = useState<UserResult | null>(null)
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const searchTimeout = useRef<NodeJS.Timeout | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Focus search input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Search users as they type
  useEffect(() => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current)
    if (!searchQuery.trim() || searchQuery.trim().length < 2) {
      setSearchResults([])
      return
    }
    setSearchLoading(true)
    searchTimeout.current = setTimeout(async () => {
      try {
        const res = await fetch(`${API}/api/v1/search?q=${encodeURIComponent(searchQuery.trim())}&type=users&limit=10`, {
          credentials: 'include',
        })
        if (res.ok) {
          const data = await res.json()
          const users = (data.users || data.results || data.items || []).filter(
            (u: UserResult) => u.id !== user?.id
          )
          setSearchResults(users)
        } else {
          setSearchResults([])
        }
      } catch {
        setSearchResults([])
      } finally {
        setSearchLoading(false)
      }
    }, 300)
    return () => {
      if (searchTimeout.current) clearTimeout(searchTimeout.current)
    }
  }, [searchQuery, user?.id])

  const handleSend = async () => {
    if (!selectedUser || !message.trim() || sending) return
    setSending(true)
    setError('')
    try {
      const result = await createDMConversation(selectedUser.id, message.trim())
      if (result.error) {
        setError(result.error)
      } else {
        router.push('/community/messages')
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
          className="bg-[#0D1117] border border-white/[0.06] rounded-xl overflow-hidden"
        >
          {/* Recipient Selection */}
          {!selectedUser ? (
            <div>
              <div className="px-4 py-3 border-b border-white/[0.06]">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input
                    ref={inputRef}
                    type="text"
                    placeholder="Search for a user..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-3 py-2.5 bg-[#1a2130] border border-white/[0.06] rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/40"
                  />
                </div>
              </div>

              <div className="max-h-80 overflow-y-auto">
                {searchLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-5 h-5 text-slate-600 animate-spin" />
                  </div>
                ) : searchResults.length > 0 ? (
                  searchResults.map((u) => (
                    <button
                      key={u.id}
                      onClick={() => {
                        setSelectedUser(u)
                        setSearchQuery('')
                        setSearchResults([])
                      }}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/[0.03] transition-colors text-left"
                    >
                      <Avatar username={u.username} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-white truncate">
                          {u.full_name || u.username}
                        </p>
                        <p className="text-xs text-slate-500">@{u.username}</p>
                      </div>
                    </button>
                  ))
                ) : searchQuery.trim().length >= 2 ? (
                  <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                    <Users className="w-10 h-10 text-slate-700 mb-2" />
                    <p className="text-sm text-slate-500">No users found</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                    <Search className="w-10 h-10 text-slate-700 mb-2" />
                    <p className="text-sm text-slate-500">
                      Search for a user to start a conversation
                    </p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div>
              {/* Selected user header */}
              <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.06]">
                <button
                  onClick={() => setSelectedUser(null)}
                  className="p-1 rounded-lg text-slate-400 hover:text-white"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <Avatar username={selectedUser.username} size="sm" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">
                    {selectedUser.full_name || selectedUser.username}
                  </p>
                  <p className="text-xs text-slate-500">@{selectedUser.username}</p>
                </div>
              </div>

              {/* Message input */}
              <div className="p-4">
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Write your message..."
                  rows={4}
                  className="w-full px-3 py-2.5 bg-[#1a2130] border border-white/[0.06] rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/40 resize-none"
                  autoFocus
                />

                {error && (
                  <p className="text-xs text-red-400 mt-2">{error}</p>
                )}

                <div className="flex justify-end mt-3">
                  <button
                    onClick={handleSend}
                    disabled={!message.trim() || sending}
                    className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
                      message.trim()
                        ? 'bg-blue-600 text-white hover:bg-blue-500 shadow-lg shadow-blue-500/20'
                        : 'bg-[#1a2130] text-slate-600 cursor-not-allowed'
                    }`}
                  >
                    {sending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Send className="w-4 h-4" />
                    )}
                    Send Message
                  </button>
                </div>
              </div>
            </div>
          )}
        </motion.div>
      </div>
    </AppLayout>
  )
}

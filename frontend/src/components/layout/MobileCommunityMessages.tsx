'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '@/contexts/AuthContext'
import {
  fetchDMConversations,
  fetchDMMessages,
  sendDMMessage,
  type DMConversation,
  type DMMessage,
} from '@/lib/api'
import {
  MessageCircle,
  Send,
  ArrowLeft,
  Search,
  Plus,
  Loader2,
  CheckCheck,
  MoreHorizontal,
  Smile,
  X,
  Phone,
  Video,
} from 'lucide-react'

const API = process.env.NEXT_PUBLIC_API_URL || ''

function relativeTime(iso: string | null): string {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatMessageTime(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  if (diff < 86400000) {
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const AVATAR_GRADIENTS = [
  'from-blue-500 to-cyan-500',
  'from-purple-500 to-pink-500',
  'from-emerald-500 to-teal-500',
  'from-amber-500 to-orange-500',
  'from-rose-500 to-red-500',
  'from-indigo-500 to-violet-500',
]

function Avatar({ username, size = 'md', showOnline = false }: { username: string; size?: 'xs' | 'sm' | 'md' | 'lg'; showOnline?: boolean }) {
  const sizeMap = { xs: 'w-7 h-7 text-[10px]', sm: 'w-9 h-9 text-xs', md: 'w-11 h-11 text-sm', lg: 'w-16 h-16 text-xl' }
  const gradIdx = username.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_GRADIENTS.length
  return (
    <div className="relative shrink-0">
      <div className={`${sizeMap[size]} rounded-full bg-gradient-to-br ${AVATAR_GRADIENTS[gradIdx]} flex items-center justify-center font-bold text-white`}>
        {username.charAt(0).toUpperCase()}
      </div>
      {showOnline && (
        <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-[#0A0E1A]" />
      )}
    </div>
  )
}

// ── Conversation List ──────────────────────────────────────────────────────────

function ConversationList({
  conversations,
  selectedId,
  onSelect,
  loading,
}: {
  conversations: DMConversation[]
  selectedId: number | null
  onSelect: (id: number) => void
  loading: boolean
}) {
  const [search, setSearch] = useState('')

  const filtered = search
    ? conversations.filter((c) => c.other_user.username.toLowerCase().includes(search.toLowerCase()))
    : conversations

  return (
    <div className="flex flex-col h-full bg-[#0A0E1A]">
      {/* Header */}
      <div className="px-4 pt-safe pt-4 pb-3 bg-[#0A0E1A]/95 backdrop-blur-xl border-b border-white/[0.06] shrink-0">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-xl font-bold text-white">Messages</h1>
          <Link
            href="/community/messages/new"
            className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white shadow-lg shadow-blue-500/20 active:scale-90"
          >
            <Plus className="w-4 h-4" />
          </Link>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
          <input
            type="text"
            placeholder="Search conversations..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2.5 bg-[#1A2332] border border-white/[0.06] rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/40"
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex flex-col gap-1 p-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex items-center gap-3 px-2 py-3">
                <div className="w-11 h-11 rounded-full bg-slate-800/60 animate-pulse shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 w-24 rounded bg-slate-800/60 animate-pulse" />
                  <div className="h-2.5 w-40 rounded bg-slate-800/40 animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full py-16 text-center px-6">
            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-blue-500/10 to-purple-500/10 border border-blue-500/20 flex items-center justify-center mb-4">
              <MessageCircle className="w-8 h-8 text-blue-400" />
            </div>
            <h3 className="text-base font-semibold text-white mb-1">No Messages Yet</h3>
            <p className="text-sm text-slate-500 mb-4">Start a conversation from a trader's profile</p>
            <Link
              href="/community"
              className="px-5 py-2.5 rounded-full bg-blue-500 text-white text-sm font-semibold active:scale-95"
            >
              Browse Community
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.03]">
            {filtered.map((conv) => (
              <button
                key={conv.id}
                onClick={() => onSelect(conv.id)}
                className={`w-full flex items-center gap-3 px-4 py-3.5 transition-colors text-left active:bg-white/[0.03] ${
                  selectedId === conv.id ? 'bg-blue-500/8' : ''
                }`}
              >
                <Avatar username={conv.other_user.username} showOnline={Math.random() > 0.5} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className={`text-sm truncate ${conv.unread ? 'font-semibold text-white' : 'text-slate-300 font-medium'}`}>
                      {conv.other_user.username}
                    </span>
                    <span className="text-[10px] text-slate-600 shrink-0 ml-2">{relativeTime(conv.last_message_at)}</span>
                  </div>
                  <p className={`text-xs truncate ${conv.unread ? 'text-slate-300 font-medium' : 'text-slate-500'}`}>
                    {conv.last_message_preview || 'No messages yet'}
                  </p>
                </div>
                {conv.unread && (
                  <div className="w-2.5 h-2.5 rounded-full bg-blue-500 shrink-0" />
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Message Thread ─────────────────────────────────────────────────────────────

function MessageThread({
  conversationId,
  otherUser,
  currentUserId,
  onBack,
}: {
  conversationId: number
  otherUser: { id: number; username: string }
  currentUserId: number
  onBack: () => void
}) {
  const [messages, setMessages] = useState<DMMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const wsRef = useRef<WebSocket | null>(null)

  const scrollToBottom = useCallback(() => {
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 80)
  }, [])

  useEffect(() => {
    setLoading(true)
    fetchDMMessages(conversationId).then((data) => {
      setMessages(data.messages || [])
      setLoading(false)
      scrollToBottom()
    })
  }, [conversationId, scrollToBottom])

  // WebSocket real-time updates
  useEffect(() => {
    try {
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const wsHost = API ? new URL(API).host : window.location.host
      const ws = new WebSocket(`${wsProtocol}//${wsHost}/api/v1/ws/community/dm:${conversationId}`)
      wsRef.current = ws
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data.type === 'message.new' && data.message) {
            setMessages((prev) => {
              if (prev.find((m) => m.id === data.message.id)) return prev
              return [...prev, data.message]
            })
            scrollToBottom()
          }
        } catch {}
      }
      return () => { ws.close(); wsRef.current = null }
    } catch {}
  }, [conversationId, scrollToBottom])

  useEffect(() => { inputRef.current?.focus() }, [conversationId])

  const handleSend = async () => {
    const text = input.trim()
    if (!text || sending) return
    setSending(true)
    setInput('')

    const tempMsg: DMMessage = {
      id: -Date.now(),
      sender_id: currentUserId,
      sender_username: 'you',
      body: text,
      parent_id: null,
      is_edited: false,
      created_at: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, tempMsg])
    scrollToBottom()

    try {
      const result = await sendDMMessage(conversationId, text)
      if (result.message_id) {
        setMessages((prev) => prev.map((m) => m.id === tempMsg.id ? { ...tempMsg, id: result.message_id! } : m))
      }
    } catch {
      setMessages((prev) => prev.filter((m) => m.id !== tempMsg.id))
    } finally {
      setSending(false)
    }
  }

  // Group messages by sender for avatar display
  const isGroupStart = (i: number) => i === 0 || messages[i - 1].sender_id !== messages[i].sender_id
  const isGroupEnd = (i: number) => i === messages.length - 1 || messages[i + 1]?.sender_id !== messages[i].sender_id

  return (
    <div className="flex flex-col h-full bg-[#0A0E1A]">
      {/* Thread Header */}
      <div className="flex items-center gap-3 px-4 pt-safe py-3 border-b border-white/[0.06] bg-[#0A0E1A]/95 backdrop-blur-xl shrink-0">
        <button
          onClick={onBack}
          className="w-8 h-8 rounded-full bg-[#1A2332] border border-white/10 flex items-center justify-center text-slate-300 active:scale-90 shrink-0"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <Avatar username={otherUser.username} size="sm" showOnline />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white truncate">{otherUser.username}</p>
          <p className="text-[10px] text-emerald-400 font-medium">Active now</p>
        </div>
        <div className="flex items-center gap-1.5">
          <button className="w-8 h-8 rounded-full bg-[#1A2332] border border-white/10 flex items-center justify-center text-slate-400 active:scale-90">
            <Phone className="w-3.5 h-3.5" />
          </button>
          <button className="w-8 h-8 rounded-full bg-[#1A2332] border border-white/10 flex items-center justify-center text-slate-400 active:scale-90">
            <Video className="w-3.5 h-3.5" />
          </button>
          <button className="w-8 h-8 rounded-full bg-[#1A2332] border border-white/10 flex items-center justify-center text-slate-400 active:scale-90">
            <MoreHorizontal className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-0.5">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="w-10 h-10 rounded-full border-2 border-blue-500/20 border-t-blue-500 animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center pb-8">
            <Avatar username={otherUser.username} size="lg" />
            <p className="text-base font-semibold text-white mt-4">{otherUser.username}</p>
            <p className="text-sm text-slate-500 mt-1 max-w-[220px]">Start your conversation — say something!</p>
          </div>
        ) : (
          messages.map((msg, i) => {
            const isMe = msg.sender_id === currentUserId
            const groupStart = isGroupStart(i)
            const groupEnd = isGroupEnd(i)
            const showTime = groupEnd && i < messages.length - 1 && (() => {
              const next = messages[i + 1]
              return (new Date(next.created_at).getTime() - new Date(msg.created_at).getTime()) > 300000
            })()

            return (
              <div key={msg.id}>
                {groupStart && !isMe && (
                  <div className={`flex items-end gap-2 ${groupStart ? 'mt-4' : 'mt-0.5'}`}>
                    <Avatar username={msg.sender_username} size="xs" />
                    <span className="text-[10px] text-slate-500 mb-1">{msg.sender_username}</span>
                  </div>
                )}
                <motion.div
                  initial={{ opacity: 0, y: 6, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ duration: 0.15 }}
                  className={`flex items-end gap-2 ${isMe ? 'flex-row-reverse' : ''} ${groupStart && !isMe ? '' : isMe ? 'mt-0.5' : 'ml-9 mt-0.5'}`}
                >
                  {!isMe && !groupStart && <div className="w-7 shrink-0" />}

                  <div
                    className={`relative max-w-[72%] px-3.5 py-2.5 text-sm leading-relaxed break-words ${
                      isMe
                        ? `bg-gradient-to-br from-blue-500 to-blue-600 text-white shadow-sm ${
                            groupStart && groupEnd ? 'rounded-2xl rounded-br-md'
                            : groupStart ? 'rounded-2xl rounded-br-sm'
                            : groupEnd ? 'rounded-2xl rounded-tr-sm rounded-br-md'
                            : 'rounded-2xl rounded-r-sm'
                          }`
                        : `bg-[#1A2332] text-slate-200 border border-white/[0.06] ${
                            groupStart && groupEnd ? 'rounded-2xl rounded-bl-md'
                            : groupStart ? 'rounded-2xl rounded-bl-sm'
                            : groupEnd ? 'rounded-2xl rounded-tl-sm rounded-bl-md'
                            : 'rounded-2xl rounded-l-sm'
                          }`
                    }`}
                  >
                    {msg.body}
                    {isMe && groupEnd && (
                      <div className="flex justify-end mt-0.5 -mb-0.5">
                        <CheckCheck className="w-3 h-3 text-blue-200/60" />
                      </div>
                    )}
                  </div>
                </motion.div>

                {showTime && (
                  <p className="text-center text-[10px] text-slate-600 my-3">
                    {formatMessageTime(messages[i + 1]?.created_at || msg.created_at)}
                  </p>
                )}
              </div>
            )
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Bar */}
      <div className="px-3 py-3 border-t border-white/[0.06] bg-[#0A0E1A]/95 backdrop-blur-xl pb-safe shrink-0">
        <div className="flex items-center gap-2">
          <div className="flex-1 flex items-center bg-[#1A2332] rounded-full border border-white/[0.08] focus-within:border-blue-500/40 transition-colors">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
              placeholder="Message..."
              className="flex-1 px-4 py-3 bg-transparent text-sm text-white placeholder-slate-500 focus:outline-none"
            />
            <button className="pr-3 text-slate-500 active:scale-90">
              <Smile className="w-5 h-5" />
            </button>
          </div>
          <button
            onClick={handleSend}
            disabled={!input.trim() || sending}
            className={`w-11 h-11 rounded-full flex items-center justify-center transition-all active:scale-90 shrink-0 ${
              input.trim()
                ? 'bg-gradient-to-br from-blue-500 to-blue-600 text-white shadow-lg shadow-blue-500/25'
                : 'bg-[#1A2332] text-slate-600'
            }`}
          >
            {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main Mobile Messages Component ─────────────────────────────────────────────

export default function MobileCommunityMessages() {
  const { user, isAuthenticated } = useAuth()
  const [conversations, setConversations] = useState<DMConversation[]>([])
  const [selectedConvId, setSelectedConvId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!isAuthenticated) return
    fetchDMConversations().then((data) => {
      setConversations(data.conversations || [])
      setLoading(false)
    })
  }, [isAuthenticated])

  const selectedConv = conversations.find((c) => c.id === selectedConvId)

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center h-[70vh] text-center px-6">
        <div className="w-20 h-20 rounded-full bg-gradient-to-br from-blue-500/10 to-purple-500/10 border border-blue-500/20 flex items-center justify-center mb-4">
          <MessageCircle className="w-8 h-8 text-blue-400" />
        </div>
        <h3 className="text-base font-semibold text-white mb-1">Sign In to Message</h3>
        <p className="text-sm text-slate-500 mb-4">Connect with traders and share insights</p>
        <Link
          href="/auth"
          className="px-6 py-2.5 rounded-full bg-blue-500 text-white text-sm font-semibold active:scale-95"
        >
          Sign In
        </Link>
      </div>
    )
  }

  return (
    <div className="relative h-[calc(100vh-5rem)] overflow-hidden">
      {/* Conversation List — slides out when thread selected */}
      <AnimatePresence initial={false}>
        {!selectedConvId && (
          <motion.div
            key="list"
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 350 }}
            className="absolute inset-0"
          >
            <ConversationList
              conversations={conversations}
              selectedId={selectedConvId}
              onSelect={setSelectedConvId}
              loading={loading}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Message Thread — slides in from right */}
      <AnimatePresence initial={false}>
        {selectedConvId && selectedConv && (
          <motion.div
            key={`thread-${selectedConvId}`}
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 350 }}
            className="absolute inset-0"
          >
            <MessageThread
              conversationId={selectedConv.id}
              otherUser={selectedConv.other_user}
              currentUserId={user?.id ?? 0}
              onBack={() => setSelectedConvId(null)}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

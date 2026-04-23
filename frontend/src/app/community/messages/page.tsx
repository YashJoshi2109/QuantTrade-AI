'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import Link from 'next/link'
import AppLayout from '@/components/AppLayout'
import MobileLayout from '@/components/layout/MobileLayout'
import MobileCommunityMessages from '@/components/layout/MobileCommunityMessages'
import { useAuth } from '@/contexts/AuthContext'
import { useCommunityWS } from '@/hooks/useCommunityWS'
import {
  fetchDMConversations,
  fetchDMMessages,
  sendDMMessage,
  createDMConversation,
  fetchUnreadDMCount,
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
  Check,
  CheckCheck,
  Circle,
  MoreHorizontal,
  Smile,
  ImageIcon,
  X,
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

// ── Conversation List ────────────────────────────────────────────────

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
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/[0.06]">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold text-white">Messages</h2>
          <Link
            href="/community/messages/new"
            className="p-2 rounded-lg text-slate-400 hover:text-blue-400 hover:bg-blue-500/10 transition-colors"
          >
            <Plus className="w-5 h-5" />
          </Link>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            type="text"
            placeholder="Search conversations"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-[#1a2130] border border-white/[0.06] rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/40"
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-5 h-5 text-slate-600 animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
            <MessageCircle className="w-12 h-12 text-slate-700 mb-3" />
            <p className="text-sm text-slate-500 mb-1">No messages yet</p>
            <p className="text-xs text-slate-600">Start a conversation from someone's profile</p>
          </div>
        ) : (
          <div>
            {filtered.map((conv) => (
              <button
                key={conv.id}
                onClick={() => onSelect(conv.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 transition-colors text-left ${
                  selectedId === conv.id
                    ? 'bg-blue-500/10 border-l-2 border-blue-500'
                    : 'hover:bg-white/[0.03] border-l-2 border-transparent'
                }`}
              >
                <div className="relative">
                  <Avatar username={conv.other_user.username} />
                  {conv.unread && (
                    <div className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-blue-500 rounded-full border-2 border-[#0a0a0f]" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className={`text-sm truncate ${conv.unread ? 'font-semibold text-white' : 'text-slate-300'}`}>
                      {conv.other_user.username}
                    </span>
                    <span className="text-[10px] text-slate-600 shrink-0 ml-2">
                      {relativeTime(conv.last_message_at)}
                    </span>
                  </div>
                  <p className={`text-xs truncate mt-0.5 ${conv.unread ? 'text-slate-300' : 'text-slate-500'}`}>
                    {conv.last_message_preview || 'No messages yet'}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Message Thread ───────────────────────────────────────────────────

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
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
  }, [])

  // Load messages
  useEffect(() => {
    setLoading(true)
    fetchDMMessages(conversationId).then((data) => {
      setMessages(data.messages || [])
      setLoading(false)
      scrollToBottom()
    })
  }, [conversationId, scrollToBottom])

  // WebSocket for real-time messages
  useEffect(() => {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsHost = API ? new URL(API).host : window.location.host
    const ws = new WebSocket(`${wsProtocol}//${wsHost}/api/v1/ws/community/dm:${conversationId}`)
    wsRef.current = ws

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.type === 'message.new' && data.message) {
          setMessages((prev) => {
            // Avoid duplicates
            if (prev.find((m) => m.id === data.message.id)) return prev
            return [...prev, data.message]
          })
          scrollToBottom()
        }
      } catch { /* ignore parse errors */ }
    }

    return () => {
      ws.close()
      wsRef.current = null
    }
  }, [conversationId, scrollToBottom])

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [conversationId])

  const handleSend = async () => {
    const text = input.trim()
    if (!text || sending) return

    setSending(true)
    setInput('')

    // Optimistic add
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
      // Replace temp message with real one
      if (result.message_id) {
        setMessages((prev) =>
          prev.map((m) => m.id === tempMsg.id ? { ...tempMsg, id: result.message_id! } : m)
        )
      }
    } catch {
      // Remove failed message
      setMessages((prev) => prev.filter((m) => m.id !== tempMsg.id))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Thread Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.06] bg-[#0d1117]/80 backdrop-blur-sm">
        <button onClick={onBack} className="lg:hidden p-1 rounded-lg text-slate-400 hover:text-white">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <Avatar username={otherUser.username} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white truncate">{otherUser.username}</p>
          <p className="text-[10px] text-slate-500">Active now</p>
        </div>
        <button className="p-2 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-white/[0.05]">
          <MoreHorizontal className="w-5 h-5" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="w-6 h-6 text-slate-600 animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Avatar username={otherUser.username} size="lg" />
            <p className="text-sm font-semibold text-white mt-3">{otherUser.username}</p>
            <p className="text-xs text-slate-500 mt-1">Start of your conversation</p>
          </div>
        ) : (
          messages.map((msg, i) => {
            const isMe = msg.sender_id === currentUserId
            const showAvatar = i === 0 || messages[i - 1].sender_id !== msg.sender_id
            const isLast = i === messages.length - 1 || messages[i + 1]?.sender_id !== msg.sender_id
            return (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.15 }}
                className={`flex items-end gap-2 ${isMe ? 'flex-row-reverse' : ''} ${showAvatar ? 'mt-3' : 'mt-0.5'}`}
              >
                {!isMe && showAvatar ? (
                  <Avatar username={msg.sender_username} size="sm" />
                ) : !isMe ? (
                  <div className="w-8" />
                ) : null}
                <div
                  className={`max-w-[70%] px-3 py-2 text-sm leading-relaxed ${
                    isMe
                      ? 'bg-blue-600 text-white rounded-2xl rounded-br-md'
                      : 'bg-[#1a2130] text-slate-200 rounded-2xl rounded-bl-md'
                  }`}
                >
                  {msg.body}
                  {isMe && isLast && (
                    <div className="flex justify-end mt-0.5">
                      <CheckCheck className="w-3 h-3 text-blue-200/60" />
                    </div>
                  )}
                </div>
              </motion.div>
            )
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="px-4 py-3 border-t border-white/[0.06] bg-[#0d1117]/80 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <div className="flex-1 flex items-center bg-[#1a2130] rounded-full border border-white/[0.06] focus-within:border-blue-500/40 transition-colors">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
              placeholder="Message..."
              className="flex-1 px-4 py-2.5 bg-transparent text-sm text-white placeholder-slate-500 focus:outline-none"
            />
            <button className="p-2 text-slate-500 hover:text-slate-300">
              <Smile className="w-5 h-5" />
            </button>
          </div>
          <button
            onClick={handleSend}
            disabled={!input.trim() || sending}
            className={`p-2.5 rounded-full transition-all ${
              input.trim()
                ? 'bg-blue-600 text-white hover:bg-blue-500 shadow-lg shadow-blue-500/20'
                : 'bg-[#1a2130] text-slate-600'
            }`}
          >
            {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Empty State ─────────────────────────────────────────────────────

function EmptyThread() {
  return (
    <div className="hidden lg:flex flex-col items-center justify-center h-full text-center px-8">
      <div className="w-20 h-20 rounded-full bg-gradient-to-br from-blue-500/10 to-cyan-500/10 border border-blue-500/20 flex items-center justify-center mb-4">
        <MessageCircle className="w-8 h-8 text-blue-400" />
      </div>
      <h3 className="text-lg font-semibold text-white mb-1">Your Messages</h3>
      <p className="text-sm text-slate-500 max-w-xs">
        Send private messages to other traders. Discuss strategies, share insights, and build your network.
      </p>
    </div>
  )
}

// ── Main Page ───────────────────────────────────────────────────────

function DesktopMessages() {
  const { user, isAuthenticated } = useAuth()
  const router = useRouter()
  const [conversations, setConversations] = useState<DMConversation[]>([])
  const [selectedConvId, setSelectedConvId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  const refreshConversations = useCallback(() => {
    fetchDMConversations().then((data) => {
      setConversations(data.conversations || [])
    })
  }, [])

  useEffect(() => {
    if (!isAuthenticated) return
    fetchDMConversations().then((data) => {
      setConversations(data.conversations || [])
      setLoading(false)
    })
    // Poll every 15s as fallback
    const iv = setInterval(refreshConversations, 15_000)
    return () => clearInterval(iv)
  }, [isAuthenticated, refreshConversations])

  // Real-time: listen on user's personal WS channel for new DMs
  const handleUserWS = useCallback((msg: { type: string; conversation_id?: number }) => {
    if (msg.type === 'dm.new' || msg.type === 'message.new') {
      refreshConversations()
    }
  }, [refreshConversations])
  useCommunityWS(user?.id ? `user:${user.id}` : null, handleUserWS)

  const selectedConv = conversations.find((c) => c.id === selectedConvId)

  if (!isAuthenticated) {
    return (
      <AppLayout hideFooter>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <MessageCircle className="w-12 h-12 text-slate-600 mx-auto mb-3" />
            <p className="text-slate-400">Sign in to view messages</p>
          </div>
        </div>
      </AppLayout>
    )
  }

  return (
    <AppLayout hideFooter>
      <div className="max-w-6xl mx-auto px-0 lg:px-6 py-0 lg:py-6">
        <div className="flex bg-[#0d1117] lg:rounded-2xl lg:border lg:border-white/[0.06] overflow-hidden" style={{ height: 'calc(100vh - 7rem)' }}>
          {/* Left — Conversation List */}
          <div className={`w-full lg:w-[360px] border-r border-white/[0.06] flex-shrink-0 ${
            selectedConvId ? 'hidden lg:flex lg:flex-col' : 'flex flex-col'
          }`}>
            <ConversationList
              conversations={conversations}
              selectedId={selectedConvId}
              onSelect={setSelectedConvId}
              loading={loading}
            />
          </div>

          {/* Right — Message Thread */}
          <div className={`flex-1 ${
            selectedConvId ? 'flex flex-col' : 'hidden lg:flex lg:flex-col'
          }`}>
            {selectedConv ? (
              <MessageThread
                conversationId={selectedConv.id}
                otherUser={selectedConv.other_user}
                currentUserId={user?.id ?? 0}
                onBack={() => setSelectedConvId(null)}
              />
            ) : (
              <EmptyThread />
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  )
}

export default function MessagesPage() {
  return (
    <>
      <div className="hidden lg:block"><DesktopMessages /></div>
      <div className="lg:hidden">
        <MobileLayout>
          <MobileCommunityMessages />
        </MobileLayout>
      </div>
    </>
  )
}

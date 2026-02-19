'use client'

import { useState, useCallback, useEffect } from 'react'
import ChatHeader from './ChatHeader'
import ChatMessages from './ChatMessages'
import ChatInput from './ChatInput'
import QuickActions from './QuickActions'
import ConversationHistory from './ConversationHistory'
import { useAuth } from '@/contexts/AuthContext'
import {
  sendChatMessage,
  listConversations,
  getConversationMessages,
  deleteConversation as apiDeleteConversation,
  type ConversationSummary,
  type StoredMessage,
} from '@/lib/api'
import type { AIResponseType, StructuredData } from './types'

export interface Message {
  id: number
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  analysisSummary?: string
  responseType?: AIResponseType
  structuredData?: StructuredData
  messageId?: number
  asOf?: string
  ttlExpiresAt?: string
  conversationId?: string
}

function storedToMessage(m: StoredMessage): Message {
  return {
    id: m.id,
    role: m.role as 'user' | 'assistant',
    content: m.content,
    timestamp: new Date(m.created_at),
    responseType: m.intent_type as AIResponseType | undefined,
    structuredData: m.payload_json as StructuredData | undefined,
    messageId: m.id,
    asOf: m.as_of || undefined,
    ttlExpiresAt: m.ttl_expires_at || undefined,
  }
}

export default function ChatWindow({ onClose }: { onClose: () => void }) {
  const { isAuthenticated } = useAuth()

  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)

  // Conversation state
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [loadingHistory, setLoadingHistory] = useState(false)

  // Load conversations on mount if authenticated
  useEffect(() => {
    if (isAuthenticated) {
      loadConversations()
    }
  }, [isAuthenticated])

  const loadConversations = useCallback(async () => {
    try {
      const convs = await listConversations()
      setConversations(convs)
    } catch {
      // silently fail
    }
  }, [])

  const openConversation = useCallback(async (convId: string) => {
    setLoadingHistory(true)
    try {
      const msgs = await getConversationMessages(convId)
      setMessages(msgs.map(storedToMessage))
      setConversationId(convId)
      setShowHistory(false)
    } catch {
      // silently fail
    } finally {
      setLoadingHistory(false)
    }
  }, [])

  const startNewChat = useCallback(() => {
    setMessages([])
    setConversationId(null)
    setShowHistory(false)
  }, [])

  const handleDeleteConversation = useCallback(async (convId: string) => {
    try {
      await apiDeleteConversation(convId)
      setConversations((prev) => prev.filter((c) => c.id !== convId))
      if (convId === conversationId) {
        startNewChat()
      }
    } catch {
      // silently fail
    }
  }, [conversationId, startNewChat])

  const handleSendMessage = useCallback(async (text: string) => {
    if (!text.trim() || !isAuthenticated) return

    const userMessage: Message = {
      id: Date.now(),
      role: 'user',
      content: text,
      timestamp: new Date(),
    }
    setMessages((prev) => [...prev, userMessage])
    setInput('')
    setIsTyping(true)

    try {
      const response = await sendChatMessage({
        message: text,
        conversation_id: conversationId || undefined,
        include_news: true,
        include_filings: true,
      })

      // Track conversation_id from response
      if (response.conversation_id && !conversationId) {
        setConversationId(response.conversation_id)
      }

      const aiMessage: Message = {
        id: Date.now() + 1,
        role: 'assistant',
        content: response.response,
        timestamp: new Date(),
        analysisSummary: response.analysis_summary,
        responseType: (response.response_type as AIResponseType) || 'text',
        structuredData: response.structured_data as StructuredData | undefined,
        messageId: response.message_id,
        asOf: response.meta?.as_of,
        ttlExpiresAt: response.meta?.ttl_expires_at,
        conversationId: response.conversation_id,
      }
      setMessages((prev) => [...prev, aiMessage])

      // Refresh conversation list
      loadConversations()
    } catch (error: any) {
      const errMsg = error?.message === 'AUTH_REQUIRED'
        ? 'Please sign in to use the chatbot.'
        : 'Sorry, I encountered an error. Please try again.'
      setMessages((prev) => [
        ...prev,
        { id: Date.now() + 1, role: 'assistant', content: errMsg, timestamp: new Date() },
      ])
    } finally {
      setIsTyping(false)
    }
  }, [conversationId, isAuthenticated, loadConversations])

  const handleRefreshMessage = useCallback(async (messageId: number) => {
    if (!conversationId || !messageId) return

    try {
      const { refreshChatMessage } = await import('@/lib/api')
      const result = await refreshChatMessage(conversationId, messageId)
      setMessages((prev) =>
        prev.map((m) =>
          m.messageId === messageId
            ? {
                ...m,
                structuredData: result.payload_json as StructuredData | undefined,
                asOf: result.as_of,
                ttlExpiresAt: result.ttl_expires_at,
              }
            : m
        )
      )
    } catch {
      // silently fail
    }
  }, [conversationId])

  const chatContent = (
    <>
      {showHistory ? (
        <ConversationHistory
          conversations={conversations}
          currentId={conversationId}
          onSelect={openConversation}
          onDelete={handleDeleteConversation}
          onNewChat={startNewChat}
          onClose={() => setShowHistory(false)}
          loading={loadingHistory}
        />
      ) : (
        <>
          <ChatMessages
            messages={messages}
            isTyping={isTyping}
            conversationId={conversationId}
            onRefresh={handleRefreshMessage}
          />
          {isAuthenticated && <QuickActions onSend={handleSendMessage} />}
        </>
      )}
      <ChatInput
        value={input}
        onChange={setInput}
        onSend={handleSendMessage}
        isLoading={isTyping}
        isAuthenticated={isAuthenticated}
      />
    </>
  )

  return (
    <>
      {/* Desktop: anchored floating window */}
      {!isFullscreen && (
        <div className="hidden md:block fixed bottom-32 right-8 w-[400px] h-[600px] z-50 animate-slide-in-bottom">
          <div className="relative w-full h-full rounded-2xl overflow-hidden">
            <div className="absolute -inset-[1px] rounded-2xl bg-gradient-to-b from-cyan-500/20 via-white/[0.08] to-purple-500/20" />
            <div className="absolute inset-0 rounded-2xl bg-[#0A0E1A]/95 backdrop-blur-2xl" />
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-48 h-24 bg-cyan-500/[0.07] blur-3xl pointer-events-none" />
            <div className="absolute bottom-0 right-0 w-32 h-32 bg-purple-500/[0.05] blur-3xl pointer-events-none" />

            <div className="relative flex flex-col h-full">
              <ChatHeader
                onClose={onClose}
                isFullscreen={false}
                onToggleFullscreen={() => setIsFullscreen(true)}
                onToggleHistory={() => setShowHistory((v) => !v)}
                showingHistory={showHistory}
                isAuthenticated={isAuthenticated}
              />
              {chatContent}
            </div>
          </div>
        </div>
      )}

      {/* Desktop: full-screen mode */}
      {isFullscreen && (
        <div className="hidden md:flex fixed inset-0 bg-[#050810]/90 backdrop-blur-2xl z-50 flex-col animate-slide-in-bottom">
          <div className="mx-auto w-full max-w-3xl h-full md:mt-8 md:mb-8 overflow-hidden flex flex-col relative">
            <div className="absolute -inset-[1px] rounded-3xl bg-gradient-to-b from-cyan-500/15 via-white/[0.06] to-purple-500/15" />
            <div className="absolute inset-0 rounded-3xl bg-[#0A0E1A]/95 backdrop-blur-2xl" />
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-64 h-32 bg-cyan-500/[0.05] blur-3xl pointer-events-none" />

            <div className="relative flex flex-col h-full rounded-3xl overflow-hidden">
              <ChatHeader
                onClose={onClose}
                isFullscreen
                onToggleFullscreen={() => setIsFullscreen(false)}
                onToggleHistory={() => setShowHistory((v) => !v)}
                showingHistory={showHistory}
                isAuthenticated={isAuthenticated}
              />
              {chatContent}
            </div>
          </div>
        </div>
      )}

      {/* Mobile: full-screen overlay */}
      <div className="md:hidden fixed inset-0 z-50 flex flex-col animate-slide-in-bottom">
        <div className="absolute inset-0 bg-[#0A0E1A]" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-72 h-48 bg-gradient-to-b from-cyan-500/[0.08] via-blue-500/[0.04] to-transparent blur-3xl pointer-events-none" />

        <div className="relative flex flex-col h-full">
          <ChatHeader
            onClose={onClose}
            onToggleHistory={() => setShowHistory((v) => !v)}
            showingHistory={showHistory}
            isAuthenticated={isAuthenticated}
          />
          {chatContent}
        </div>
      </div>
    </>
  )
}

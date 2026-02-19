'use client'

import { useState, useCallback, useEffect } from 'react'
import ChatHeader from './ChatHeader'
import ChatMessages from './ChatMessages'
import ChatInput from './ChatInput'
import QuickActions from './QuickActions'
import { sendChatMessage } from '@/lib/api'
import type { AIResponseType, StructuredData } from './types'

const STORAGE_KEY = 'quanttrade_chat_messages'
const SESSION_KEY = 'quanttrade_chat_session'

export interface Message {
  id: number
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  analysisSummary?: string
  responseType?: AIResponseType
  structuredData?: StructuredData
}

interface StoredMessage {
  id: number
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  analysisSummary?: string
  responseType?: AIResponseType
  structuredData?: StructuredData
}

function loadStoredMessages(): Message[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: StoredMessage[] = JSON.parse(raw)
    return parsed.map((m) => ({ ...m, timestamp: new Date(m.timestamp) }))
  } catch {
    return []
  }
}

function loadStoredSessionId(): string {
  try {
    const id = sessionStorage.getItem(SESSION_KEY)
    if (id) return id
  } catch { /* ignore */ }
  const newId = crypto.randomUUID()
  try { sessionStorage.setItem(SESSION_KEY, newId) } catch { /* ignore */ }
  return newId
}

export default function ChatWindow({ onClose }: { onClose: () => void }) {
  const [messages, setMessages] = useState<Message[]>(() => loadStoredMessages())
  const [input, setInput] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const [sessionId] = useState(() => loadStoredSessionId())
  const [isFullscreen, setIsFullscreen] = useState(false)

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages))
    } catch { /* ignore */ }
  }, [messages])

  const handleSendMessage = useCallback(async (text: string) => {
    if (!text.trim()) return

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
        session_id: sessionId,
        include_news: true,
        include_filings: true,
      })

      const aiMessage: Message = {
        id: Date.now() + 1,
        role: 'assistant',
        content: response.response,
        timestamp: new Date(),
        analysisSummary: response.analysis_summary,
        responseType: (response.response_type as AIResponseType) || 'text',
        structuredData: response.structured_data as StructuredData | undefined,
      }
      setMessages((prev) => [...prev, aiMessage])
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now() + 1,
          role: 'assistant',
          content: 'Sorry, I encountered an error. Please try again.',
          timestamp: new Date(),
        },
      ])
    } finally {
      setIsTyping(false)
    }
  }, [sessionId])

  return (
    <>
      {/* Desktop: anchored floating window */}
      {!isFullscreen && (
        <div className="hidden md:block fixed bottom-32 right-8 w-[400px] h-[600px] z-50 animate-slide-in-bottom">
          {/* Glass container with gradient border effect */}
          <div className="relative w-full h-full rounded-2xl overflow-hidden">
            {/* Gradient border glow */}
            <div className="absolute -inset-[1px] rounded-2xl bg-gradient-to-b from-cyan-500/20 via-white/[0.08] to-purple-500/20" />
            <div className="absolute inset-0 rounded-2xl bg-[#0A0E1A]/95 backdrop-blur-2xl" />

            {/* Ambient glow effects */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-48 h-24 bg-cyan-500/[0.07] blur-3xl pointer-events-none" />
            <div className="absolute bottom-0 right-0 w-32 h-32 bg-purple-500/[0.05] blur-3xl pointer-events-none" />

            <div className="relative flex flex-col h-full">
              <ChatHeader
                onClose={onClose}
                isFullscreen={false}
                onToggleFullscreen={() => setIsFullscreen(true)}
              />
              <ChatMessages messages={messages} isTyping={isTyping} />
              <QuickActions onSend={handleSendMessage} />
              <ChatInput
                value={input}
                onChange={setInput}
                onSend={handleSendMessage}
                isLoading={isTyping}
              />
            </div>
          </div>
        </div>
      )}

      {/* Desktop: full-screen mode */}
      {isFullscreen && (
        <div className="hidden md:flex fixed inset-0 bg-[#050810]/90 backdrop-blur-2xl z-50 flex-col animate-slide-in-bottom">
          <div className="mx-auto w-full max-w-3xl h-full md:mt-8 md:mb-8 overflow-hidden flex flex-col relative">
            {/* Glass container */}
            <div className="absolute -inset-[1px] rounded-3xl bg-gradient-to-b from-cyan-500/15 via-white/[0.06] to-purple-500/15" />
            <div className="absolute inset-0 rounded-3xl bg-[#0A0E1A]/95 backdrop-blur-2xl" />

            {/* Ambient glow */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-64 h-32 bg-cyan-500/[0.05] blur-3xl pointer-events-none" />

            <div className="relative flex flex-col h-full rounded-3xl overflow-hidden">
              <ChatHeader
                onClose={onClose}
                isFullscreen
                onToggleFullscreen={() => setIsFullscreen(false)}
              />
              <ChatMessages messages={messages} isTyping={isTyping} />
              <QuickActions onSend={handleSendMessage} />
              <ChatInput
                value={input}
                onChange={setInput}
                onSend={handleSendMessage}
                isLoading={isTyping}
              />
            </div>
          </div>
        </div>
      )}

      {/* Mobile: full-screen overlay */}
      <div className="md:hidden fixed inset-0 z-50 flex flex-col animate-slide-in-bottom">
        {/* Background with gradient effect */}
        <div className="absolute inset-0 bg-[#0A0E1A]" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-72 h-48 bg-gradient-to-b from-cyan-500/[0.08] via-blue-500/[0.04] to-transparent blur-3xl pointer-events-none" />

        <div className="relative flex flex-col h-full">
          <ChatHeader onClose={onClose} />
          <ChatMessages messages={messages} isTyping={isTyping} />
          <QuickActions onSend={handleSendMessage} />
          <ChatInput
            value={input}
            onChange={setInput}
            onSend={handleSendMessage}
            isLoading={isTyping}
          />
        </div>
      </div>
    </>
  )
}

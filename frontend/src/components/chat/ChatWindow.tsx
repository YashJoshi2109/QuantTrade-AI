'use client'

import { useState, useCallback } from 'react'
import ChatHeader from './ChatHeader'
import ChatMessages from './ChatMessages'
import ChatInput from './ChatInput'
import QuickActions from './QuickActions'
import { sendChatMessage } from '@/lib/api'


export interface Message {
  id: number
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  analysisSummary?: string
}

export default function ChatWindow({ onClose }: { onClose: () => void }) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const [sessionId] = useState(() => crypto.randomUUID())
  const [isFullscreen, setIsFullscreen] = useState(false)

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
      {/* Desktop: anchored floating window above the button */}
      {!isFullscreen && (
        <div className="hidden md:block fixed bottom-32 right-8 w-[400px] h-[600px] bg-[#0A0E1A]/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-white/10 overflow-hidden animate-slide-in-bottom z-50">
          <div className="flex flex-col h-full">
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
      )}

      {/* Desktop: full-screen mode */}
      {isFullscreen && (
        <div className="hidden md:flex fixed inset-0 bg-[#0A0E1A]/95 backdrop-blur-2xl z-50 flex-col animate-slide-in-bottom">
          <div className="mx-auto w-full max-w-5xl h-full md:mt-6 md:mb-6 md:rounded-3xl md:border md:border-white/10 md:shadow-2xl overflow-hidden flex flex-col bg-[#0A0E1A]">
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
      )}

      {/* Mobile: full-screen overlay */}
      <div className="md:hidden fixed inset-0 bg-[#0A0E1A] z-50 flex flex-col animate-slide-in-bottom">
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
    </>
  )
}

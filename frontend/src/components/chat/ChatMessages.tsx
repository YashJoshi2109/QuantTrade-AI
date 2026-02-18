import { useEffect, useRef } from 'react'
import ChatMessage from './ChatMessage'
import TypingIndicator from './TypingIndicator'
import WelcomeScreen from './WelcomeScreen'
import type { Message } from './ChatWindow'

interface ChatMessagesProps {
  messages: Message[]
  isTyping: boolean
}

export default function ChatMessages({ messages, isTyping }: ChatMessagesProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isTyping])

  return (
    <div className="relative flex-1 overflow-y-auto min-h-0">
      {/* Subtle gradient background for depth */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-cyan-500/[0.01] to-transparent pointer-events-none" />

      <div className="relative px-4 py-4 space-y-4">
        {messages.length === 0 && <WelcomeScreen />}
        {messages.map((message) => (
          <ChatMessage key={message.id} message={message} />
        ))}
        {isTyping && <TypingIndicator />}
        <div ref={messagesEndRef} />
      </div>
    </div>
  )
}

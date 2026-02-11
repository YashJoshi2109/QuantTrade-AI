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
    <div className="flex-1 overflow-y-auto px-4 py-6 space-y-5 min-h-0">
      {messages.length === 0 && <WelcomeScreen />}
      {messages.map((message) => (
        <ChatMessage key={message.id} message={message} />
      ))}
      {isTyping && <TypingIndicator />}
      <div ref={messagesEndRef} />
    </div>
  )
}

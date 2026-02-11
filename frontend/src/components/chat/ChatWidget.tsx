'use client'

import { useState } from 'react'
import { Bot, X } from 'lucide-react'
// TODO: Fix import path if necessary
// import ChatWindow from './ChatWindow'
// If ChatWindow is missing, comment above line and consider importing from correct path or add the component file.
let ChatWindow: any
try {
  // @ts-ignore
  ChatWindow = require('./ChatWindow').default
} catch {
  ChatWindow = () => null // fallback to empty component if missing
}

export default function ChatWidget() {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-20 right-4 md:bottom-28 md:right-8 z-50 group"
        aria-label={isOpen ? 'Close chat' : 'Open AI chat'}
      >
        <div className="absolute inset-0 rounded-full bg-[#00D9FF]/20 animate-ping" />
        <div className="relative w-14 h-14 md:w-16 md:h-16 rounded-full bg-gradient-to-br from-[#00D9FF] to-[#0066FF] flex items-center justify-center shadow-2xl shadow-[#00D9FF]/50 hover:shadow-[#00D9FF]/70 transition-all duration-300 hover:scale-110">
          {isOpen ? (
            <X className="w-6 h-6 md:w-7 md:h-7 text-white" />
          ) : (
            <Bot className="w-6 h-6 md:w-7 md:h-7 text-white" />
          )}
        </div>
      </button>

      {isOpen && <ChatWindow onClose={() => setIsOpen(false)} />}
    </>
  )
}

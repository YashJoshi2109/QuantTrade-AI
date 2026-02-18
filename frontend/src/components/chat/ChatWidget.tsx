'use client'

import { useState } from 'react'
import { Zap, X } from 'lucide-react'
import ChatWindow from './ChatWindow'

export default function ChatWidget() {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-20 right-4 md:bottom-28 md:right-8 z-50 group"
        aria-label={isOpen ? 'Close chat' : 'Open AI chat'}
      >
        {/* Pulse ring */}
        {!isOpen && (
          <div className="absolute inset-0 rounded-full bg-gradient-to-br from-cyan-500/30 to-blue-500/30 animate-ping" />
        )}

        {/* Button */}
        <div className="relative w-14 h-14 md:w-14 md:h-14 rounded-full bg-gradient-to-br from-[#00D9FF] via-[#0066FF] to-[#7C3AED] flex items-center justify-center shadow-2xl shadow-cyan-500/30 hover:shadow-cyan-500/50 transition-all duration-300 hover:scale-105 active:scale-95">
          {isOpen ? (
            <X className="w-5 h-5 text-white" />
          ) : (
            <Zap className="w-5 h-5 text-white" />
          )}
        </div>
      </button>

      {isOpen && <ChatWindow onClose={() => setIsOpen(false)} />}
    </>
  )
}

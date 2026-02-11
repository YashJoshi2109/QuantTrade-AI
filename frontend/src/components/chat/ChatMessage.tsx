import { Bot, Copy } from 'lucide-react'
import { useState } from 'react'
import type { Message } from './ChatWindow'

export default function ChatMessage({ message }: { message: Message }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const formatTime = (date: Date) =>
    date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

  if (message.role === 'user') {
    return (
      <div className="flex justify-end animate-fade-in">
        <div className="max-w-[85%]">
          <div className="bg-gradient-to-br from-[#00D9FF] to-[#0066FF] rounded-2xl rounded-br-md px-4 py-3 shadow-lg">
            <p className="text-white text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>
          </div>
          <p className="text-xs text-gray-500 mt-1 text-right">{formatTime(message.timestamp)}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex gap-3 animate-fade-in">
      <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#00D9FF] to-[#0066FF] flex items-center justify-center flex-shrink-0">
        <Bot className="w-5 h-5 text-white" />
      </div>
      <div className="flex-1 space-y-2 max-w-[85%]">
        <div className="bg-[#1A2332] rounded-2xl rounded-tl-md px-4 py-3 border border-white/5">
          <p className="text-gray-100 text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>
        </div>
        <div className="flex items-center gap-3 px-2">
          <button
            onClick={handleCopy}
            className="text-gray-500 hover:text-white transition-colors p-1"
            title="Copy"
          >
            <Copy className="w-3.5 h-3.5" />
          </button>
          <span className="text-xs text-gray-500">{formatTime(message.timestamp)}</span>
        </div>
      </div>
    </div>
  )
}

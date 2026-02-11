import { Bot } from 'lucide-react'

export default function TypingIndicator() {
  return (
    <div className="flex gap-3 items-center animate-fade-in">
      <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#00D9FF] to-[#0066FF] flex items-center justify-center">
        <Bot className="w-5 h-5 text-white" />
      </div>
      <div className="bg-[#1A2332] rounded-2xl rounded-tl-md px-5 py-3 border border-white/5">
        <div className="flex gap-1.5">
          <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
          <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '200ms' }} />
          <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '400ms' }} />
        </div>
      </div>
    </div>
  )
}

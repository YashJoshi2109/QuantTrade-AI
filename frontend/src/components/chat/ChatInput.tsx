import { Send, Loader2 } from 'lucide-react'
import { useRef, KeyboardEvent } from 'react'

interface ChatInputProps {
  value: string
  onChange: (value: string) => void
  onSend: (message: string) => void
  isLoading: boolean
}

export default function ChatInput({ value, onChange, onSend, isLoading }: ChatInputProps) {
  const handleSend = () => {
    if (value.trim() && !isLoading) onSend(value)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="shrink-0 border-t border-white/10 p-4 bg-[#0A0E1A]">
      <div className="flex items-end gap-2">
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask me about any stock..."
          rows={1}
          maxLength={500}
          className="flex-1 w-full bg-[#1A2332] border border-white/10 focus:border-[#00D9FF]/50 rounded-2xl px-4 py-3 text-white placeholder:text-gray-500 focus:outline-none resize-none max-h-32"
        />
        <button
          onClick={handleSend}
          disabled={!value.trim() || isLoading}
          className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#00D9FF] to-[#0066FF] flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed hover:shadow-xl transition-all"
        >
          {isLoading ? <Loader2 className="w-5 h-5 text-white animate-spin" /> : <Send className="w-5 h-5 text-white" />}
        </button>
      </div>
      <p className="text-xs text-gray-600 mt-2">Enter to send · Shift+Enter for new line</p>
    </div>
  )
}

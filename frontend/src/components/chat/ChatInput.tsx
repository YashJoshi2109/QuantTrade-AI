import { Send, Loader2, Mic } from 'lucide-react'
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
    <div className="shrink-0 p-3 pb-4">
      {/* Glass input container */}
      <div className="relative rounded-2xl bg-white/[0.04] backdrop-blur-xl border border-white/[0.08] focus-within:border-cyan-500/30 focus-within:bg-white/[0.06] transition-all shadow-lg shadow-black/20">
        {/* Subtle glow on focus */}
        <div className="absolute -inset-px rounded-2xl bg-gradient-to-r from-cyan-500/0 via-cyan-500/0 to-purple-500/0 opacity-0 focus-within:opacity-100 transition-opacity pointer-events-none" />

        <div className="relative flex items-end gap-2 p-2">
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type your question..."
            rows={1}
            maxLength={500}
            className="flex-1 bg-transparent px-3 py-2 text-[13px] text-white placeholder:text-slate-600 focus:outline-none resize-none max-h-24 leading-relaxed"
          />
          <button
            onClick={handleSend}
            disabled={!value.trim() || isLoading}
            className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#00D9FF] to-[#0066FF] flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed hover:shadow-lg hover:shadow-cyan-500/25 transition-all active:scale-95 flex-shrink-0"
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 text-white animate-spin" />
            ) : (
              <Send className="w-4 h-4 text-white" />
            )}
          </button>
        </div>
      </div>
      <p className="text-[10px] text-slate-600 mt-1.5 text-center">
        Enter to send · Shift+Enter for new line
      </p>
    </div>
  )
}

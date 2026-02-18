import { Zap } from 'lucide-react'

export default function TypingIndicator() {
  return (
    <div className="flex gap-2.5 items-start animate-fade-in">
      <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#00D9FF]/20 to-[#7C3AED]/20 flex items-center justify-center flex-shrink-0 border border-white/[0.06]">
        <Zap className="w-4 h-4 text-cyan-400" />
      </div>
      <div className="bg-white/[0.04] backdrop-blur-sm rounded-2xl rounded-tl-sm px-5 py-3 border border-white/[0.06]">
        <div className="flex gap-1">
          <div className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
          <div className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
          <div className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
      </div>
    </div>
  )
}

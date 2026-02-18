import { Sparkles, X, Maximize2, Minimize2 } from 'lucide-react'
import Image from 'next/image'

interface ChatHeaderProps {
  onClose: () => void
  isFullscreen?: boolean
  onToggleFullscreen?: () => void
}

export default function ChatHeader({ onClose, isFullscreen, onToggleFullscreen }: ChatHeaderProps) {
  return (
    <div className="relative shrink-0">
      {/* Glass background with gradient accent */}
      <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/[0.06] via-blue-500/[0.04] to-purple-500/[0.06]" />
      <div className="absolute inset-0 backdrop-blur-xl bg-[#0A0E1A]/60" />

      <div className="relative border-b border-white/[0.06] px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* Company logo with gradient ring */}
          <div className="relative">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#00D9FF] via-[#0066FF] to-[#7C3AED] p-[1.5px] shadow-lg shadow-cyan-500/20">
              <div className="w-full h-full rounded-[10px] bg-[#0A0E1A] flex items-center justify-center overflow-hidden">
                <Image src="/logo.png" alt="QuantTrade AI" width={24} height={24} className="object-contain" />
              </div>
            </div>
            <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-emerald-400 rounded-full border-2 border-[#0A0E1A]" />
          </div>

          <div>
            <div className="flex items-center gap-1.5">
              <h3 className="text-white font-semibold text-[14px]">Quant AI</h3>
              <Sparkles className="w-3 h-3 text-cyan-400" />
            </div>
            <p className="text-emerald-400/80 text-[10px] font-medium flex items-center gap-1">
              <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full" />
              Online
            </p>
          </div>
        </div>

        <div className="flex items-center gap-0.5">
          {onToggleFullscreen && (
            <button
              className="p-2 hover:bg-white/[0.06] rounded-lg transition-all active:scale-95"
              aria-label={isFullscreen ? 'Exit full screen' : 'Enter full screen'}
              onClick={onToggleFullscreen}
            >
              {isFullscreen ? (
                <Minimize2 className="w-4 h-4 text-slate-500 hover:text-white transition-colors" />
              ) : (
                <Maximize2 className="w-4 h-4 text-slate-500 hover:text-white transition-colors" />
              )}
            </button>
          )}
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/[0.06] rounded-lg transition-all active:scale-95"
            aria-label="Close"
          >
            <X className="w-4 h-4 text-slate-500 hover:text-white transition-colors" />
          </button>
        </div>
      </div>
    </div>
  )
}

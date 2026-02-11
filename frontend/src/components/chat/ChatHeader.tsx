import { Sparkles, MoreVertical, X, Maximize2, Minimize2 } from 'lucide-react'

interface ChatHeaderProps {
  onClose: () => void
  isFullscreen?: boolean
  onToggleFullscreen?: () => void
}

export default function ChatHeader({ onClose, isFullscreen, onToggleFullscreen }: ChatHeaderProps) {
  return (
    <div className="relative shrink-0">
      <div className="absolute inset-0 bg-gradient-to-r from-[#00D9FF]/10 via-[#0066FF]/5 to-transparent" />
      <div className="relative border-b border-white/10 px-5 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-11 h-11 rounded-full bg-gradient-to-br from-[#00D9FF] via-[#0066FF] to-[#00D9FF] p-[2px]">
              <div className="w-full h-full rounded-full bg-[#0A0E1A] flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-[#00D9FF]" />
              </div>
            </div>
            <div className="absolute bottom-0 right-0 w-3 h-3 bg-[#00FF88] rounded-full border-2 border-[#0A0E1A] animate-pulse" />
          </div>
          <div>
            <h3 className="text-white font-bold text-base">Quant AI</h3>
            <p className="text-[#00FF88] text-xs flex items-center gap-1.5">
              <span className="w-2 h-2 bg-[#00FF88] rounded-full animate-pulse" />
              Online · Quant AI assistant
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {onToggleFullscreen && (
            <button
              className="p-2 hover:bg-white/5 rounded-xl transition-all active:scale-95"
              aria-label={isFullscreen ? 'Exit full screen' : 'Enter full screen'}
              onClick={onToggleFullscreen}
            >
              {isFullscreen ? (
                <Minimize2 className="w-4 h-4 text-gray-400" />
              ) : (
                <Maximize2 className="w-4 h-4 text-gray-400" />
              )}
            </button>
          )}
          <button className="p-2 hover:bg-white/5 rounded-xl transition-all active:scale-95" aria-label="More options">
            <MoreVertical className="w-4 h-4 text-gray-400" />
          </button>
          <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-xl transition-all active:scale-95" aria-label="Close">
            <X className="w-4 h-4 text-gray-400" />
          </button>
        </div>
      </div>
    </div>
  )
}

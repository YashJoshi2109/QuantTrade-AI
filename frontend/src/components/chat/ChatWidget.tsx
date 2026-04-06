'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Sparkles } from 'lucide-react'

// Routes where the floating AI Copilot button should NOT appear
const HIDDEN_ON: string[] = ['/auth', '/terms', '/legal']

export default function ChatWidget() {
  const pathname = usePathname()
  if (HIDDEN_ON.some((p) => pathname.startsWith(p))) return null

  return (
    <Link
      href="/copilot"
      className="fixed bottom-6 right-6 md:bottom-8 md:right-8 z-50 group"
      aria-label="Open AI Copilot"
    >
      {/* Pulse ring */}
      <div className="absolute inset-0 rounded-full bg-[#007AFF]/30 animate-ping" />

      {/* Button */}
      <div className="relative w-14 h-14 rounded-full bg-[#007AFF] flex items-center justify-center shadow-2xl shadow-[rgba(0,122,255,0.4)] hover:shadow-[rgba(0,122,255,0.6)] hover:bg-[#0066CC] transition-all duration-300 hover:scale-105 active:scale-95">
        <Sparkles className="w-6 h-6 text-white" />
      </div>

      {/* Tooltip */}
      <div className="absolute bottom-full right-0 mb-3 px-3 py-1.5 bg-[#0D1117] border border-[rgba(0,122,255,0.3)] rounded-lg text-xs text-white whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity shadow-xl pointer-events-none">
        AI Copilot
        <div className="absolute top-full right-4 w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-[#0D1117]" />
      </div>
    </Link>
  )
}

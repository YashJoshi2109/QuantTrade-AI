'use client'

import { Zap, Copy, Check, ThumbsUp, ThumbsDown, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import dynamic from 'next/dynamic'
import type { Message } from './ChatWindow'

const AIMessageContainer = dynamic(() => import('./visual/AIMessageContainer'), { ssr: false })

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
        <div className="max-w-[80%]">
          <div className="bg-gradient-to-br from-[#00D9FF] to-[#0066FF] rounded-2xl rounded-br-sm px-4 py-2.5 shadow-lg shadow-cyan-500/10">
            <p className="text-white text-[13px] leading-relaxed whitespace-pre-wrap">{message.content}</p>
          </div>
          <p className="text-[10px] text-slate-600 mt-1 text-right pr-1">{formatTime(message.timestamp)}</p>
        </div>
      </div>
    )
  }

  const hasVisual = message.responseType && message.responseType !== 'text' && message.structuredData

  return (
    <div className="flex gap-2.5 animate-fade-in">
      {/* AI avatar */}
      <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#00D9FF]/20 to-[#7C3AED]/20 flex items-center justify-center flex-shrink-0 border border-white/[0.06] mt-0.5">
        <Zap className="w-4 h-4 text-cyan-400" />
      </div>

      <div className="flex-1 space-y-2 min-w-0">
        {/* Visual structured response */}
        {hasVisual && <AIMessageContainer message={message} />}

        {/* Analysis summary card (when present and no visual) */}
        {message.analysisSummary && !hasVisual && (
          <div className="rounded-2xl rounded-tl-sm px-4 py-3 bg-gradient-to-br from-cyan-500/[0.08] to-blue-500/[0.05] backdrop-blur-sm border border-cyan-500/[0.15] shadow-lg shadow-cyan-500/5">
            <div className="flex items-center gap-1.5 mb-1.5">
              <div className="w-4 h-4 rounded bg-cyan-500/20 flex items-center justify-center">
                <Zap className="w-2.5 h-2.5 text-cyan-400" />
              </div>
              <p className="text-[10px] uppercase tracking-wider text-cyan-400/80 font-semibold">
                Stock Analysis
              </p>
            </div>
            <p className="text-slate-200 text-[12px] leading-relaxed whitespace-pre-wrap">
              {message.analysisSummary}
            </p>
          </div>
        )}

        {/* AI text response - hidden when visual structured data is rendered */}
        {!hasVisual && (
          <div className="bg-white/[0.04] backdrop-blur-sm rounded-2xl rounded-tl-sm px-4 py-2.5 border border-white/[0.06]">
            <p className="text-slate-200 text-[13px] leading-relaxed whitespace-pre-wrap">{message.content}</p>
          </div>
        )}

        {/* Action bar */}
        <div className="flex items-center gap-1 px-1">
          <button
            onClick={handleCopy}
            className="p-1.5 rounded-md hover:bg-white/[0.06] transition-colors group"
            title="Copy"
          >
            {copied ? (
              <Check className="w-3 h-3 text-emerald-400" />
            ) : (
              <Copy className="w-3 h-3 text-slate-600 group-hover:text-slate-400" />
            )}
          </button>
          <button className="p-1.5 rounded-md hover:bg-white/[0.06] transition-colors group" title="Helpful">
            <ThumbsUp className="w-3 h-3 text-slate-600 group-hover:text-slate-400" />
          </button>
          <button className="p-1.5 rounded-md hover:bg-white/[0.06] transition-colors group" title="Not helpful">
            <ThumbsDown className="w-3 h-3 text-slate-600 group-hover:text-slate-400" />
          </button>
          <button className="p-1.5 rounded-md hover:bg-white/[0.06] transition-colors group" title="Regenerate">
            <RotateCcw className="w-3 h-3 text-slate-600 group-hover:text-slate-400" />
          </button>
          <span className="text-[10px] text-slate-600 ml-auto">{formatTime(message.timestamp)}</span>
        </div>
      </div>
    </div>
  )
}

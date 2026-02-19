'use client'

import { Zap, Copy, Check, ThumbsUp, ThumbsDown, RotateCcw, Clock, AlertTriangle } from 'lucide-react'
import { useState, useMemo } from 'react'
import dynamic from 'next/dynamic'
import type { Message } from './ChatWindow'

const AIMessageContainer = dynamic(() => import('./visual/AIMessageContainer'), { ssr: false })

interface Props {
  message: Message
  conversationId?: string | null
  onRefresh?: (messageId: number) => void
}

export default function ChatMessage({ message, conversationId, onRefresh }: Props) {
  const [copied, setCopied] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const formatTime = (date: Date) =>
    date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

  const isStale = useMemo(() => {
    if (!message.ttlExpiresAt) return false
    return new Date() > new Date(message.ttlExpiresAt)
  }, [message.ttlExpiresAt])

  const asOfLabel = useMemo(() => {
    if (!message.asOf) return null
    const d = new Date(message.asOf)
    const now = Date.now()
    const diff = now - d.getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  }, [message.asOf])

  const handleRefresh = async () => {
    if (!onRefresh || !message.messageId || refreshing) return
    setRefreshing(true)
    try {
      await onRefresh(message.messageId)
    } finally {
      setRefreshing(false)
    }
  }

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
      <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#00D9FF]/20 to-[#7C3AED]/20 flex items-center justify-center flex-shrink-0 border border-white/[0.06] mt-0.5">
        <Zap className="w-4 h-4 text-cyan-400" />
      </div>

      <div className="flex-1 space-y-2 min-w-0">
        {/* Stale / As-of badge row */}
        {(asOfLabel || isStale) && (
          <div className="flex items-center gap-2 flex-wrap">
            {asOfLabel && (
              <span className="inline-flex items-center gap-1 text-[9px] text-slate-500 bg-white/[0.03] border border-white/[0.04] px-2 py-0.5 rounded-md">
                <Clock className="w-2.5 h-2.5" />
                As of {asOfLabel}
              </span>
            )}
            {isStale && (
              <span className="inline-flex items-center gap-1 text-[9px] text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-md">
                <AlertTriangle className="w-2.5 h-2.5" />
                Stale
              </span>
            )}
            {isStale && message.messageId && onRefresh && (
              <button
                onClick={handleRefresh}
                disabled={refreshing}
                className="inline-flex items-center gap-1 text-[9px] text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 px-2 py-0.5 rounded-md hover:bg-cyan-500/20 transition-all disabled:opacity-50"
              >
                <RotateCcw className={`w-2.5 h-2.5 ${refreshing ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            )}
          </div>
        )}

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

        {/* AI text response — hidden when visual structured data is rendered */}
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
          {/* Manual refresh for any assistant message with a messageId */}
          {message.messageId && onRefresh && (
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="p-1.5 rounded-md hover:bg-white/[0.06] transition-colors group disabled:opacity-50"
              title="Refresh data"
            >
              <RotateCcw className={`w-3 h-3 text-slate-600 group-hover:text-slate-400 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
          )}
          <span className="text-[10px] text-slate-600 ml-auto">{formatTime(message.timestamp)}</span>
        </div>
      </div>
    </div>
  )
}

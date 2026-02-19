'use client'

import { MessageSquare, Trash2, Plus, Loader2, ArrowLeft } from 'lucide-react'
import type { ConversationSummary } from '@/lib/api'

interface Props {
  conversations: ConversationSummary[]
  currentId: string | null
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  onNewChat: () => void
  onClose: () => void
  loading: boolean
}

function timeAgo(dateStr: string): string {
  const d = new Date(dateStr)
  const now = Date.now()
  const diff = now - d.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function ConversationHistory({
  conversations,
  currentId,
  onSelect,
  onDelete,
  onNewChat,
  onClose,
  loading,
}: Props) {
  return (
    <div className="flex-1 overflow-y-auto min-h-0">
      <div className="px-3 py-3 space-y-2">
        {/* Header row */}
        <div className="flex items-center justify-between px-1 mb-1">
          <button
            onClick={onClose}
            className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-3 h-3" />
            Back
          </button>
          <button
            onClick={onNewChat}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-cyan-500/10 to-blue-500/10 border border-cyan-500/20 text-[11px] text-cyan-400 font-medium hover:bg-cyan-500/20 transition-all active:scale-95"
          >
            <Plus className="w-3 h-3" />
            New Chat
          </button>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 text-cyan-400 animate-spin" />
          </div>
        )}

        {!loading && conversations.length === 0 && (
          <div className="text-center py-8">
            <MessageSquare className="w-8 h-8 text-slate-700 mx-auto mb-2" />
            <p className="text-[12px] text-slate-500">No conversations yet</p>
            <p className="text-[10px] text-slate-600 mt-1">Start a new chat to begin</p>
          </div>
        )}

        {!loading && conversations.map((conv) => {
          const isActive = conv.id === currentId
          return (
            <button
              key={conv.id}
              onClick={() => onSelect(conv.id)}
              className={`w-full text-left rounded-xl px-3 py-2.5 transition-all group ${
                isActive
                  ? 'bg-cyan-500/10 border border-cyan-500/20'
                  : 'bg-white/[0.02] border border-white/[0.04] hover:bg-white/[0.05] hover:border-white/[0.08]'
              }`}
            >
              <div className="flex items-start gap-2.5">
                <MessageSquare className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${
                  isActive ? 'text-cyan-400' : 'text-slate-600'
                }`} />
                <div className="flex-1 min-w-0">
                  <p className={`text-[12px] font-medium truncate ${
                    isActive ? 'text-white' : 'text-slate-300'
                  }`}>
                    {conv.title || 'New conversation'}
                  </p>
                  {conv.last_message && (
                    <p className="text-[10px] text-slate-500 truncate mt-0.5">
                      {conv.last_message}
                    </p>
                  )}
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[9px] text-slate-600">
                      {timeAgo(conv.updated_at)}
                    </span>
                    <span className="text-[9px] text-slate-600">
                      {conv.message_count} msg{conv.message_count !== 1 ? 's' : ''}
                    </span>
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onDelete(conv.id)
                  }}
                  className="p-1 rounded-md opacity-0 group-hover:opacity-100 hover:bg-red-500/10 transition-all"
                  title="Delete conversation"
                >
                  <Trash2 className="w-3 h-3 text-slate-600 hover:text-red-400" />
                </button>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

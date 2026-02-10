'use client'

import Link from 'next/link'
import {
  Clock,
  Lightbulb,
  MessageCircle,
  Share2,
  ThumbsUp,
  User,
} from 'lucide-react'

const FILTERS = ['All', 'Long', 'Short', 'Swing'] as const

type IdeaType = 'Long' | 'Short' | 'Swing'

interface Idea {
  id: string
  symbol: string
  type: IdeaType
  title: string
  entry: number
  target: number
  stop: number
  author: string
  created: string
  timeframe: string
  likes: number
  comments: number
}

const IDEAS: Idea[] = [
  {
    id: '1',
    symbol: 'NVDA',
    type: 'Long',
    title: 'Momentum continuation into earnings',
    entry: 610.5,
    target: 675.0,
    stop: 585.0,
    author: 'QuantTrade AI',
    created: '2h ago',
    timeframe: '1-3 weeks',
    likes: 124,
    comments: 18,
  },
  {
    id: '2',
    symbol: 'TSLA',
    type: 'Swing',
    title: 'Range breakout setup with tight risk',
    entry: 196.2,
    target: 214.0,
    stop: 188.5,
    author: 'QuantTrade AI',
    created: '6h ago',
    timeframe: '3-7 days',
    likes: 89,
    comments: 32,
  },
]

function typeBadge(type: IdeaType) {
  switch (type) {
    case 'Long':
      return 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
    case 'Short':
      return 'bg-red-500/10 text-red-300 border-red-500/30'
    case 'Swing':
      return 'bg-orange-500/10 text-orange-300 border-orange-500/30'
  }
}

export default function MobileIdeasLab() {
  // NOTE: This page is currently mock-driven (same as desktop),
  // until there is a backend ideas endpoint.
  const activeFilter = 'All'

  return (
    <div className="space-y-4 pb-4">
      <header className="sticky top-0 z-30 bg-[#0A0E1A]/95 backdrop-blur-xl border-b border-white/10 pt-safe pb-2 px-1 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Lightbulb className="w-5 h-5 text-purple-400" />
          <div>
            <h1 className="text-[18px] font-semibold text-white">Ideas Lab</h1>
            <p className="text-[11px] text-slate-400">AI-generated setups & quick plays</p>
          </div>
        </div>
        <button
          type="button"
          className="h-9 px-3 rounded-full bg-[#00D9FF] text-[#0A0E1A] text-[12px] font-semibold inline-flex items-center gap-2 active:scale-[0.98]"
        >
          <Share2 className="w-4 h-4" />
          Share
        </button>
      </header>

      <section className="px-1">
        <div className="flex gap-2 overflow-x-auto scrollbar-hide">
          {FILTERS.map((f) => {
            const isActive = activeFilter === f
            return (
              <button
                key={f}
                type="button"
                className={`px-3 py-1.5 rounded-full text-[11px] border whitespace-nowrap ${
                  isActive
                    ? 'bg-[#00D9FF] text-[#0A0E1A] border-[#00D9FF]'
                    : 'bg-[#1A2332] text-slate-300 border-white/10'
                }`}
              >
                {f}
              </button>
            )
          })}
        </div>
      </section>

      <section className="px-1 space-y-2">
        {IDEAS.map((idea) => (
          <div
            key={idea.id}
            className="rounded-2xl bg-[#1A2332]/90 border border-white/10 p-4"
          >
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Link
                    href={`/research?symbol=${encodeURIComponent(idea.symbol)}`}
                    className="text-[15px] font-semibold text-white"
                  >
                    {idea.symbol}
                  </Link>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full border ${typeBadge(
                      idea.type
                    )}`}
                  >
                    {idea.type}
                  </span>
                </div>
                <p className="text-[13px] text-slate-100 mt-2">{idea.title}</p>
              </div>
              <button
                type="button"
                className="h-9 w-9 rounded-full bg-[#0A0E1A] border border-white/10 text-slate-300 flex items-center justify-center active:scale-95"
                aria-label="Share"
              >
                <Share2 className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2 mt-3">
              <div className="rounded-xl bg-[#0A0E1A] border border-white/5 p-2">
                <p className="text-[10px] text-slate-500">Entry</p>
                <p className="text-[12px] font-mono text-white">${idea.entry.toFixed(2)}</p>
              </div>
              <div className="rounded-xl bg-[#0A0E1A] border border-emerald-500/20 p-2">
                <p className="text-[10px] text-slate-500">Target</p>
                <p className="text-[12px] font-mono text-emerald-300">${idea.target.toFixed(2)}</p>
              </div>
              <div className="rounded-xl bg-[#0A0E1A] border border-red-500/20 p-2">
                <p className="text-[10px] text-slate-500">Stop</p>
                <p className="text-[12px] font-mono text-red-300">${idea.stop.toFixed(2)}</p>
              </div>
            </div>

            <div className="flex items-center justify-between mt-3 text-[11px] text-slate-500">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1">
                  <User className="w-3.5 h-3.5" />
                  {idea.author}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" />
                  {idea.created}
                </span>
              </div>
              <span className="text-slate-400">{idea.timeframe}</span>
            </div>

            <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/5 text-[11px] text-slate-400">
              <button type="button" className="inline-flex items-center gap-1.5">
                <ThumbsUp className="w-4 h-4" />
                {idea.likes}
              </button>
              <button type="button" className="inline-flex items-center gap-1.5">
                <MessageCircle className="w-4 h-4" />
                {idea.comments}
              </button>
              <button type="button" className="inline-flex items-center gap-1.5">
                <Share2 className="w-4 h-4" />
                Share
              </button>
            </div>
          </div>
        ))}
      </section>
    </div>
  )
}


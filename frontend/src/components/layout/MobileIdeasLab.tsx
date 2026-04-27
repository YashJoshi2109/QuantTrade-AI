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
  {
    id: '3',
    symbol: 'AMD',
    type: 'Long',
    title: 'AI infrastructure expansion play',
    entry: 165.4,
    target: 190.0,
    stop: 155.0,
    author: 'QuantTrade AI',
    created: '12h ago',
    timeframe: '1-2 months',
    likes: 312,
    comments: 45,
  },
  {
    id: '4',
    symbol: 'CRWD',
    type: 'Swing',
    title: 'Cybersecurity secular tailwinds',
    entry: 305.1,
    target: 340.0,
    stop: 290.0,
    author: 'Analyst_Pro',
    created: '1d ago',
    timeframe: '2-4 weeks',
    likes: 245,
    comments: 28,
  },
  {
    id: '5',
    symbol: 'PYPL',
    type: 'Short',
    title: 'Failing to hold key moving averages',
    entry: 58.5,
    target: 50.0,
    stop: 62.0,
    author: 'Bearish_Trader',
    created: '1d ago',
    timeframe: '1-2 weeks',
    likes: 67,
    comments: 89,
  },
  {
    id: '6',
    symbol: 'SMCI',
    type: 'Long',
    title: 'High beta AI server breakout',
    entry: 850.0,
    target: 1050.0,
    stop: 790.0,
    author: 'QuantTrade AI',
    created: '2d ago',
    timeframe: '2-3 weeks',
    likes: 420,
    comments: 65,
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
      <header className="sticky top-0 z-30 bg-surface-base/95 backdrop-blur-xl border-b border-line-subtle pt-safe pb-2 px-1 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Lightbulb className="w-5 h-5 text-purple-400" />
          <div>
            <h1 className="text-[18px] font-semibold text-fg-primary">Ideas Lab</h1>
            <p className="text-[11px] text-fg-secondary">AI-generated setups & quick plays</p>
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
                    : 'bg-surface-raised text-fg-secondary border-line-subtle'
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
            className="rounded-2xl bg-surface-raised border border-line-subtle p-4"
          >
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Link
                    href={`/research?symbol=${encodeURIComponent(idea.symbol)}`}
                    className="text-[15px] font-semibold text-fg-primary"
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
                <p className="text-[13px] text-fg-primary mt-2">{idea.title}</p>
              </div>
              <button
                type="button"
                className="h-9 w-9 rounded-full bg-surface-base border border-line-subtle text-fg-secondary flex items-center justify-center active:scale-95"
                aria-label="Share"
              >
                <Share2 className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2 mt-3">
              <div className="rounded-xl bg-surface-base border border-line-subtle p-2">
                <p className="text-[10px] text-fg-muted">Entry</p>
                <p className="text-[12px] font-mono text-fg-primary">${idea.entry.toFixed(2)}</p>
              </div>
              <div className="rounded-xl bg-surface-base border border-emerald-500/20 p-2">
                <p className="text-[10px] text-fg-muted">Target</p>
                <p className="text-[12px] font-mono text-emerald-300">${idea.target.toFixed(2)}</p>
              </div>
              <div className="rounded-xl bg-surface-base border border-red-500/20 p-2">
                <p className="text-[10px] text-fg-muted">Stop</p>
                <p className="text-[12px] font-mono text-red-300">${idea.stop.toFixed(2)}</p>
              </div>
            </div>

            <div className="flex items-center justify-between mt-3 text-[11px] text-fg-muted">
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
              <span className="text-fg-secondary">{idea.timeframe}</span>
            </div>

            <div className="flex items-center justify-between mt-3 pt-3 border-t border-line-subtle text-[11px] text-fg-secondary">
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


'use client'

import { useState } from 'react'
import AppLayout from '@/components/AppLayout'
import { motion } from 'framer-motion'
import { Lightbulb, Plus, Sparkles, ArrowRight, Clock, ThumbsUp, MessageSquare } from 'lucide-react'
import MobileLayout from '@/components/layout/MobileLayout'
import MobileIdeasLab from '@/components/layout/MobileIdeasLab'
import { ProButton, ProCard, ProDivider, ProSection } from '@/components/ui/pro'

function DesktopIdeasLabPage() {
  const [activeSentiment, setActiveSentiment] = useState<'all' | 'bullish' | 'neutral' | 'bearish'>('all')
  const ideas = [
    {
      id: 1,
      title: 'AI Chip Demand Surge',
      description: 'Analysis suggests NVDA and AMD are positioned to benefit from unprecedented AI infrastructure spending in 2024-2025.',
      symbols: ['NVDA', 'AMD', 'INTC'],
      sentiment: 'bullish',
      confidence: 87,
      timeAgo: 'sample',
      likes: 0,
      comments: 0
    },
    {
      id: 2,
      title: 'EV Market Consolidation',
      description: 'Traditional automakers gaining ground on Tesla. F and GM showing improved EV margins while TSLA faces pricing pressure.',
      symbols: ['TSLA', 'F', 'GM'],
      sentiment: 'neutral',
      confidence: 72,
      timeAgo: 'sample',
      likes: 0,
      comments: 0
    },
    {
      id: 3,
      title: 'Cloud Computing Momentum',
      description: 'Enterprise cloud migration accelerating. AWS, Azure, and GCP all reporting strong growth. Long-term opportunity in cloud infrastructure.',
      symbols: ['AMZN', 'MSFT', 'GOOGL'],
      sentiment: 'bullish',
      confidence: 91,
      timeAgo: 'sample',
      likes: 0,
      comments: 0
    },
    {
      id: 4,
      title: 'Retail Sector Warning',
      description: 'Consumer spending data suggests potential weakness in discretionary retail. Watch for earnings misses in upcoming quarter.',
      symbols: ['TGT', 'WMT', 'COST'],
      sentiment: 'bearish',
      confidence: 65,
      timeAgo: 'sample',
      likes: 0,
      comments: 0
    }
  ]

  const getSentimentColor = (sentiment: string) => {
    switch (sentiment) {
      case 'bullish': return 'text-green-400 bg-green-400/10 border-green-400/30'
      case 'bearish': return 'text-red-400 bg-red-400/10 border-red-400/30'
      default: return 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30'
    }
  }

  const filteredIdeas = ideas.filter((idea) => (
    activeSentiment === 'all' ? true : idea.sentiment === activeSentiment
  ))

  return (
    <AppLayout>
      <div className="p-4 md:p-6">
        <div className="max-w-6xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
            className="p-5 md:p-6 mb-4"
          >
            <ProSection className="p-5 md:p-6">
            <div className="flex items-center justify-between gap-4 mb-4">
              <div>
                <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2 text-white">
                <Lightbulb className="w-7 h-7 text-yellow-400" />
                Ideas Lab
              </h1>
                <p className="text-sm text-slate-400 mt-1">AI-generated trading ideas and market insights</p>
              </div>
              <ProButton type="button" className="flex items-center gap-2">
              <Plus className="w-4 h-4" />
              Generate New Idea
            </ProButton>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {(['all', 'bullish', 'neutral', 'bearish'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setActiveSentiment(s)}
                  className={`px-3 py-1.5 rounded-full text-xs border transition-colors capitalize ${
                    activeSentiment === s
                      ? 'bg-cyan-500/20 border-cyan-400/40 text-cyan-200'
                      : 'bg-slate-900/70 border-slate-700/70 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
            </ProSection>
          </motion.div>

          <ProDivider label="Live idea stream" />

          <div className="flex items-center justify-between mb-4">
            <div className="text-xs text-slate-500 font-mono">
              {filteredIdeas.length} ideas
            </div>
            <div className="text-xs text-slate-500">Updated from sample feed</div>
          </div>

          {/* AI Insights Banner */}
          <div className="bg-gradient-to-r from-blue-600/20 to-violet-600/20 border border-blue-500/30 rounded-xl p-4 mb-4">
            <div className="flex items-center gap-3">
              <Sparkles className="w-8 h-8 text-blue-400" />
              <div>
                <h3 className="font-semibold text-white">AI Market Pulse</h3>
                <p className="text-sm text-gray-300">Use the AI Copilot to generate live, dated investment theses based on real earnings, SEC filings, and market data.</p>
              </div>
              <button className="ml-auto flex items-center gap-1 text-blue-400 hover:text-blue-300 text-sm font-medium whitespace-nowrap">
                Open Copilot <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Sample ideas disclaimer */}
          <div className="flex items-center gap-2 px-3 py-2 mb-4 bg-amber-500/10 border border-amber-500/25 rounded-lg">
            <span className="text-amber-400 text-xs font-semibold uppercase tracking-wider">Sample Ideas</span>
            <span className="text-slate-400 text-xs">— These are illustrative examples. Use the AI Copilot for live, real-time investment research.</span>
          </div>

          {/* Ideas Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredIdeas.map((idea, idx) => (
              <motion.div
                key={idea.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, delay: idx * 0.04 }}
                className="cursor-pointer min-h-[250px] flex flex-col"
              >
                <ProCard className="p-5 h-full hover:border-cyan-500/40">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-semibold text-white text-lg">{idea.title}</h3>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`px-2 py-0.5 text-xs font-medium rounded border capitalize ${getSentimentColor(idea.sentiment)}`}>
                        {idea.sentiment}
                      </span>
                      <span className="text-xs text-gray-400 flex items-center gap-1">
                        <Clock className="w-3 h-3" /> {idea.timeAgo}
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold text-blue-400">{idea.confidence}%</div>
                    <div className="text-[10px] text-gray-400 uppercase">Confidence</div>
                  </div>
                </div>
                
                <p className="text-sm text-gray-400 mb-4 line-clamp-3">{idea.description}</p>
                
                <div className="flex items-center justify-between mt-auto">
                  <div className="flex items-center gap-2">
                    {idea.symbols.map((symbol) => (
                      <span key={symbol} className="px-2 py-1 text-xs font-mono bg-slate-800 text-gray-300 rounded border border-slate-700">
                        {symbol}
                      </span>
                    ))}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-400">
                    <span className="flex items-center gap-1">
                      <ThumbsUp className="w-3 h-3" /> {idea.likes}
                    </span>
                    <span className="flex items-center gap-1">
                      <MessageSquare className="w-3 h-3" /> {idea.comments}
                    </span>
                  </div>
                </div>
                </ProCard>
              </motion.div>
            ))}
          </div>

          {/* Load More */}
          <div className="text-center mt-8">
            <ProButton variant="secondary" className="px-6">
              Load More Ideas
            </ProButton>
          </div>
        </div>
      </div>
    </AppLayout>
  )
}

export default function IdeasLabPage() {
  return (
    <>
      <div className="hidden md:block">
        <DesktopIdeasLabPage />
      </div>
      <div className="md:hidden">
        <MobileLayout>
          <MobileIdeasLab />
        </MobileLayout>
      </div>
    </>
  )
}

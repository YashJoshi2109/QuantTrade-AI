'use client'

import { useState } from 'react'
import AppLayout from '@/components/AppLayout'
import { Lightbulb, Plus, Sparkles, ArrowRight, Clock, ThumbsUp, MessageSquare } from 'lucide-react'

export default function IdeasLabPage() {
  const ideas = [
    {
      id: 1,
      title: 'AI Chip Demand Surge',
      description: 'Analysis suggests NVDA and AMD are positioned to benefit from unprecedented AI infrastructure spending in 2024-2025.',
      symbols: ['NVDA', 'AMD', 'INTC'],
      sentiment: 'bullish',
      confidence: 87,
      timeAgo: '2h ago',
      likes: 124,
      comments: 18
    },
    {
      id: 2,
      title: 'EV Market Consolidation',
      description: 'Traditional automakers gaining ground on Tesla. F and GM showing improved EV margins while TSLA faces pricing pressure.',
      symbols: ['TSLA', 'F', 'GM'],
      sentiment: 'neutral',
      confidence: 72,
      timeAgo: '4h ago',
      likes: 89,
      comments: 32
    },
    {
      id: 3,
      title: 'Cloud Computing Momentum',
      description: 'Enterprise cloud migration accelerating. AWS, Azure, and GCP all reporting strong growth. Long-term opportunity in cloud infrastructure.',
      symbols: ['AMZN', 'MSFT', 'GOOGL'],
      sentiment: 'bullish',
      confidence: 91,
      timeAgo: '6h ago',
      likes: 156,
      comments: 24
    },
    {
      id: 4,
      title: 'Retail Sector Warning',
      description: 'Consumer spending data suggests potential weakness in discretionary retail. Watch for earnings misses in upcoming quarter.',
      symbols: ['TGT', 'WMT', 'COST'],
      sentiment: 'bearish',
      confidence: 65,
      timeAgo: '8h ago',
      likes: 67,
      comments: 45
    }
  ]

  const getSentimentColor = (sentiment: string) => {
    switch (sentiment) {
      case 'bullish': return 'text-green-400 bg-green-400/10 border-green-400/30'
      case 'bearish': return 'text-red-400 bg-red-400/10 border-red-400/30'
      default: return 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30'
    }
  }

  return (
    <AppLayout>
      <div className="p-6">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2 text-white">
                <Lightbulb className="w-7 h-7 text-yellow-400" />
                Ideas Lab
              </h1>
              <p className="text-sm text-gray-400 mt-1">AI-generated trading ideas and market insights</p>
            </div>
            <button className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium text-sm transition-colors">
              <Plus className="w-4 h-4" />
              Generate New Idea
            </button>
          </div>

          {/* AI Insights Banner */}
          <div className="bg-gradient-to-r from-blue-600/20 to-purple-600/20 border border-blue-500/30 rounded-lg p-4 mb-6">
            <div className="flex items-center gap-3">
              <Sparkles className="w-8 h-8 text-blue-400" />
              <div>
                <h3 className="font-semibold text-white">AI Market Pulse</h3>
                <p className="text-sm text-gray-300">Our AI has analyzed 10,432 data points today. Market sentiment is cautiously optimistic with focus on tech earnings.</p>
              </div>
              <button className="ml-auto flex items-center gap-1 text-blue-400 hover:text-blue-300 text-sm font-medium">
                Learn More <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Ideas Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {ideas.map((idea) => (
              <div key={idea.id} className="bg-[#1e293b] border border-slate-700 rounded-lg p-5 hover:border-blue-500/50 transition-colors cursor-pointer">
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
                
                <p className="text-sm text-gray-400 mb-4 line-clamp-2">{idea.description}</p>
                
                <div className="flex items-center justify-between">
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
              </div>
            ))}
          </div>

          {/* Load More */}
          <div className="text-center mt-8">
            <button className="px-6 py-2 border border-slate-700 text-gray-300 rounded-lg hover:bg-slate-800 transition-colors text-sm">
              Load More Ideas
            </button>
          </div>
        </div>
      </div>
    </AppLayout>
  )
}

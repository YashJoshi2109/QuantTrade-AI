'use client'

/**
 * QuantTrade AI — Ideas Lab
 * AI-generated trading ideas with Bloomberg terminal aesthetic
 */

import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import AppLayout from '@/components/AppLayout'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Lightbulb, Plus, Sparkles, ArrowRight, Clock, ThumbsUp, MessageSquare,
  TrendingUp, TrendingDown, Minus, Filter, Zap, Star, Brain, ChevronRight,
  BarChart3, RefreshCw, AlertTriangle,
} from 'lucide-react'
import MobileLayout from '@/components/layout/MobileLayout'
import MobileIdeasLab from '@/components/layout/MobileIdeasLab'

const IDEAS = [
  {
    id: 1, title: 'AI Chip Demand Surge',
    description: 'Unprecedented AI infrastructure spending is driving NVDA and AMD to multi-year revenue highs. GPU compute demand outpacing supply through 2025. Data center capex from hyperscalers (MSFT, GOOGL, AMZN) accelerating significantly.',
    symbols: ['NVDA', 'AMD', 'INTC'], sentiment: 'bullish', confidence: 87, timeframe: '6-12M',
    catalysts: ['H200 demand', 'Data center expansion', 'AI model scaling'], sector: 'Semiconductors',
    likes: 142, comments: 38, views: 1240,
  },
  {
    id: 2, title: 'EV Market Consolidation',
    description: "Traditional OEMs (Ford, GM) are gaining market share on Tesla as margin compression forces pricing rationalization. TSLA's premium multiple eroding as competition intensifies across all segments.",
    symbols: ['TSLA', 'F', 'GM'], sentiment: 'neutral', confidence: 72, timeframe: '3-6M',
    catalysts: ['EV price wars', 'Legacy OEM catch-up', 'Battery cost parity'], sector: 'Automotive',
    likes: 89, comments: 21, views: 876,
  },
  {
    id: 3, title: 'Cloud Infrastructure Super-Cycle',
    description: 'Enterprise cloud migration entering a second wave driven by AI workloads. AWS, Azure, and GCP all guiding to strong growth. Multi-cloud strategies creating durable revenue streams for all three hyperscalers.',
    symbols: ['AMZN', 'MSFT', 'GOOGL'], sentiment: 'bullish', confidence: 91, timeframe: '12-24M',
    catalysts: ['AI workload migration', 'Enterprise digestion phase ending', 'GenAI monetization'], sector: 'Cloud',
    likes: 203, comments: 61, views: 2180,
  },
  {
    id: 4, title: 'Retail Sector Warning',
    description: 'Consumer spending data points to weakness in discretionary retail. Credit card delinquencies rising, savings rates declining. Watch for earnings misses particularly in mid-market apparel and home goods.',
    symbols: ['TGT', 'WMT', 'COST'], sentiment: 'bearish', confidence: 65, timeframe: '1-3M',
    catalysts: ['Credit stress signals', 'Student loan restart impact', 'Inventory normalization'], sector: 'Consumer',
    likes: 47, comments: 15, views: 512,
  },
  {
    id: 5, title: 'Biotech Catalyst Season',
    description: 'FDA approval calendar heavily loaded in Q3. PDUFA dates for several GLP-1 and oncology drugs. Pipeline readouts from Amgen, Regeneron, and Vertex expected. Risk/reward skew favorable for selective longs.',
    symbols: ['AMGN', 'REGN', 'VRTX'], sentiment: 'bullish', confidence: 78, timeframe: '3-6M',
    catalysts: ['PDUFA dates', 'GLP-1 pipeline', 'Phase 3 readouts'], sector: 'Biotech',
    likes: 91, comments: 28, views: 943,
  },
  {
    id: 6, title: 'Treasury Duration Trade',
    description: 'Fed pivot timing creates asymmetric opportunity in long-duration treasuries. If CPI continues moderating, 10Y yields could compress 50-80bps from current levels. TLT and EDV positioned well for rate cycle turns.',
    symbols: ['TLT', 'EDV', 'TMF'], sentiment: 'bullish', confidence: 69, timeframe: '6-12M',
    catalysts: ['Fed pivot', 'CPI trajectory', 'Recession probability'], sector: 'Fixed Income',
    likes: 76, comments: 19, views: 831,
  },
]

const SENTIMENT_CONFIG = {
  bullish: { color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/25', icon: TrendingUp, label: 'BULLISH' },
  neutral: { color: 'text-yellow-400', bg: 'bg-yellow-500/10 border-yellow-500/25', icon: Minus, label: 'NEUTRAL' },
  bearish: { color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/25', icon: TrendingDown, label: 'BEARISH' },
}

function ConfidenceBar({ value }: { value: number }) {
  const color = value >= 80 ? 'from-emerald-500 to-cyan-500' : value >= 65 ? 'from-yellow-500 to-orange-500' : 'from-red-500 to-rose-500'
  return (
    <div className="w-full h-1 bg-slate-800 rounded-full overflow-hidden">
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: `${value}%` }}
        transition={{ duration: 0.8, ease: 'easeOut', delay: 0.2 }}
        className={`h-full rounded-full bg-gradient-to-r ${color}`}
      />
    </div>
  )
}

function IdeaCard({ idea, index }: { idea: typeof IDEAS[0]; index: number }) {
  const [expanded, setExpanded] = useState(false)
  const cfg = SENTIMENT_CONFIG[idea.sentiment as keyof typeof SENTIMENT_CONFIG]
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.06 }}
      className="group"
    >
      <div className={`bg-slate-900/60 border border-slate-800/60 rounded-2xl overflow-hidden backdrop-blur-sm hover:border-slate-700/80 transition-all ${expanded ? 'border-slate-700/60' : ''}`}>
        {/* Card header */}
        <div className="px-6 pt-5 pb-4">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black border ${cfg.bg} ${cfg.color}`}>
                  <cfg.icon className="w-3 h-3" />
                  {cfg.label}
                </span>
                <span className="text-[10px] text-slate-600 font-mono">{idea.sector}</span>
                <span className="text-[10px] text-slate-600 font-mono">· {idea.timeframe}</span>
              </div>
              <h3 className="text-base font-black text-white group-hover:text-cyan-100 transition-colors">{idea.title}</h3>
            </div>
            {/* Confidence */}
            <div className="text-right shrink-0">
              <div className={`text-2xl font-black ${cfg.color} font-mono`}>{idea.confidence}%</div>
              <div className="text-[9px] text-slate-600 uppercase tracking-wider">CONFIDENCE</div>
            </div>
          </div>

          <ConfidenceBar value={idea.confidence} />

          <p className={`text-sm text-slate-400 leading-relaxed mt-3 ${expanded ? '' : 'line-clamp-2'}`}>{idea.description}</p>

          {/* Catalysts */}
          <div className="flex flex-wrap gap-1.5 mt-3">
            {idea.catalysts.map(c => (
              <span key={c} className="px-2 py-0.5 rounded-full text-[10px] bg-slate-800/80 border border-slate-700/40 text-slate-400 font-mono">
                {c}
              </span>
            ))}
          </div>
        </div>

        {/* Card footer */}
        <div className="px-6 py-3 border-t border-slate-800/50 flex items-center justify-between">
          {/* Symbols */}
          <div className="flex items-center gap-1.5">
            {idea.symbols.map(sym => (
              <Link key={sym} href={`/research?symbol=${sym}`}
                className="px-2.5 py-1 text-[11px] font-black bg-slate-800/80 text-slate-300 rounded-lg border border-slate-700/40 hover:border-cyan-500/40 hover:text-cyan-300 transition-all font-mono"
              >
                {sym}
              </Link>
            ))}
          </div>
          {/* Stats + expand */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3 text-[11px] text-slate-600">
              <span className="flex items-center gap-1"><ThumbsUp className="w-3 h-3" />{idea.likes}</span>
              <span className="flex items-center gap-1"><MessageSquare className="w-3 h-3" />{idea.comments}</span>
            </div>
            <button onClick={() => setExpanded(e => !e)} className="text-[10px] text-slate-600 hover:text-slate-300 transition-colors font-mono">
              {expanded ? 'LESS ↑' : 'MORE ↓'}
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  )
}

function DesktopIdeasLabPage() {
  const [activeSentiment, setActiveSentiment] = useState<'all' | 'bullish' | 'neutral' | 'bearish'>('all')
  const [sortBy, setSortBy] = useState<'confidence' | 'likes' | 'recent'>('confidence')

  const filtered = IDEAS.filter(i => activeSentiment === 'all' || i.sentiment === activeSentiment)
  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === 'confidence') return b.confidence - a.confidence
    if (sortBy === 'likes') return b.likes - a.likes
    return b.id - a.id
  })

  const totalBullish = IDEAS.filter(i => i.sentiment === 'bullish').length
  const totalBearish = IDEAS.filter(i => i.sentiment === 'bearish').length
  const avgConfidence = Math.round(IDEAS.reduce((s, i) => s + i.confidence, 0) / IDEAS.length)

  return (
    <AppLayout>
      <div className="min-h-screen bg-[#020617] -mx-4 md:-mx-6 -my-4 md:-my-6">
        <div className="max-w-6xl mx-auto px-6 py-10">

          {/* Header */}
          <motion.div className="mb-8" initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }}>
            <div className="flex items-center justify-between gap-4 mb-6">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-slate-900 border border-cyan-500/20 overflow-hidden">
                  <Image src="/logo.png" alt="QuantTrade AI" width={40} height={40} className="object-contain" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <Lightbulb className="w-4 h-4 text-yellow-400" />
                    <h1 className="text-xl font-black text-white">Ideas Lab</h1>
                    <span className="px-2 py-0.5 rounded-full bg-yellow-500/10 border border-yellow-500/25 text-[10px] text-yellow-400 font-bold">AI-POWERED</span>
                  </div>
                  <p className="text-[11px] text-slate-500 font-mono mt-0.5">AI-generated trading ideas · Updated from live market data</p>
                </div>
              </div>
              <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-sky-500 text-white text-sm font-bold shadow-lg shadow-cyan-500/20 hover:from-cyan-400 hover:to-sky-400 transition-all"
              >
                <Plus className="w-4 h-4" /> Generate New Idea
              </motion.button>
            </div>

            {/* Stats strip */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              {[
                { label: 'Total Ideas', value: IDEAS.length, color: 'text-white' },
                { label: 'Bullish', value: totalBullish, color: 'text-emerald-400' },
                { label: 'Bearish', value: totalBearish, color: 'text-red-400' },
                { label: 'Avg Confidence', value: `${avgConfidence}%`, color: 'text-cyan-400' },
              ].map(s => (
                <div key={s.label} className="bg-slate-900/60 border border-slate-800/50 rounded-xl px-4 py-3 backdrop-blur-sm">
                  <div className="text-[10px] text-slate-600 uppercase tracking-wider mb-1">{s.label}</div>
                  <div className={`text-xl font-black ${s.color} font-mono`}>{s.value}</div>
                </div>
              ))}
            </div>

            {/* AI Banner */}
            <div className="relative overflow-hidden rounded-2xl border border-blue-500/20 bg-gradient-to-r from-blue-600/10 to-violet-600/10 p-5 mb-6 backdrop-blur-sm">
              <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImdyaWQiIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTSA0MCAwIEwgMCAwIDAgNDAiIGZpbGw9Im5vbmUiIHN0cm9rZT0icmdiYSgxNDgsMTYzLDE4NCwwLjA0KSIgc3Ryb2tlLXdpZHRoPSIxIi8+PC9wYXR0ZXJuPjwvZGVmcz48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSJ1cmwoI2dyaWQpIi8+PC9zdmc+')] opacity-50" />
              <div className="relative flex items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-blue-500/20 border border-blue-500/30 flex items-center justify-center">
                    <Brain className="w-6 h-6 text-blue-400" />
                  </div>
                  <div>
                    <h3 className="font-bold text-white">AI Market Pulse</h3>
                    <p className="text-sm text-slate-400 mt-0.5">Use the AI Copilot to generate live, dated investment theses from real earnings, SEC filings, and market data.</p>
                  </div>
                </div>
                <Link href="/copilot" className="shrink-0 flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-500/20 border border-blue-500/30 text-blue-300 text-sm font-bold hover:bg-blue-500/30 transition-all whitespace-nowrap">
                  Open Copilot <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            </div>

            {/* Sample disclaimer */}
            <div className="flex items-center gap-2 px-4 py-2.5 mb-4 bg-amber-500/5 border border-amber-500/20 rounded-xl">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              <span className="text-[11px] text-slate-500">These are <strong className="text-amber-400">illustrative sample ideas</strong>. Use the AI Copilot for real-time, personalized investment research based on live data.</span>
            </div>

            {/* Filters + sort */}
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-1 bg-slate-900/60 border border-slate-800/50 rounded-xl p-1">
                {(['all', 'bullish', 'neutral', 'bearish'] as const).map(s => (
                  <button key={s} onClick={() => setActiveSentiment(s)}
                    className={`px-4 py-1.5 rounded-lg text-xs font-bold capitalize transition-all ${activeSentiment === s
                      ? s === 'bullish' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                        : s === 'bearish' ? 'bg-red-500/20 text-red-300 border border-red-500/30'
                        : s === 'neutral' ? 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30'
                        : 'bg-slate-700 text-white'
                      : 'text-slate-500 hover:text-slate-300'}`}
                  >
                    {s}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1 bg-slate-900/60 border border-slate-800/50 rounded-xl p-1">
                {([['confidence', 'Confidence'], ['likes', 'Popular'], ['recent', 'Recent']] as const).map(([val, label]) => (
                  <button key={val} onClick={() => setSortBy(val)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${sortBy === val ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/25' : 'text-slate-500 hover:text-slate-300'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </motion.div>

          {/* Ideas grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <AnimatePresence mode="popLayout">
              {sorted.map((idea, i) => (
                <IdeaCard key={idea.id} idea={idea} index={i} />
              ))}
            </AnimatePresence>
          </div>

          {/* Load more */}
          <div className="text-center mt-10">
            <button className="flex items-center gap-2 px-8 py-3 rounded-2xl border border-slate-700 text-slate-400 text-sm font-bold mx-auto hover:border-slate-500 hover:text-white transition-all">
              <RefreshCw className="w-4 h-4" /> Load More Ideas
            </button>
          </div>
        </div>
      </div>
    </AppLayout>
  )
}

export default function IdeasClient() {
  return (
    <>
      <div className="hidden md:block"><DesktopIdeasLabPage /></div>
      <div className="md:hidden">
        <MobileLayout><MobileIdeasLab /></MobileLayout>
      </div>
    </>
  )
}

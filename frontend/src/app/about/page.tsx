'use client'

/**
 * QuantTrade AI — About Page
 * Institutional-grade company story with animated sections, capabilities, data sources
 * 600+ word content for E-E-A-T SEO compliance
 */

import { useRef } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import AppLayout from '@/components/AppLayout'
import BottomNav from '@/components/layout/BottomNav'
import { motion, useInView } from 'framer-motion'
import {
  Globe, BarChart3, Brain, Zap, TrendingUp, Layers, Database,
  Github, Mail, ChevronRight, AlertTriangle, Shield, Target, Clock,
} from 'lucide-react'

const DATA_SOURCES = [
  { name: 'Finnhub', desc: 'Real-time quotes, company fundamentals, SEC filings, insider transactions', category: 'Market Data' },
  { name: 'Alpha Vantage', desc: 'Historical OHLCV price data for backtesting', category: 'Market Data' },
  { name: 'Polygon.io', desc: 'NYSE, NASDAQ, AMEX tick data and 12,000+ US stock symbols', category: 'Market Data' },
  { name: 'SEC EDGAR', desc: 'Regulatory filings — 10-K / 10-Q analysis via RAG pipeline', category: 'Filings' },
  { name: 'GDELT', desc: 'Global event corpus — news, conflict, social unrest signals', category: 'Intelligence' },
  { name: 'ACLED', desc: 'Conflict and protest geolocation data with fatality counts', category: 'Intelligence' },
  { name: 'FRED', desc: 'U.S. Federal Reserve macro economic time series', category: 'Macro' },
  { name: 'NASA FIRMS', desc: 'Satellite-derived fire and thermal hotspot data', category: 'Intelligence' },
  { name: 'USGS', desc: 'Real-time earthquake monitoring and magnitude data', category: 'Intelligence' },
  { name: 'OpenSky', desc: 'Live aviation ADS-B transponder feeds', category: 'Transport' },
  { name: 'AIS Stream', desc: 'Maritime vessel position tracking — dark vessel detection', category: 'Transport' },
  { name: 'EIA', desc: 'U.S. energy production, pipeline, and infrastructure statistics', category: 'Macro' },
  { name: 'Polymarket', desc: 'Prediction market probabilities on geopolitical events', category: 'Markets' },
  { name: 'Guardian API', desc: 'Regional news classified by continent for global coverage', category: 'News' },
]

const CAPABILITIES = [
  { icon: BarChart3, title: 'Research Workspace', body: 'Symbol pages with real-time prices, technical charts with 20+ indicators, and SEC filing-linked deep-dives powered by a RAG pipeline. The AI copilot generates dated investment theses with cited sources drawn from actual filings and earnings transcripts.', accent: 'cyan' },
  { icon: Globe, title: 'Global Monitor', body: 'Bloomberg-grade geopolitical intelligence with 3D globe and flat-map views. Toggle 12 intelligence layers — conflicts, sanctions, cyber threats, natural disasters, trade routes, pipelines, waterways, outages, and more. Powered by ACLED, GDELT, USGS, OpenSky, and AIS Stream.', accent: 'blue' },
  { icon: TrendingUp, title: 'Strategy Backtester', body: 'Rule-based strategy evaluation against historical OHLCV data. Outputs Sharpe ratio, max drawdown, win rate, Monte Carlo simulations, and annotated trade logs. Supports custom entry/exit signals and position sizing.', accent: 'emerald' },
  { icon: Brain, title: 'AI Copilot', body: 'Context-aware research assistant trained on filings, earnings, and geopolitical events. Generates structured investment memos with source citations. Queries are grounded in real data — not hallucinated generalities. Unlimited queries on Pro.', accent: 'violet' },
  { icon: Zap, title: 'Ideas Lab', body: 'AI-generated trading setups scored by confidence (0–100%). Filter by sentiment (bullish/bearish/neutral), timeframe, and sector. Each idea lists primary catalysts and links directly to the research workspace for deeper analysis.', accent: 'yellow' },
  { icon: Layers, title: 'Markets Overview', body: 'Sector heatmaps across NYSE, NASDAQ, and AMEX. Top gainers and losers, major index tracking (SPX, NDX, DJI, RUT), earnings calendar, options flow, and commodity prices — all on fast auto-refresh cycles.', accent: 'rose' },
]

const STACK = [
  { label: 'Frontend', value: 'Next.js 15, React 18, Framer Motion, Three.js, Lightweight Charts, Tailwind CSS' },
  { label: 'Backend',  value: 'FastAPI (Python), SQLAlchemy, Celery task queue, WebSockets' },
  { label: 'AI/ML',   value: 'OpenAI GPT-4o, LangChain RAG pipeline, pgvector embeddings' },
  { label: 'Data',    value: 'PostgreSQL (Neon serverless), Redis cache, 14 external live APIs' },
  { label: 'Infra',   value: 'Vercel Edge (frontend), Railway (backend), Cloudflare CDN' },
]

const CAT_COLORS: Record<string, string> = {
  'Market Data':  'bg-cyan-500/10 text-cyan-300 border-cyan-500/25',
  'Filings':      'bg-violet-500/10 text-violet-300 border-violet-500/25',
  'Intelligence': 'bg-red-500/10 text-red-300 border-red-500/25',
  'Macro':        'bg-emerald-500/10 text-emerald-300 border-emerald-500/25',
  'Transport':    'bg-amber-500/10 text-amber-300 border-amber-500/25',
  'Markets':      'bg-sky-500/10 text-sky-300 border-sky-500/25',
  'News':         'bg-slate-500/10 text-fg-primary border-slate-500/25',
}

const CAP_ACCENT: Record<string, string> = {
  cyan:   'from-cyan-500/15 to-sky-600/5 border-cyan-500/20 text-cyan-400',
  blue:   'from-blue-500/15 to-indigo-600/5 border-blue-500/20 text-blue-400',
  emerald:'from-emerald-500/15 to-teal-600/5 border-emerald-500/20 text-emerald-400',
  violet: 'from-violet-500/15 to-purple-600/5 border-violet-500/20 text-violet-400',
  yellow: 'from-yellow-500/15 to-orange-600/5 border-yellow-500/20 text-yellow-400',
  rose:   'from-rose-500/15 to-red-600/5 border-rose-500/20 text-rose-400',
}

function FadeIn({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, margin: '-80px 0px' })
  return (
    <motion.div ref={ref} initial={{ opacity: 0, y: 24 }} animate={inView ? { opacity: 1, y: 0 } : {}} transition={{ duration: 0.5, delay }}>
      {children}
    </motion.div>
  )
}

export default function AboutPage() {
  return (
    <>
      {/* ─── Mobile view ─────────────────────────────── */}
      <MobileAbout />

      {/* ─── Desktop / tablet view ───────────────────── */}
    <AppLayout>
      <div className="hidden md:block min-h-screen bg-surface-base -mx-4 md:-mx-6 -my-4 md:-my-6">
        <div className="max-w-4xl mx-auto px-6 py-16">

          {/* HERO */}
          <motion.header className="mb-20" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <div className="flex items-center gap-4 mb-8">
              <div className="w-14 h-14 rounded-2xl bg-surface-raised border border-cyan-500/20 overflow-hidden shadow-lg shadow-cyan-500/10">
                <Image src="/logo.png" alt="QuantTrade AI" width={56} height={56} className="object-contain" />
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-fg-muted mb-0.5">QuantTrade Technologies, Inc.</div>
                <h1 className="text-3xl font-black text-fg-primary">QuantTrade AI</h1>
              </div>
            </div>
            <div className="pl-6 border-l-2 border-cyan-500/40">
              <p className="text-2xl md:text-3xl font-light text-fg-primary leading-relaxed mb-6">
                Institutional-grade intelligence at <span className="text-fg-primary font-semibold">retail price.</span>
              </p>
              <p className="text-fg-muted text-base leading-relaxed max-w-2xl mb-4">
                QuantTrade combines real-time market data, geopolitical risk monitoring, AI research, and strategy backtesting into a single cohesive workflow. Built end-to-end by a single engineer who found the existing retail tooling insufficient for serious research.
              </p>
              <p className="text-fg-muted text-sm leading-relaxed max-w-2xl">
                Most retail platforms give you charts and news. QuantTrade gives you the same decision-support infrastructure a professional desk would build internally — conflict tracking on a live globe, SEC filing analysis with retrieval-augmented generation, and a strategy backtester with Monte Carlo simulation — all accessible from a browser with no Bloomberg terminal required.
              </p>
            </div>
          </motion.header>

          {/* STATS */}
          <FadeIn>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-20">
              {[
                { label: 'Data Sources', value: '14+', icon: Database },
                { label: 'Assets Tracked', value: '12K+', icon: TrendingUp },
                { label: 'AI Queries', value: '∞ Pro', icon: Brain },
                { label: 'Markets', value: '60+', icon: Globe },
              ].map(s => (
                <div key={s.label} className="bg-surface-raised border border-line-subtle rounded-2xl p-5 backdrop-blur-sm">
                  <s.icon className="w-4 h-4 text-fg-muted mb-3" />
                  <div className="text-2xl font-black text-fg-primary mb-0.5">{s.value}</div>
                  <div className="text-[11px] text-fg-muted uppercase tracking-wider">{s.label}</div>
                </div>
              ))}
            </div>
          </FadeIn>

          {/* MISSION */}
          <FadeIn>
            <div className="mb-20">
              <div className="text-[10px] font-bold uppercase tracking-widest text-fg-muted mb-6">Mission</div>
              <div className="bg-surface-raised border border-line-subtle rounded-2xl p-8 backdrop-blur-sm space-y-4">
                <div className="flex items-start gap-3">
                  <Target className="w-5 h-5 text-cyan-400 shrink-0 mt-0.5" />
                  <div>
                    <h2 className="text-lg font-black text-fg-primary mb-2">Close the information gap between institutional and retail traders</h2>
                    <p className="text-fg-muted text-sm leading-relaxed">
                      A proprietary trading desk at a major fund has access to real-time conflict tracking, satellite imagery, alternative data pipelines, and AI researchers who synthesize it all before market open. A retail investor has CNBC and a brokerage app.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Shield className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-fg-muted text-sm leading-relaxed">
                      QuantTrade AI is the answer to that gap. By aggregating 14 live data sources, building an AI research pipeline on top of them, and wrapping everything in a Bloomberg-inspired interface, we make institutional-grade decision support accessible to discretionary traders, systematic researchers, and independent analysts at a price point that doesn't require a fund budget.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Clock className="w-5 h-5 text-violet-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-fg-muted text-sm leading-relaxed">
                      Every feature on this platform was built because it solved a real research problem: the Global Monitor exists because geopolitical risk is systematically underpriced by retail investors. The backtester exists because paper trading without historical validation is guesswork. The AI Copilot exists because reading a 100-page 10-K before an earnings call takes hours that most traders don't have.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </FadeIn>

          {/* OPERATOR */}
          <FadeIn>
            <div className="mb-20">
              <div className="text-[10px] font-bold uppercase tracking-widest text-fg-muted mb-6">Builder</div>
              <div className="bg-surface-raised border border-line-subtle rounded-2xl p-8 backdrop-blur-sm">
                <div className="flex items-start gap-6">
                  <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-cyan-500/30 to-blue-600/20 border border-cyan-500/20 flex items-center justify-center shrink-0 text-xl font-black text-cyan-300">Y</div>
                  <div className="flex-1">
                    <h2 className="text-xl font-black text-fg-primary mb-1">Yash Joshi</h2>
                    <div className="text-[11px] text-fg-muted uppercase tracking-wider mb-4">Founder · Full-Stack Engineer</div>
                    <p className="text-fg-muted text-sm leading-relaxed mb-4">
                      Yash built QuantTrade end-to-end — from data ingestion pipelines and FastAPI microservices to Three.js globe visualizations and LLM-powered research tools. The platform spans a Python backend with Celery workers, a Next.js 15 frontend with server-side rendering, and a vector database for RAG-based SEC filing analysis.
                    </p>
                    <p className="text-fg-muted text-sm leading-relaxed mb-4">
                      The motivation was simple: after years of working with retail trading platforms, it became clear that the tooling available to independent traders was fundamentally different from what institutional desks operate. QuantTrade is the attempt to close that gap without institutional pricing.
                    </p>
                    <p className="text-fg-muted text-sm leading-relaxed mb-6">
                      The platform is actively maintained and updated. Feature requests and feedback are welcomed at the contact below.
                    </p>
                    <div className="flex flex-wrap gap-3">
                      <a href="https://github.com/YashJoshi2109" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 px-4 py-2 rounded-xl bg-surface-hover border border-line-subtle text-fg-primary text-sm font-medium hover:border-line-default hover:text-fg-primary transition-all">
                        <Github className="w-4 h-4" /> GitHub
                      </a>
                      <a href="mailto:support@quanttrade.us" className="flex items-center gap-2 px-4 py-2 rounded-xl bg-surface-hover border border-line-subtle text-fg-primary text-sm font-medium hover:border-line-default hover:text-fg-primary transition-all">
                        <Mail className="w-4 h-4" /> support@quanttrade.us
                      </a>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </FadeIn>

          {/* CAPABILITIES */}
          <FadeIn>
            <div className="mb-20">
              <div className="text-[10px] font-bold uppercase tracking-widest text-fg-muted mb-6">Platform Capabilities</div>
              <div className="grid md:grid-cols-2 gap-4">
                {CAPABILITIES.map((cap, i) => {
                  const accent = CAP_ACCENT[cap.accent]
                  return (
                    <motion.div key={cap.title} initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.07 }}
                      className={`relative rounded-2xl border bg-gradient-to-br backdrop-blur-sm p-6 ${accent}`}
                    >
                      <div className="flex items-start gap-4">
                        <div className="w-10 h-10 rounded-xl bg-surface-raised border border-line-subtle flex items-center justify-center shrink-0">
                          <cap.icon className={`w-5 h-5 ${accent.split(' ').at(-1)}`} />
                        </div>
                        <div>
                          <h3 className="text-fg-primary font-bold mb-2">{cap.title}</h3>
                          <p className="text-fg-muted text-sm leading-relaxed">{cap.body}</p>
                        </div>
                      </div>
                    </motion.div>
                  )
                })}
              </div>
            </div>
          </FadeIn>

          {/* DATA SOURCES */}
          <FadeIn>
            <div className="mb-20">
              <div className="flex items-center justify-between mb-6">
                <div className="text-[10px] font-bold uppercase tracking-widest text-fg-muted">Data Sources & Attribution</div>
                <div className="text-[11px] text-fg-muted font-mono">{DATA_SOURCES.length} live integrations</div>
              </div>
              <p className="text-sm text-fg-muted leading-relaxed mb-5">
                QuantTrade aggregates data from {DATA_SOURCES.length} independent sources across market data, geopolitical intelligence, macro economics, and transport tracking. All data is attributed to its source and displayed with appropriate caveats on the relevant platform page.
              </p>
              <div className="grid sm:grid-cols-2 gap-2">
                {DATA_SOURCES.map((s, i) => (
                  <motion.div key={s.name} initial={{ opacity: 0, x: -8 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.04 }}
                    className="flex items-center gap-4 py-3 px-4 rounded-xl bg-surface-raised border border-line-subtle hover:border-line-subtle transition-colors"
                  >
                    <div className="flex-1">
                      <div className="text-sm font-bold text-fg-primary">{s.name}</div>
                      <div className="text-[11px] text-fg-muted mt-0.5">{s.desc}</div>
                    </div>
                    <span className={`shrink-0 px-2 py-0.5 rounded-full text-[9px] font-bold border ${CAT_COLORS[s.category] || 'bg-slate-700 text-fg-muted border-slate-600'}`}>
                      {s.category}
                    </span>
                  </motion.div>
                ))}
              </div>
            </div>
          </FadeIn>

          {/* STACK */}
          <FadeIn>
            <div className="mb-20">
              <div className="text-[10px] font-bold uppercase tracking-widest text-fg-muted mb-6">Technology Stack</div>
              <div className="bg-surface-raised border border-line-subtle rounded-2xl p-6 backdrop-blur-sm space-y-0.5">
                {STACK.map(s => (
                  <div key={s.label} className="flex items-start gap-4 py-3 border-b border-line-subtle last:border-0">
                    <div className="w-20 shrink-0 text-[11px] text-fg-muted uppercase tracking-wider font-bold pt-0.5">{s.label}</div>
                    <div className="text-sm text-fg-muted">{s.value}</div>
                  </div>
                ))}
              </div>
            </div>
          </FadeIn>

          {/* RISK DISCLOSURE */}
          <FadeIn>
            <div className="mb-16 p-6 rounded-2xl border border-amber-500/25 bg-amber-500/[0.04]">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-sm font-bold text-amber-200/90 mb-2">Risk Disclosure</h3>
                  <p className="text-sm leading-relaxed text-fg-muted mb-3">
                    Securities trading involves substantial risk of loss. QuantTrade AI provides software tools and market information — not personalized investment, tax, or legal advice. AI outputs can be wrong, delayed, or biased. Past backtest results do not predict future performance. You are solely responsible for all investment decisions.
                  </p>
                  <p className="text-sm leading-relaxed text-fg-muted">
                    All data displayed on this platform is sourced from third-party providers and is provided "as is" without warranty of accuracy or completeness. Market data may be delayed. Geopolitical intelligence data reflects publicly available sources and does not constitute classified or proprietary analysis. QuantTrade AI is not a registered investment adviser, broker-dealer, or financial institution.
                  </p>
                </div>
              </div>
            </div>
          </FadeIn>

          {/* CTA */}
          <FadeIn>
            <div className="text-center">
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Link href="/pricing" className="flex items-center gap-2 px-8 py-4 rounded-2xl bg-gradient-to-r from-cyan-500 to-sky-500 text-white font-bold hover:from-cyan-400 hover:to-sky-400 transition-all shadow-lg shadow-cyan-500/25">
                  <Zap className="w-4 h-4" /> View Pricing <ChevronRight className="w-4 h-4" />
                </Link>
                <Link href="/" className="flex items-center gap-2 px-8 py-4 rounded-2xl border border-line-default text-fg-primary font-bold hover:border-line-default hover:text-fg-primary transition-all">
                  Open Dashboard
                </Link>
              </div>
            </div>
          </FadeIn>

        </div>
      </div>
    </AppLayout>
    </>
  )
}

// ─── Mobile About ─────────────────────────────────────────────────────────────

function MobileAbout() {
  const capabs = [
    { icon: BarChart3, title: 'Research', body: 'Real-time charts, 20+ indicators, AI analysis', color: '#00D4FF' },
    { icon: Globe,    title: 'Monitor',  body: 'Geopolitical globe · 12 intelligence layers',  color: '#00FF88' },
    { icon: TrendingUp, title: 'Backtest', body: 'Strategy engine · Sharpe · Monte Carlo',     color: '#FF9F43' },
    { icon: Brain,    title: 'AI Copilot', body: 'RAG analysis grounded in real filings',      color: '#A78BFA' },
    { icon: Zap,      title: 'Ideas Lab', body: 'AI setups scored 0–100% confidence',          color: '#FBBF24' },
    { icon: Layers,   title: 'Markets',   body: 'Sector heatmaps · gainers · indices',         color: '#F472B6' },
  ]

  const stats = [
    { label: 'Data Sources', value: '14+' },
    { label: 'Assets',       value: '12K+' },
    { label: 'Markets',      value: '60+' },
    { label: 'AI Queries',   value: '∞ Pro' },
  ]

  return (
    <div className="md:hidden min-h-screen bg-surface-base text-fg-primary flex flex-col pb-28">
      {/* Hero */}
      <div className="relative overflow-hidden px-5 pt-14 pb-10">
        <div className="absolute inset-0 opacity-20">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-96 h-64 bg-cyan-500 rounded-full blur-3xl" />
          <div className="absolute bottom-0 right-0 w-64 h-48 bg-blue-600 rounded-full blur-3xl" />
        </div>
        <motion.div
          className="relative"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <div className="flex items-center gap-3 mb-5">
            <div className="w-12 h-12 rounded-2xl bg-surface-raised border border-cyan-500/25 overflow-hidden shadow-lg shadow-cyan-500/15">
              <Image src="/logo.png" alt="QuantTrade AI" width={48} height={48} className="object-contain" />
            </div>
            <div>
              <p className="text-[9px] font-bold uppercase tracking-widest text-fg-muted">QuantTrade Technologies</p>
              <h1 className="text-xl font-black text-fg-primary">QuantTrade AI</h1>
            </div>
          </div>
          <p className="text-lg font-light text-fg-primary leading-relaxed mb-3">
            Institutional-grade intelligence at <span className="text-fg-primary font-semibold">retail price.</span>
          </p>
          <p className="text-[13px] text-fg-muted leading-relaxed">
            Real-time data, geopolitical risk, AI research, and strategy backtesting in one tool. Built by a single engineer for serious discretionary traders.
          </p>
        </motion.div>
      </div>

      {/* Stats row */}
      <div className="px-5 mb-6">
        <div className="grid grid-cols-4 gap-2">
          {stats.map((s, i) => (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.07 }}
              className="bg-surface-raised border border-line-subtle rounded-2xl p-3 text-center"
            >
              <div className="text-[17px] font-black text-fg-primary">{s.value}</div>
              <div className="text-[9px] text-fg-muted uppercase tracking-wider mt-0.5 leading-tight">{s.label}</div>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Capabilities */}
      <div className="px-5 mb-6 space-y-2">
        <p className="text-[9px] font-bold uppercase tracking-widest text-fg-muted mb-3">Capabilities</p>
        {capabs.map((c, i) => {
          const Icon = c.icon
          return (
            <motion.div
              key={c.title}
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1 + i * 0.06 }}
              className="flex items-center gap-3 bg-surface-raised border border-line-subtle rounded-2xl px-4 py-3"
            >
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: `${c.color}18`, border: `1px solid ${c.color}25` }}
              >
                <Icon className="w-4 h-4" style={{ color: c.color }} />
              </div>
              <div className="min-w-0">
                <div className="text-[13px] font-bold text-fg-primary">{c.title}</div>
                <div className="text-[11px] text-fg-muted truncate">{c.body}</div>
              </div>
            </motion.div>
          )
        })}
      </div>

      {/* Tech stack */}
      <div className="px-5 mb-6">
        <p className="text-[9px] font-bold uppercase tracking-widest text-fg-muted mb-3">Tech Stack</p>
        <div className="bg-surface-raised border border-line-subtle rounded-2xl p-4 space-y-2.5">
          {[
            { label: 'Frontend', value: 'Next.js 15, React 18, Framer Motion, Three.js' },
            { label: 'Backend',  value: 'FastAPI, SQLAlchemy, Celery, WebSockets' },
            { label: 'AI / ML',  value: 'GPT-4o, LangChain RAG, pgvector embeddings' },
            { label: 'Data',     value: 'PostgreSQL (Neon), Redis, 14 live APIs' },
            { label: 'Infra',    value: 'Vercel Edge, Railway, Cloudflare CDN' },
          ].map((s) => (
            <div key={s.label} className="flex gap-2">
              <span className="text-[11px] text-fg-muted w-16 shrink-0 font-bold">{s.label}</span>
              <span className="text-[11px] text-fg-muted leading-snug">{s.value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Disclaimer */}
      <div className="px-5 mb-6">
        <div className="bg-amber-500/5 border border-amber-500/15 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span className="text-[11px] font-bold text-amber-300">Not investment advice</span>
          </div>
          <p className="text-[11px] text-fg-muted leading-relaxed">
            All data is sourced from third parties and provided "as is". Market data may be delayed. QuantTrade AI is not a registered investment adviser or broker-dealer.
          </p>
        </div>
      </div>

      {/* CTA */}
      <div className="px-5 mb-6 flex flex-col gap-3">
        <Link
          href="/pricing"
          className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-gradient-to-r from-cyan-500 to-sky-500 text-white font-bold text-[14px]"
        >
          <Zap className="w-4 h-4" /> View Pricing
        </Link>
        <Link
          href="/"
          className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl border border-line-default text-fg-primary font-bold text-[14px]"
        >
          Open Dashboard
        </Link>
      </div>

      <BottomNav />
    </div>
  )
}

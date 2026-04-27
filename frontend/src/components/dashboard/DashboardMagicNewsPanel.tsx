'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { Instrument_Serif, DM_Sans } from 'next/font/google'
import {
  Zap,
  RefreshCw,
  Activity,
  Clock,
  TrendingUp,
  TrendingDown,
  Minus,
  Radio,
  Sparkles,
  Newspaper,
} from 'lucide-react'
import { QuoteActivityFlash } from '@/components/QuoteActivityFlash'
import BrandedNewsLoading from '@/components/loading/BrandedNewsLoading'
import type { DashboardNewsItem } from '@/lib/dashboard-continent-news'
const magicDisplay = Instrument_Serif({
  subsets: ['latin'],
  weight: ['400'],
  variable: '--font-magic-display',
  display: 'swap',
})

const magicSans = DM_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-magic-sans',
  display: 'swap',
})

const dashToolbar =
  'h-12 px-4 border-b border-slate-700/30 flex items-center justify-between shrink-0 gap-2'

function HeadlineThumb({
  src,
  alt,
  layout,
}: {
  src?: string | null
  alt: string
  layout: 'hero' | 'dense' | 'wire'
}) {
  const [failed, setFailed] = useState(false)
  const frame =
    layout === 'hero'
      ? 'w-full aspect-[16/9] sm:aspect-[2/1] max-h-[240px]'
      : layout === 'dense'
        ? 'w-[6.5rem] h-[4.5rem] shrink-0'
        : 'w-12 h-12 shrink-0'
  const radius = layout === 'hero' ? 'rounded-xl' : layout === 'dense' ? 'rounded-lg' : 'rounded-md'

  if (!src || failed) {
    return (
      <div
        className={`${frame} ${radius} flex items-center justify-center border border-slate-700/50 bg-gradient-to-br from-slate-800/90 to-slate-950/90 shrink-0`}
        aria-hidden
      >
        <Newspaper className={layout === 'hero' ? 'w-10 h-10 text-fg-muted' : 'w-5 h-5 text-fg-muted'} />
      </div>
    )
  }

  return (
    <div className={`${frame} ${radius} relative shrink-0 overflow-hidden border border-slate-700/40 bg-slate-900`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- remote CDN hosts vary; native img avoids config churn */}
      <img
        src={src}
        alt={alt}
        className="absolute inset-0 h-full w-full object-cover object-center transition-transform duration-700 group-hover/item:scale-105"
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    </div>
  )
}

function sentimentIcon(sentiment: string | null | undefined) {
  const isBullish = sentiment === 'Bullish'
  const isBearish = sentiment === 'Bearish'
  return (
    <div
      className={`px-1.5 py-0.5 rounded shrink-0 flex items-center gap-1 border ${
        isBullish ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : isBearish ? 'bg-rose-500/10 border-rose-500/20 text-rose-400' : 'bg-slate-700/20 border-slate-700/40 text-slate-400'
      }`}
    >
      {isBullish ? (
        <TrendingUp className="w-2.5 h-2.5" />
      ) : isBearish ? (
        <TrendingDown className="w-2.5 h-2.5" />
      ) : (
        <Minus className="w-2.5 h-2.5" />
      )}
      <span className="text-[9px] font-bold uppercase tracking-wider">{sentiment || 'Neutral'}</span>
    </div>
  )
}

function NewsCard({
  news,
  layout,
}: {
  news: DashboardNewsItem
  layout: 'hero' | 'dense' | 'wire'
}) {
  const isHero = layout === 'hero'
  const isWire = layout === 'wire'
  const imgAlt = news.title.slice(0, 120)
  const inner = (
    <div
      className={`group/item flex rounded-xl border transition-all duration-300 h-full ${
        isHero
          ? 'flex-col gap-4 p-4 border-amber-500/20 bg-gradient-to-br from-amber-500/[0.03] via-slate-900/60 to-slate-950 shadow-lg hover:shadow-[0_0_30px_-10px_rgba(251,191,36,0.2)] hover:border-amber-500/40 hover:bg-gradient-to-br hover:from-amber-500/[0.06]'
          : isWire
            ? 'flex-row items-center gap-3 py-2.5 px-3 border-slate-800/60 bg-slate-950/40 hover:border-amber-500/30 hover:bg-amber-500/[0.04]'
            : 'flex-row items-start gap-3.5 p-3 border-slate-800/50 bg-slate-900/40 hover:border-amber-500/30 hover:bg-amber-500/[0.05]'
      }`}
    >
      <HeadlineThumb src={news.imageUrl} alt={imgAlt} layout={layout} />
      <div className={`flex min-w-0 flex-1 gap-2.5 ${isWire ? 'items-center' : 'flex-col justify-between'}`}>
        <div className="flex-1 min-w-0 w-full">
          <p
            className={`text-slate-200 font-medium leading-snug transition-colors group-hover/item:text-amber-400 ${
              isHero
                ? `text-lg sm:text-xl tracking-tight ${magicDisplay.className}`
                : isWire
                  ? 'text-xs line-clamp-2'
                  : 'text-[13px] sm:text-sm line-clamp-2'
            }`}
          >
            {news.title}
          </p>
          <div className={`flex items-center gap-2 flex-wrap text-fg-muted ${isHero ? 'mt-3' : 'mt-2'}`}>
            <span className="text-[10px] flex items-center gap-1 shrink-0">
              <Clock className="w-3 h-3" />
              <span className="truncate max-w-[80px]">{news.source}</span>
            </span>
            <span className="text-[10px] font-mono text-fg-muted">{news.time}</span>
            {!isWire && news.sentiment && (
              <span className="ml-auto flex shrink-0">
                {sentimentIcon(news.sentiment)}
              </span>
            )}
          </div>
        </div>
        {!isWire && news.tickers.length > 0 && (
          <div className="flex gap-1.5 flex-wrap w-full mt-auto">
            {news.tickers.slice(0, isHero ? 5 : 3).map((t) => (
              <span
                key={t}
                className="px-1.5 py-0.5 text-[9px] rounded font-mono bg-slate-800/80 text-fg-secondary border border-slate-700/50"
              >
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )

  if (news.url) {
    return (
      <a
        href={news.url}
        target="_blank"
        rel="noopener noreferrer"
        className="block min-w-0 h-full focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50 rounded-xl"
      >
        {inner}
      </a>
    )
  }
  return <div className="min-w-0 h-full">{inner}</div>
}

const listStagger = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.04 } },
}

const rowReveal = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] as const } },
}

export type DashboardMagicNewsPanelProps = {
  mode: 'global' | 'regional'
  continentLabel: string
  globalItems: DashboardNewsItem[]
  regionalItems: DashboardNewsItem[]
  wireItems: DashboardNewsItem[]
  isPending: boolean
  isError: boolean
  isFetching: boolean
  continentNewsLoading: boolean
  onRefresh: () => void
  newsActivityFingerprint: number
  shellClassName: string
}

export default function DashboardMagicNewsPanel({
  mode,
  continentLabel,
  globalItems,
  regionalItems,
  wireItems,
  isPending,
  isError,
  isFetching,
  continentNewsLoading,
  onRefresh,
  newsActivityFingerprint,
  shellClassName,
}: DashboardMagicNewsPanelProps) {
  const isGlobal = mode === 'global'
  const hasContent = isGlobal
    ? globalItems.length > 0
    : regionalItems.length > 0 || wireItems.length > 0

  const [hero, ...restRegional] = regionalItems

  /** ~6 headline slots tall; remainder scrolls inside the panel */
  const newsBodyScrollClass = isGlobal
    ? 'max-h-[min(40rem,calc(76vh-12rem))]'
    : 'max-h-[min(42rem,calc(76vh-12rem))]'

  return (
    <div className={`${magicDisplay.variable} ${magicSans.variable} ${magicSans.className} ${shellClassName}`}>
      <div className="hud-panel h-full flex flex-col relative overflow-hidden min-h-0 flex-1">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.65]"
          aria-hidden
          style={{
            background:
              'radial-gradient(900px 420px at 12% -10%, rgba(251,191,36,0.14), transparent 55%), radial-gradient(700px 380px at 88% 0%, rgba(45,212,191,0.1), transparent 50%), linear-gradient(165deg, rgba(15,23,42,0.5) 0%, transparent 40%)',
          }}
        />
        <div
          className="pointer-events-none absolute inset-0 mix-blend-overlay opacity-[0.12]"
          aria-hidden
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
          }}
        />
        <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-amber-400/35 to-transparent" />

        <div className={`${dashToolbar} relative z-[1]`}>
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.15em] text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-md shadow-[0_0_15px_rgba(251,191,36,0.15)] shrink-0">
              <Sparkles className="w-3 h-3 text-amber-400" />
              {isGlobal ? 'Live news' : 'Regional desk'}
            </span>
            {!isGlobal && (
              <span className="text-[10px] text-amber-200/70 font-medium truncate hidden sm:inline">
                {continentLabel}
              </span>
            )}
            <QuoteActivityFlash fingerprint={newsActivityFingerprint} />
            {isFetching && !isPending && (
              <span className="text-[10px] text-fg-muted font-mono hidden sm:inline">Syncing…</span>
            )}
          </div>
          <button
            type="button"
            onClick={() => onRefresh()}
            className="hud-card p-1.5 text-amber-300/90 hover:text-white transition-colors shrink-0 rounded-lg"
            aria-label="Refresh news"
          >
            <RefreshCw className={`w-3 h-3 ${isFetching ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="flex flex-1 min-h-0 flex-col overflow-hidden relative z-[1]">
          {isPending ? (
            <BrandedNewsLoading rows={10} />
          ) : isError ? (
            <div className="flex flex-col items-center justify-center h-full py-10 text-center px-4">
              <Activity className="w-8 h-8 text-amber-500/60 mb-3" />
              <p className="text-fg-secondary text-sm font-medium">Could not load headlines</p>
              <button
                type="button"
                onClick={() => onRefresh()}
                className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-600 text-xs text-white hover:border-teal-500/50"
              >
                <RefreshCw className="w-3 h-3" /> Retry
              </button>
            </div>
          ) : hasContent ? (
            <div
              className={`min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-y-contain p-3 md:p-4 [scrollbar-gutter:stable] ${newsBodyScrollClass}`}
            >
              {isGlobal ? (
                <motion.div
                  className="flex flex-col gap-3"
                  initial="hidden"
                  animate="visible"
                  variants={listStagger}
                >
                  {globalItems.map((news, idx) => (
                    <motion.div
                      key={news.key}
                      variants={rowReveal}
                    >
                      <NewsCard news={news} layout={idx === 0 ? 'hero' : 'dense'} />
                    </motion.div>
                  ))}
                </motion.div>
              ) : (
                <div className="flex flex-col xl:grid xl:grid-cols-12 gap-4 xl:gap-5">
                  <section className="xl:col-span-7 flex flex-col gap-3 min-w-0">
                    <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest text-amber-200/80">
                      <Radio className="w-3.5 h-3.5 text-amber-400" />
                      {continentLabel} · Guardian wire
                    </div>
                    {continentNewsLoading && !hero ? (
                      <div className="rounded-xl border border-dashed border-amber-500/25 bg-slate-950/40 p-6 text-center text-sm text-fg-muted">
                        Pulling regional headlines…
                      </div>
                    ) : hero ? (
                      <motion.div initial="hidden" animate="visible" variants={rowReveal}>
                        <NewsCard news={hero} layout="hero" />
                      </motion.div>
                    ) : (
                      <div className="rounded-xl border border-slate-800/60 bg-slate-950/30 p-4 text-sm text-fg-muted">
                        No regional desk file for this tab yet. Wire feed still updates live.
                      </div>
                    )}
                    {restRegional.length > 0 && (
                      <motion.div
                        className="grid grid-cols-1 sm:grid-cols-2 gap-2.5"
                        initial="hidden"
                        animate="visible"
                        variants={listStagger}
                      >
                        {restRegional.map((news) => (
                          <motion.div key={news.key} variants={rowReveal}>
                            <NewsCard news={news} layout="dense" />
                          </motion.div>
                        ))}
                      </motion.div>
                    )}
                  </section>

                  <section className="xl:col-span-5 flex flex-col gap-2.5 min-h-0 min-w-0 border-t xl:border-t-0 xl:border-l border-slate-800/50 pt-4 xl:pt-0 xl:pl-5">
                    <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest text-teal-200/75 shrink-0">
                      <Zap className="w-3.5 h-3.5 text-teal-400" />
                      Global wire
                      <span className="text-fg-muted font-mono font-normal normal-case tracking-normal">
                        · deduped vs desk
                      </span>
                    </div>
                    <div className="flex flex-col gap-1.5 pr-0.5">
                      {wireItems.length === 0 ? (
                        <p className="text-xs text-fg-muted py-4">Wire queue is quiet — check back after the next refresh.</p>
                      ) : (
                        <motion.div initial="hidden" animate="visible" variants={listStagger} className="flex flex-col gap-1.5">
                          {wireItems.map((news) => (
                            <motion.div key={news.key} variants={rowReveal}>
                              <NewsCard news={news} layout="wire" />
                            </motion.div>
                          ))}
                        </motion.div>
                      )}
                    </div>
                  </section>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full py-10 text-center px-4">
              <Activity className="w-8 h-8 text-slate-700 mb-3" />
              <p className="text-fg-muted text-sm">No headlines available</p>
              <button
                type="button"
                onClick={() => onRefresh()}
                className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-600 text-xs text-white hover:border-teal-500/50"
              >
                <RefreshCw className="w-3 h-3" /> Retry
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

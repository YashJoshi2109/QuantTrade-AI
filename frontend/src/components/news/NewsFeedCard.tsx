'use client'

import { useEffect, useId, useRef, useState } from 'react'
import Link from 'next/link'
import { ChevronDown, Clock, Layers, Minus, Sparkles, TrendingDown, TrendingUp } from 'lucide-react'
import {
  categoryMeta,
  formatRelativeTime,
  formatSentimentScore,
  horizonLabel,
  impactBadge,
  publisherInitials,
  sentimentTone,
  sourceFaviconUrl,
  storyImageUrl,
  type NewsCategoryKey,
  type NewsFeedItem,
} from '@/lib/newsFeed'

/* ───────────── atoms ───────────── */

export function SentimentPill({
  item,
  showScore = true,
  size = 'sm',
}: {
  item: Pick<NewsFeedItem, 'sentiment' | 'legacy'>
  showScore?: boolean
  size?: 'xs' | 'sm'
}) {
  const tone = sentimentTone(item.sentiment?.label)
  const Icon = item.sentiment?.label === 'bullish' ? TrendingUp : item.sentiment?.label === 'bearish' ? TrendingDown : Minus
  const score = formatSentimentScore(item.sentiment?.score)
  const conf = item.sentiment?.confidence
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border font-semibold ${tone.bg} ${tone.text} ${tone.border} ${
        size === 'xs' ? 'px-1.5 py-0.5 text-[9px]' : 'px-2 py-0.5 text-[10px]'
      }`}
      title={
        item.legacy
          ? `${tone.label} (legacy feed)`
          : `${tone.label} · score ${score}${conf ? ` · ${Math.round(conf * 100)}% confidence` : ''}`
      }
    >
      <Icon className="h-3 w-3" aria-hidden />
      {tone.label}
      {showScore && !item.legacy && <span className="font-mono opacity-80">{score}</span>}
    </span>
  )
}

const IMPACT_HELP =
  'Impact 0-100: how much this story is likely to matter, from sentiment strength, source credibility, ' +
  'the size of the companies involved, recency and how many outlets carry it. 70+ high, 40-69 medium, below 40 low.'

export function ImpactMeter({ impact, compact = false }: { impact: number; compact?: boolean }) {
  const badge = impactBadge(impact)
  const v = Math.max(0, Math.min(100, Math.round(impact || 0)))
  const level = badge.level === 'high' ? 'High' : badge.level === 'medium' ? 'Med' : 'Low'
  return (
    <span
      className="inline-flex cursor-help items-center gap-1.5"
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={v}
      aria-label={`${badge.label}: ${v} of 100`}
      title={`${badge.label} · ${v}/100\n${IMPACT_HELP}`}
    >
      {!compact && <span className="text-[9px] font-semibold uppercase tracking-wider text-fg-muted">Impact</span>}
      <span className={`relative h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10 ${compact ? 'w-8' : 'w-14'}`}>
        {/* min 6% so a low score still shows a visible stub of colour */}
        <span className={`absolute inset-y-0 left-0 rounded-full ${badge.bar}`} style={{ width: `${Math.max(v, 6)}%` }} />
      </span>
      <span className={`font-mono text-[10px] tabular-nums ${badge.text}`}>
        {v}
        {!compact && <span className="ml-1 font-sans text-[9px] font-medium">{level}</span>}
      </span>
    </span>
  )
}

export function CategoryChip({ category }: { category: string }) {
  const meta = categoryMeta(category)
  return (
    <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${meta.chip}`}>
      {meta.short}
    </span>
  )
}

export function TickerChips({ tickers, max = 4 }: { tickers: string[]; max?: number }) {
  if (!tickers?.length) return null
  const shown = tickers.slice(0, max)
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {shown.map((t) => (
        <Link
          key={t}
          href={`/research?symbol=${encodeURIComponent(t)}`}
          className="rounded border border-blue-500/25 bg-blue-500/10 px-1.5 py-0.5 font-mono text-[9px] text-blue-700 dark:text-blue-300 transition-colors hover:border-blue-400/60 hover:text-blue-900 dark:hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60"
          aria-label={`Research ${t}`}
        >
          {t}
        </Link>
      ))}
      {tickers.length > max && <span className="text-[9px] text-fg-muted">+{tickers.length - max}</span>}
    </span>
  )
}

export function WhyItMatters({ item, defaultOpen = false }: { item: NewsFeedItem; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const panelId = useId()
  if (!item.ai) return null
  const tone = sentimentTone(item.ai.direction)
  const horizon = horizonLabel(item.ai.horizon)
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="inline-flex items-center gap-1 rounded text-[10px] font-semibold text-cyan-700 dark:text-cyan-300 hover:text-cyan-900 dark:hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
      >
        <Sparkles className="h-3 w-3" aria-hidden />
        Why it matters
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open && (
        <div
          id={panelId}
          className="mt-1.5 rounded-lg border border-cyan-500/15 bg-cyan-500/[0.05] p-2.5 text-[11px] leading-relaxed text-fg-secondary"
        >
          <p>{item.ai.why_it_matters}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[10px]">
            <span className={`inline-flex items-center gap-1 font-semibold ${tone.text}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} aria-hidden />
              {tone.label}
            </span>
            {horizon && <span className="text-fg-muted">Horizon: {horizon}</span>}
            {item.ai.affected_tickers?.length > 0 && (
              <span className="inline-flex items-center gap-1 text-fg-muted">
                Affects <TickerChips tickers={item.ai.affected_tickers} max={5} />
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function SourceFavicon({ url, source }: { url: string | null; source: string | null }) {
  const [failed, setFailed] = useState(false)
  if (failed) return null
  return (
    // eslint-disable-next-line @next/next/no-img-element -- favicon service
    <img
      src={sourceFaviconUrl(url, source)}
      alt=""
      width={14}
      height={14}
      className="h-3.5 w-3.5 shrink-0 rounded-sm"
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  )
}

/* No-image tile colours per category. Literal class strings so Tailwind keeps them. */
const TILE_THEME: Record<NewsCategoryKey, { wash: string; accent: string; dot: string }> = {
  earnings: { wash: 'from-sky-500/25 via-sky-500/[0.07]', accent: 'text-sky-700 dark:text-sky-300', dot: 'rgb(14 165 233 / 0.30)' },
  guidance: { wash: 'from-indigo-500/25 via-indigo-500/[0.07]', accent: 'text-indigo-700 dark:text-indigo-300', dot: 'rgb(99 102 241 / 0.30)' },
  mna: { wash: 'from-violet-500/25 via-violet-500/[0.07]', accent: 'text-violet-700 dark:text-violet-300', dot: 'rgb(139 92 246 / 0.30)' },
  analyst: { wash: 'from-cyan-500/25 via-cyan-500/[0.07]', accent: 'text-cyan-700 dark:text-cyan-300', dot: 'rgb(6 182 212 / 0.30)' },
  macro_fed: { wash: 'from-amber-500/25 via-amber-500/[0.07]', accent: 'text-amber-700 dark:text-amber-300', dot: 'rgb(245 158 11 / 0.30)' },
  economic_data: { wash: 'from-yellow-500/25 via-yellow-500/[0.07]', accent: 'text-yellow-700 dark:text-yellow-300', dot: 'rgb(234 179 8 / 0.30)' },
  regulatory_legal: { wash: 'from-rose-500/25 via-rose-500/[0.07]', accent: 'text-rose-700 dark:text-rose-300', dot: 'rgb(244 63 94 / 0.30)' },
  ipo_offering: { wash: 'from-fuchsia-500/25 via-fuchsia-500/[0.07]', accent: 'text-fuchsia-700 dark:text-fuchsia-300', dot: 'rgb(217 70 239 / 0.30)' },
  capital_return: { wash: 'from-teal-500/25 via-teal-500/[0.07]', accent: 'text-teal-700 dark:text-teal-300', dot: 'rgb(20 184 166 / 0.30)' },
  product_business: { wash: 'from-blue-500/25 via-blue-500/[0.07]', accent: 'text-blue-700 dark:text-blue-300', dot: 'rgb(59 130 246 / 0.30)' },
  energy_commodities: { wash: 'from-orange-500/25 via-orange-500/[0.07]', accent: 'text-orange-700 dark:text-orange-300', dot: 'rgb(249 115 22 / 0.30)' },
  crypto: { wash: 'from-lime-500/25 via-lime-500/[0.07]', accent: 'text-lime-700 dark:text-lime-300', dot: 'rgb(132 204 22 / 0.30)' },
  geopolitics: { wash: 'from-red-500/25 via-red-500/[0.07]', accent: 'text-red-700 dark:text-red-300', dot: 'rgb(239 68 68 / 0.30)' },
  market_moves: { wash: 'from-sky-500/25 via-sky-500/[0.07]', accent: 'text-sky-700 dark:text-sky-300', dot: 'rgb(14 165 233 / 0.30)' },
  other: { wash: 'from-slate-500/20 via-slate-500/[0.06]', accent: 'text-fg-secondary', dot: 'rgb(100 116 139 / 0.28)' },
}

function tileTheme(category: string | null | undefined) {
  return (category && TILE_THEME[category as NewsCategoryKey]) || TILE_THEME.other
}

type ThumbItem = Pick<NewsFeedItem, 'image_url' | 'url' | 'source' | 'primary_category'>

/**
 * Designed stand-in when a story has no usable image: category-tinted wash,
 * a faint dot grid, the category label and a publisher monogram + name.
 */
export function NewsFallbackTile({ item, size = 'md' }: { item: ThumbItem; size?: 'sm' | 'md' | 'lg' }) {
  const theme = tileTheme(item.primary_category)
  const publisher = (item.source || '').trim() || 'News'
  const initials = publisherInitials(publisher)
  return (
    <div
      className={`absolute inset-0 bg-gradient-to-br ${theme.wash} to-transparent`}
      data-testid="news-fallback-tile"
    >
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `radial-gradient(${theme.dot} 1px, transparent 1.25px)`,
          backgroundSize: size === 'lg' ? '14px 14px' : '9px 9px',
          WebkitMaskImage: 'linear-gradient(135deg, #000 0%, rgba(0,0,0,0.35) 55%, transparent 85%)',
          maskImage: 'linear-gradient(135deg, #000 0%, rgba(0,0,0,0.35) 55%, transparent 85%)',
        }}
      />
      {size === 'sm' ? (
        <span
          className={`absolute inset-0 grid place-items-center font-bold tracking-tight ${theme.accent} ${
            initials.length > 2 ? 'text-[11px]' : 'text-sm'
          }`}
        >
          {initials}
        </span>
      ) : (
        <div className={`absolute inset-0 flex flex-col justify-between ${size === 'lg' ? 'p-4' : 'p-2'}`}>
          <span
            className={`font-semibold uppercase tracking-wider ${theme.accent} ${size === 'lg' ? 'text-[10px]' : 'text-[8px]'}`}
          >
            {categoryMeta(item.primary_category).short}
          </span>
          <span className="flex min-w-0 items-center gap-2">
            <span
              className={`grid shrink-0 place-items-center rounded-md bg-surface-base/75 font-bold ring-1 ring-line-subtle ${theme.accent} ${
                size === 'lg' ? 'h-10 w-10 text-sm' : 'h-6 w-6 text-[9px] sm:h-7 sm:w-7 sm:text-[10px]'
              }`}
            >
              {initials}
            </span>
            <span
              className={`min-w-0 truncate font-semibold text-fg-secondary ${
                size === 'lg' ? 'text-base' : 'hidden text-[11px] sm:inline'
              }`}
            >
              {publisher}
            </span>
          </span>
        </div>
      )}
    </div>
  )
}

/**
 * Story thumbnail in a fixed-size box (no layout shift). The designed tile is
 * always underneath; the remote image fades in over it once it loads and is
 * dropped on error. Third-party CDN, so no referrer and lazy loading.
 */
export function NewsThumb({
  item,
  className,
  iconSize = 'md',
}: {
  item: ThumbItem
  className: string
  iconSize?: 'sm' | 'md' | 'lg'
}) {
  const src = storyImageUrl(item.image_url)
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const showImage = Boolean(src) && src !== failedSrc
  const loaded = showImage && loadedSrc === src

  // An image served from cache can finish before React attaches onLoad.
  // (Only the success case: a lazy image not yet fetched also has naturalWidth 0.)
  useEffect(() => {
    const el = imgRef.current
    if (el && src && el.complete && el.naturalWidth > 0) setLoadedSrc(src)
  }, [src])

  return (
    <div
      className={`relative shrink-0 overflow-hidden border border-line-subtle bg-surface-raised ${className}`}
      aria-hidden
    >
      {!loaded && <NewsFallbackTile item={item} size={iconSize} />}
      {showImage && (
        // eslint-disable-next-line @next/next/no-img-element -- remote publisher CDNs vary; next/image would proxy them
        <img
          ref={imgRef}
          src={src as string}
          alt=""
          className={`absolute inset-0 h-full w-full object-cover transition-[opacity,transform] duration-500 group-hover:scale-[1.03] ${
            loaded ? 'opacity-100' : 'opacity-0'
          }`}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={() => setLoadedSrc(src)}
          onError={() => setFailedSrc(src)}
        />
      )}
    </div>
  )
}

function SourceLine({ item }: { item: NewsFeedItem }) {
  const extra = Math.max(0, (item.sources_count || 1) - 1)
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-[10px] text-fg-muted">
      <SourceFavicon url={item.url} source={item.source} />
      <span className="truncate font-medium text-fg-secondary">{item.source || 'News'}</span>
      {extra > 0 && (
        <span
          className="inline-flex shrink-0 items-center gap-0.5 rounded bg-surface-overlay px-1 py-px text-[9px]"
          title={item.sources.join(', ')}
        >
          <Layers className="h-2.5 w-2.5" aria-hidden />
          {item.sources_count} sources
        </span>
      )}
      <span aria-hidden>&middot;</span>
      <time dateTime={item.published_at} className="inline-flex shrink-0 items-center gap-0.5" suppressHydrationWarning>
        <Clock className="h-2.5 w-2.5" aria-hidden />
        {formatRelativeTime(item.published_at)}
      </time>
    </span>
  )
}

/* ───────────── card ───────────── */

/** hero: big image on top · default: grid card · row: thumbnail left, full detail (lists) · compact: small row */
export type NewsCardVariant = 'hero' | 'default' | 'row' | 'compact'

export default function NewsFeedCard({
  item,
  variant = 'default',
  isNew = false,
}: {
  item: NewsFeedItem
  variant?: NewsCardVariant
  isNew?: boolean
}) {
  const isHero = variant === 'hero'
  const isCompact = variant === 'compact'
  const isRow = variant === 'row'
  const sideThumb = isCompact || isRow

  const titleCls = isHero
    ? 'text-lg sm:text-xl font-bold leading-tight text-fg-primary'
    : isCompact
      ? 'text-[12px] font-semibold leading-snug text-fg-primary line-clamp-2'
      : 'text-[13px] font-semibold leading-snug text-fg-primary line-clamp-3'

  return (
    <article
      className={`group relative flex rounded-xl ${sideThumb ? `flex-row items-start ${isRow ? 'gap-3' : 'gap-2.5'}` : 'flex-col'} border border-line-subtle bg-surface-base/40 transition-colors hover:border-line-default ${
        isHero ? 'p-4' : isCompact ? 'p-2.5' : 'p-3'
      } ${isNew ? 'motion-safe:animate-news-arrive motion-reduce:ring-1 motion-reduce:ring-sky-400/50' : ''}`}
      data-cluster-id={item.cluster_id}
      data-new={isNew || undefined}
    >
      {isHero ? (
        <NewsThumb item={item} className="mb-3 aspect-[2/1] max-h-[240px] w-full rounded-lg" iconSize="lg" />
      ) : variant === 'default' && storyImageUrl(item.image_url) ? (
        <NewsThumb item={item} className="mb-2.5 h-28 w-full rounded-lg" />
      ) : isCompact ? (
        <NewsThumb item={item} className="h-14 w-14 rounded-lg" iconSize="sm" />
      ) : isRow ? (
        <NewsThumb item={item} className="h-16 w-20 rounded-lg sm:h-24 sm:w-36" iconSize="md" />
      ) : null}

      <div className={sideThumb ? 'flex min-w-0 flex-1 flex-col' : 'contents'}>
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        <CategoryChip category={item.primary_category} />
        <SentimentPill item={item} size={isCompact ? 'xs' : 'sm'} showScore={!isCompact} />
        {!item.legacy && (
          <span className="ml-auto">
            <ImpactMeter impact={item.impact} compact={isCompact} />
          </span>
        )}
      </div>

      <h3 className={titleCls}>
        {item.url ? (
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-blue-600 dark:hover:text-blue-300 focus:outline-none focus-visible:underline"
          >
            {item.title}
          </a>
        ) : (
          item.title
        )}
      </h3>

      {item.summary && !isCompact && (
        <p className={`mt-1 text-[11px] leading-relaxed text-fg-muted ${isHero ? 'line-clamp-3' : 'line-clamp-2'}`}>
          {item.summary}
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <SourceLine item={item} />
        <TickerChips tickers={item.tickers} max={isCompact ? 2 : isHero ? 6 : 4} />
      </div>

      {!isCompact && <WhyItMatters item={item} defaultOpen={isHero} />}
      </div>
    </article>
  )
}

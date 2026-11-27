'use client'

import { useId, useState } from 'react'
import Link from 'next/link'
import { ChevronDown, Clock, Layers, Minus, Newspaper, Sparkles, TrendingDown, TrendingUp } from 'lucide-react'
import {
  categoryMeta,
  formatRelativeTime,
  formatSentimentScore,
  horizonLabel,
  impactBadge,
  sentimentTone,
  sourceFaviconUrl,
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

export function ImpactMeter({ impact, compact = false }: { impact: number; compact?: boolean }) {
  const badge = impactBadge(impact)
  const v = Math.max(0, Math.min(100, Math.round(impact || 0)))
  return (
    <span
      className="inline-flex items-center gap-1.5"
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={v}
      aria-label={`${badge.label}: ${v} of 100`}
      title={`${badge.label} (${v}/100)`}
    >
      <span className={`relative h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10 ${compact ? 'w-8' : 'w-12'}`}>
        <span className={`absolute inset-y-0 left-0 rounded-full ${badge.bar}`} style={{ width: `${v}%` }} />
      </span>
      <span className={`font-mono text-[10px] ${badge.text}`}>{v}</span>
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

/**
 * Story image with graceful fallback: the publisher favicon on a tinted tile,
 * then a generic glyph — every card always has a visual.
 */
export function NewsThumb({
  item,
  className,
  iconSize = 'md',
}: {
  item: Pick<NewsFeedItem, 'image_url' | 'url' | 'source'>
  className: string
  iconSize?: 'sm' | 'md' | 'lg'
}) {
  const [imgFailed, setImgFailed] = useState(false)
  const [favFailed, setFavFailed] = useState(false)
  const showImage = Boolean(item.image_url) && !imgFailed
  const fav = iconSize === 'lg' ? 'h-12 w-12' : iconSize === 'md' ? 'h-8 w-8' : 'h-6 w-6'
  return (
    <div
      className={`relative shrink-0 overflow-hidden border border-line-subtle bg-gradient-to-br from-surface-raised to-surface-overlay ${className}`}
      aria-hidden
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- remote publisher CDNs vary
        <img
          src={item.image_url as string}
          alt=""
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setImgFailed(true)}
        />
      ) : !favFailed ? (
        // eslint-disable-next-line @next/next/no-img-element -- favicon service
        <img
          src={sourceFaviconUrl(item.url, item.source).replace('sz=64', 'sz=128')}
          alt=""
          className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-lg opacity-80 ${fav}`}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFavFailed(true)}
        />
      ) : (
        <Newspaper className="absolute left-1/2 top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 text-fg-muted" />
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
      ) : variant === 'default' && item.image_url ? (
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

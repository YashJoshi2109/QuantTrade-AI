'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Radio, CircleDot, Settings2, AlertTriangle } from 'lucide-react'
import { fetchLiveMarketHeadlines } from '@/lib/api'
import type { Continent } from '@/lib/world-exchanges'

type LiveChannelId =
  | 'bloomberg'
  | 'skynews'
  | 'euronews'
  | 'dw'
  | 'france24'
  | 'wion'
  | 'aljazeera'
  | 'yahoo_finance'
  | 'trt_world'
  | 'japan'

interface LiveChannel {
  id: LiveChannelId
  label: string
  embedUrl: string
  fallbackId?: LiveChannelId // channel to try if this one fails
}

// All channels use live_stream?channel= format so embeds auto-resolve to
// the current live stream (hardcoded video IDs expire when streams restart).
const CHANNELS: LiveChannel[] = [
  {
    id: 'bloomberg',
    label: 'Bloomberg',
    embedUrl:
      'https://www.youtube.com/embed/live_stream?channel=UCIALMKvObZNtJ6AmdCLP7Lg&autoplay=1&mute=1',
    fallbackId: 'yahoo_finance',
  },
  {
    id: 'skynews',
    label: 'Sky News',
    embedUrl:
      'https://www.youtube.com/embed/live_stream?channel=UCoMdktPbSTixAyNGwb-UYkQ&autoplay=1&mute=1',
    fallbackId: 'euronews',
  },
  {
    id: 'euronews',
    label: 'Euronews',
    embedUrl:
      'https://www.youtube.com/embed/live_stream?channel=UCSrZ3UV4jOidv8ppoVuvW9Q&autoplay=1&mute=1',
    fallbackId: 'dw',
  },
  {
    id: 'dw',
    label: 'DW News',
    embedUrl:
      'https://www.youtube.com/embed/live_stream?channel=UCknLrEdhRCp1aegoMqRaCZg&autoplay=1&mute=1',
    fallbackId: 'euronews',
  },
  {
    id: 'france24',
    label: 'FRANCE24',
    embedUrl:
      'https://www.youtube.com/embed/live_stream?channel=UCQfwfsi5VrQ8yKZ-UWmAEFg&autoplay=1&mute=1',
    fallbackId: 'euronews',
  },
  {
    id: 'wion',
    label: 'WION',
    embedUrl:
      'https://www.youtube.com/embed/live_stream?channel=UCZWMsonUZkvFyKDo4Q0HkRg&autoplay=1&mute=1',
    fallbackId: 'aljazeera',
  },
  {
    id: 'aljazeera',
    label: 'Al Jazeera',
    embedUrl:
      'https://www.youtube.com/embed/live_stream?channel=UCNye-wNBqNL5ZzHSJj3l8Bg&autoplay=1&mute=1',
    fallbackId: 'dw',
  },
  {
    id: 'yahoo_finance',
    label: 'Yahoo Finance',
    embedUrl:
      'https://www.youtube.com/embed/live_stream?channel=UCEAZeUIeJs6chDjCLnzuCpg&autoplay=1&mute=1',
    fallbackId: 'bloomberg',
  },
  {
    id: 'trt_world',
    label: 'TRT World',
    embedUrl:
      'https://www.youtube.com/embed/live_stream?channel=UCg2PvMeQR3V-L48R0oNciAg&autoplay=1&mute=1',
    fallbackId: 'aljazeera',
  },
  {
    id: 'japan',
    label: 'NHK Japan',
    embedUrl:
      'https://www.youtube.com/embed/live_stream?channel=UCSPEjw8F2nQDtmUKPFNF7_A&autoplay=1&mute=1',
    fallbackId: 'bloomberg',
  },
]

const FALLBACK_HEADLINES = ['Market data loading…']

const DEFAULT_CHANNEL_BY_CONTINENT: Partial<Record<Continent, LiveChannelId>> = {
  global: 'bloomberg',
  americas: 'bloomberg',
  europe: 'euronews',
  asia: 'wion',
  africa: 'aljazeera',
  oceania: 'skynews',
}

export default function LiveNewsChannelPanel({ continent }: { continent?: Continent }) {
  const defaultChannel =
    (continent && DEFAULT_CHANNEL_BY_CONTINENT[continent]) || 'bloomberg'
  const [activeId, setActiveId] = useState<LiveChannelId>(defaultChannel)
  const [failedChannels, setFailedChannels] = useState<Set<LiveChannelId>>(new Set())
  const [usingFallback, setUsingFallback] = useState(false)

  useEffect(() => {
    setActiveId((continent && DEFAULT_CHANNEL_BY_CONTINENT[continent]) || 'bloomberg')
    setFailedChannels(new Set())
    setUsingFallback(false)
  }, [continent])

  // Reset error state when user manually switches channel
  const handleChannelSwitch = useCallback((id: LiveChannelId) => {
    setActiveId(id)
    setUsingFallback(false)
  }, [])

  const headlineContext = useMemo(
    () => (continent ? { continent } : undefined),
    [continent]
  )

  const { data: breakingNews } = useQuery({
    queryKey: ['breaking-market-news', 'liveHeadlines', continent ?? 'global'],
    queryFn: () => fetchLiveMarketHeadlines(25, headlineContext),
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: 1,
  })

  const tickerHeadlines = (breakingNews?.length
    ? breakingNews.map((n) => n.title).filter(Boolean)
    : FALLBACK_HEADLINES) as string[]

  // Resolve which channel to actually show (handle fallback chain)
  const activeChannel = useMemo(() => {
    const primary = CHANNELS.find((c) => c.id === activeId) ?? CHANNELS[0]

    if (!failedChannels.has(primary.id)) return primary

    // Walk the fallback chain (max 3 hops to avoid loops)
    let candidate = primary
    for (let i = 0; i < 3; i++) {
      if (!candidate.fallbackId) break
      const next = CHANNELS.find((c) => c.id === candidate.fallbackId)
      if (!next || failedChannels.has(next.id)) break
      candidate = next
    }

    return failedChannels.has(candidate.id) ? primary : candidate
  }, [activeId, failedChannels])

  const showingFallback = activeChannel.id !== activeId && failedChannels.has(activeId)

  // When iframe fails to load (fires error or takes too long)
  const handleStreamError = useCallback(() => {
    setFailedChannels((prev) => {
      const next = new Set(prev)
      next.add(activeId)
      return next
    })
    setUsingFallback(true)
  }, [activeId])

  return (
    <div className="hud-panel p-0 overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-800/60 bg-gradient-to-r from-[#050814] via-[#070b16] to-[#050814] px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-500/20 border border-red-500/50 shadow-[0_0_15px_rgba(248,113,113,0.5)]">
            <Radio className="h-4 w-4 text-red-400" />
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-200">
                Live News
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold text-red-300 border border-red-500/40">
                <CircleDot className="h-3 w-3 text-red-400 animate-pulse" />
                Live
              </span>
            </div>
            <span className="mt-0.5 text-[10px] text-slate-500">
              Global TV streams · audio-friendly for desk use
            </span>
          </div>
        </div>

        <button
          type="button"
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700/70 bg-slate-900/60 text-slate-400 hover:text-white hover:border-slate-500 transition-colors"
          aria-label="Live news settings"
        >
          <Settings2 className="h-4 w-4" />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1 border-b border-slate-800/60 bg-[#050816]/95 px-3 py-2">
        {CHANNELS.map((ch) => {
          const isActive = ch.id === activeId
          const hasFailed = failedChannels.has(ch.id)
          return (
            <button
              key={ch.id}
              type="button"
              onClick={() => handleChannelSwitch(ch.id)}
              className={`rounded-md px-2.5 py-1 text-[10px] font-medium transition-all ${
                isActive
                  ? 'bg-slate-100 text-slate-900 shadow-sm'
                  : hasFailed
                    ? 'bg-slate-900/70 text-slate-500 line-through hover:bg-slate-800'
                    : 'bg-slate-900/70 text-slate-300 hover:bg-slate-800'
              }`}
            >
              {ch.label}
            </button>
          )
        })}
      </div>

      {/* Fallback banner */}
      {showingFallback && (
        <div className="flex items-center gap-2 bg-amber-500/10 border-b border-amber-500/20 px-3 py-1.5">
          <AlertTriangle className="h-3 w-3 text-amber-400 shrink-0" />
          <span className="text-[10px] text-amber-300">
            {CHANNELS.find((c) => c.id === activeId)?.label} stream unavailable — showing{' '}
            {activeChannel.label} instead
          </span>
          <button
            type="button"
            onClick={() => {
              setFailedChannels((prev) => {
                const next = new Set(prev)
                next.delete(activeId)
                return next
              })
              setUsingFallback(false)
            }}
            className="ml-auto text-[10px] text-amber-400 hover:text-amber-200 underline"
          >
            Retry
          </button>
        </div>
      )}

      <div className="relative bg-black">
        {/* Manual fallback trigger for any channel */}
        <div className="absolute top-2 left-2 z-10">
          <button
            type="button"
            onClick={handleStreamError}
            className="rounded bg-slate-800/90 px-2 py-1 text-[10px] text-slate-300 hover:bg-slate-700 hover:text-white border border-slate-600/50"
          >
            Video unavailable? Try backup
          </button>
        </div>

        <div className="relative w-full overflow-hidden bg-black pt-[56.25%]">
          <iframe
            key={activeChannel.id} // force remount on channel change
            src={activeChannel.embedUrl}
            title={`${activeChannel.label} Live`}
            className="absolute inset-0 h-full w-full border-0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            loading="lazy"
          />
        </div>
      </div>

      <div className="border-t border-slate-800/60 bg-gradient-to-r from-[#050816] via-[#040715] to-[#050816] px-3 py-2">
        <div className="flex items-center gap-2 text-[11px] text-slate-300">
          <span className="shrink-0 rounded bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] text-emerald-400 border border-emerald-500/30">
            Macro Tape
          </span>
          <div className="flex-1 min-w-0 overflow-hidden">
            <div
              className="flex gap-8 whitespace-nowrap animate-marquee"
              style={{ width: 'max-content' }}
            >
              {tickerHeadlines.concat(tickerHeadlines).map((h, idx) => (
                <span key={idx} className="text-slate-400 inline">
                  {h}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

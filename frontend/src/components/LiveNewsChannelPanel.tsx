'use client'

import { useState } from 'react'
import { Radio, CircleDot, Settings2 } from 'lucide-react'

type LiveChannelId =
  | 'bloomberg'
  | 'skynews'
  | 'euronews'
  | 'dw'
  | 'cnbc'
  | 'france24'
  | 'alarabiya'
  | 'aljazeera'
  | 'foxbusiness'
  | 'cgtn'
  | 'japan'

interface LiveChannel {
  id: LiveChannelId
  label: string
  embedUrl?: string
}

const CHANNELS: LiveChannel[] = [
  {
    id: 'bloomberg',
    label: 'Bloomberg',
    // Bloomberg live stream – may change, but safe as a default
    embedUrl:
      'https://www.youtube.com/embed/live_stream?channel=UCIALMKvObZNtJ6AmdCLP7Lg&autoplay=1&mute=1',
  },
  {
    id: 'skynews',
    label: 'SkyNews',
    embedUrl:
      'https://www.youtube.com/embed/YDvsBbKfLPA?si=NxcTKgE5rV1uA8GC&autoplay=1&mute=1',
  },
  {
    id: 'euronews',
    label: 'Euronews',
    embedUrl:
      'https://www.youtube.com/embed/pykpO5kQJ98?si=EwsSHKvP5nTL92ez&autoplay=1&mute=1',
  },
  {
    id: 'dw',
    label: 'DW',
    embedUrl:
      'https://www.youtube.com/embed/live_stream?channel=UCknLrEdhRCp1aegoMqRaCZg&autoplay=1&mute=1',
  },
  {
    id: 'cnbc',
    label: 'CNBC TV Live',
    embedUrl:
      'https://www.youtube.com/embed/a6KFJSDqzfc?autoplay=1&mute=1',
  },
  {
    id: 'france24',
    label: 'FRANCE24',
    embedUrl:
      'https://www.youtube.com/embed/live_stream?channel=UCQfwfsi5VrQ8yKZ-UWmAEFg&autoplay=1&mute=1',
  },
  {
    id: 'alarabiya',
    label: 'AlArabiya',
    embedUrl:
      'https://www.youtube.com/embed/n7eQejkXbnM?si=XR5DQQc0KtJJC_6P&autoplay=1&mute=1',
  },
  {
    id: 'aljazeera',
    label: 'AlJazeera',
    embedUrl:
      'https://www.youtube.com/embed/live_stream?channel=UCNye-wNBqNL5ZzHSJj3l8Bg&autoplay=1&mute=1',
  },
  {
    id: 'foxbusiness',
    label: 'Fox Business',
    embedUrl:
      'https://www.youtube.com/embed/gfEwymG-6GI?si=xLgHt94nhpHxhOwW&autoplay=1&mute=1',
  },
  {
    id: 'cgtn',
    label: 'CGTN (China)',
    embedUrl:
      'https://www.youtube.com/embed/BOy2xDU1LC8?si=1HvnmjuZEPA3JkVc&autoplay=1&mute=1',
  },
  {
    id: 'japan',
    label: 'NHK Japan',
    embedUrl:
      'https://www.youtube.com/embed/f0lYkdA-Gtw?si=Vkl5alvVnZTm03NN&autoplay=1&mute=1',
  }

]

const HEADLINE_TICKER = [
  'Futures edge higher as risk-on tone builds in Asia',
  "Oil edges up on Middle East tensions and Red Sea shipping reroutes",
  'JPY carry trades remain crowded as BoJ stays patient',
  'US tech mega-cap breadth narrows, small caps lag',
  'Credit spreads stable despite equity volatility spike earlier in session',
]

export default function LiveNewsChannelPanel() {
  const [activeId, setActiveId] = useState<LiveChannelId>('bloomberg')
  const activeChannel = CHANNELS.find((c) => c.id === activeId) ?? CHANNELS[0]

  return (
    <div className="hud-panel p-0 overflow-hidden">
      {/* Header bar */}
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

      {/* Channel tabs */}
      <div className="flex flex-wrap items-center gap-1 border-b border-slate-800/60 bg-[#050816]/95 px-3 py-2">
        {CHANNELS.map((ch) => {
          const isActive = ch.id === activeId
          return (
            <button
              key={ch.id}
              type="button"
              onClick={() => setActiveId(ch.id)}
              className={`rounded-md px-2.5 py-1 text-[10px] font-medium transition-all ${
                isActive
                  ? 'bg-slate-100 text-slate-900 shadow-sm'
                  : 'bg-slate-900/70 text-slate-300 hover:bg-slate-800'
              }`}
            >
              {ch.label}
            </button>
          )
        })}
      </div>

      {/* Video area */}
      <div className="relative bg-black">
        <div className="relative w-full overflow-hidden bg-black pt-[56.25%]">
          {activeChannel.embedUrl ? (
            <iframe
              src={activeChannel.embedUrl}
              title={`${activeChannel.label} Live`}
              className="absolute inset-0 h-full w-full border-0"
              allow="autoplay; encrypted-media; picture-in-picture"
              allowFullScreen
              loading="lazy"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900">
              <div className="text-center">
                <p className="text-xs font-medium text-slate-200 mb-1">
                  {activeChannel.label} stream
                </p>
                <p className="text-[11px] text-slate-500">
                  Stream URL not configured yet. Add an embed later.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Ticker bar */}
      <div className="border-t border-slate-800/60 bg-gradient-to-r from-[#050816] via-[#040715] to-[#050816] px-3 py-2">
        <div className="flex items-center gap-2 text-[11px] text-slate-300">
          <span className="rounded bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] text-emerald-400 border border-emerald-500/30">
            Macro Tape
          </span>
          <div className="flex-1 overflow-x-auto whitespace-nowrap scrollbar-thin scrollbar-thumb-slate-700/70 scrollbar-track-transparent">
            <div className="inline-flex items-center gap-6">
              {HEADLINE_TICKER.map((h, idx) => (
                <span key={idx} className="text-slate-400">
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


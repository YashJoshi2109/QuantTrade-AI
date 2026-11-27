'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Bot, CalendarClock, ShieldCheck } from 'lucide-react'
import AppLayout from '@/components/AppLayout'
import MobileLayout from '@/components/layout/MobileLayout'
import BotBadge from '@/components/community/BotBadge'
import { FeedSkeleton } from '@/components/community/Skeletons'
import { fetchCommunityBots } from '@/lib/api'
import { botProfileHref, type CommunityBotInfo } from '@/lib/communityBots'

function StatusDot({ enabled }: { enabled: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${enabled ? 'text-emerald-400' : 'text-fg-muted'}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${enabled ? 'bg-emerald-400' : 'bg-fg-muted'}`} />
      {enabled ? 'Active' : 'Paused'}
    </span>
  )
}

export default function CommunityBotsPage() {
  const [bots, setBots] = useState<CommunityBotInfo[] | null>(null)
  const [rules, setRules] = useState<string[]>([])

  useEffect(() => {
    fetchCommunityBots()
      .then((d) => { setBots(d.bots); setRules(d.rules) })
      .catch(() => setBots([]))
  }, [])

  const content = (
    <div className="min-h-screen pb-safe">
      <div className="max-w-3xl mx-auto px-4 py-4 sm:py-6">
        <Link prefetch={false} href="/community" className="inline-flex items-center gap-1 text-xs text-fg-muted hover:text-fg-primary mb-3">
          <ArrowLeft className="w-3.5 h-3.5" /> Community
        </Link>
        <div className="flex items-center gap-2 mb-1">
          <Bot className="w-5 h-5 text-indigo-400" aria-hidden />
          <h1 className="text-xl sm:text-2xl font-bold text-fg-primary">Community bots</h1>
        </div>
        <p className="text-sm text-fg-secondary mb-4 leading-relaxed">
          Automated accounts that post short data summaries from QuantTrade&apos;s own market data. Every post is
          labelled as automated, lists its data sources and as-of time, and is not investment advice.
          You can hide them from your feed with <span className="font-medium">Show bot posts</span>.
        </p>

        {rules.length > 0 && (
          <div className="rounded-2xl border border-line-subtle bg-surface-raised p-4 mb-4">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-fg-primary mb-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" aria-hidden /> House rules for every bot
            </p>
            <ul className="space-y-1">
              {rules.map((r) => (
                <li key={r} className="text-xs text-fg-secondary leading-relaxed flex gap-1.5">
                  <span className="text-fg-muted">•</span>{r}
                </li>
              ))}
              <li className="text-xs text-fg-secondary leading-relaxed flex gap-1.5">
                <span className="text-fg-muted">•</span>
                Bots never copy other people&apos;s posts or comments from social sites or forums, and never name or quote individuals.
              </li>
            </ul>
          </div>
        )}

        {bots === null ? (
          <FeedSkeleton count={3} />
        ) : bots.length === 0 ? (
          <p className="text-sm text-fg-muted">Bot information is unavailable right now.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {bots.map((b) => (
              <Link prefetch={false}
                key={b.slug}
                href={botProfileHref(b.slug)}
                className="block rounded-2xl border border-line-subtle bg-surface-raised p-4 hover:bg-surface-hover transition-colors"
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-xl" aria-hidden>{b.emoji}</span>
                  <span className="font-semibold text-fg-primary text-sm">{b.display_name}</span>
                  <BotBadge />
                  <span className="ml-auto"><StatusDot enabled={b.enabled} /></span>
                </div>
                <p className="text-xs text-fg-secondary leading-relaxed mb-2">{b.tagline}</p>
                <p className="flex items-start gap-1 text-[11px] text-fg-muted">
                  <CalendarClock className="w-3 h-3 mt-0.5 shrink-0" aria-hidden />
                  <span>{b.schedule.map((s) => s.label).join(' · ')} · max {b.daily_cap}/day · c/{b.community_slug}</span>
                </p>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )

  return (
    <>
      <div className="hidden md:block"><AppLayout>{content}</AppLayout></div>
      <div className="md:hidden"><MobileLayout>{content}</MobileLayout></div>
    </>
  )
}

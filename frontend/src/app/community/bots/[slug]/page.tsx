'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowLeft, BookOpen, CalendarClock, Database, ShieldCheck } from 'lucide-react'
import AppLayout from '@/components/AppLayout'
import MobileLayout from '@/components/layout/MobileLayout'
import BotBadge from '@/components/community/BotBadge'
import PostCard from '@/components/community/PostCard'
import { FeedSkeleton } from '@/components/community/Skeletons'
import { fetchCommunityBot, type CommunityPost } from '@/lib/api'
import type { CommunityBotInfo } from '@/lib/communityBots'

type BotDetail = CommunityBotInfo & { recent_posts: CommunityPost[] }

function Section({ icon: Icon, title, children }: { icon: typeof BookOpen; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line-subtle bg-surface-raised p-4 mb-3">
      <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-fg-muted mb-2">
        <Icon className="w-3.5 h-3.5" aria-hidden /> {title}
      </h2>
      {children}
    </section>
  )
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="space-y-1.5">
      {items.map((m) => (
        <li key={m} className="text-[13px] text-fg-secondary leading-relaxed flex gap-1.5">
          <span className="text-fg-muted" aria-hidden>•</span>
          <span>{m}</span>
        </li>
      ))}
    </ul>
  )
}

export default function CommunityBotPage() {
  const { slug } = useParams<{ slug: string }>()
  const [bot, setBot] = useState<BotDetail | null | undefined>(undefined)

  useEffect(() => {
    if (!slug) return
    fetchCommunityBot(slug).then(setBot).catch(() => setBot(null))
  }, [slug])

  const content = (
    <div className="min-h-screen pb-safe">
      <div className="max-w-3xl mx-auto px-4 py-4 sm:py-6">
        <Link prefetch={false} href="/community/bots" className="inline-flex items-center gap-1 text-xs text-fg-muted hover:text-fg-primary mb-3">
          <ArrowLeft className="w-3.5 h-3.5" /> All bots
        </Link>

        {bot === undefined ? (
          <FeedSkeleton count={2} />
        ) : bot === null ? (
          <p className="text-sm text-fg-muted">This bot does not exist.</p>
        ) : (
          <>
            <header className="mb-4">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-3xl" aria-hidden>{bot.emoji}</span>
                <h1 className="text-xl sm:text-2xl font-bold text-fg-primary">{bot.display_name}</h1>
                <BotBadge />
                <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${bot.enabled ? 'bg-emerald-500/10 text-emerald-400' : 'bg-surface-hover text-fg-muted'}`}>
                  {bot.enabled ? 'Active' : 'Paused'}
                </span>
              </div>
              <p className="text-sm text-fg-muted mt-0.5">
                u/{bot.username} · posts in{' '}
                <Link prefetch={false} href={`/community/${bot.community_slug}`} className="text-blue-400 hover:underline">c/{bot.community_slug}</Link>
              </p>
              <p className="text-sm text-fg-secondary mt-2 leading-relaxed">{bot.description}</p>
              {!bot.enabled && bot.disabled_reason && (
                <p className="text-xs text-fg-muted mt-1">Paused: {bot.disabled_reason}</p>
              )}
            </header>

            <Section icon={BookOpen} title="Methodology">
              <Bullets items={bot.methodology} />
            </Section>
            <Section icon={Database} title="Data sources">
              <Bullets items={bot.data_sources} />
            </Section>
            <Section icon={CalendarClock} title="Schedule & limits">
              <Bullets
                items={[
                  ...bot.schedule.map((s) => `${s.slot.replace(/_/g, ' ')}: ${s.label}`),
                  `At most ${bot.daily_cap} post${bot.daily_cap === 1 ? '' : 's'} per day; ${bot.posts_today} today.`,
                ]}
              />
            </Section>
            <Section icon={ShieldCheck} title="Rules">
              <Bullets items={[...bot.rules, bot.disclaimer]} />
            </Section>

            <h2 className="text-sm font-semibold text-fg-primary mt-5 mb-2">Recent posts</h2>
            {bot.recent_posts.length === 0 ? (
              <p className="text-sm text-fg-muted">No posts yet. Posts appear at the scheduled times when fresh data is available.</p>
            ) : (
              <div className="space-y-2">
                {bot.recent_posts.map((p, i) => (
                  <PostCard key={p.id} post={p} index={i} />
                ))}
              </div>
            )}
          </>
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

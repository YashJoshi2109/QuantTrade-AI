'use client'

import Link from 'next/link'
import { Bot } from 'lucide-react'
import { botProfileHref } from '@/lib/communityBots'

/** "BOT" pill shown next to every automated author name. Links to the bot's methodology page. */
export default function BotBadge({ slug, className = '' }: { slug?: string | null; className?: string }) {
  const pill = (
    <span
      className={`inline-flex items-center gap-0.5 px-1.5 py-[1px] rounded-md text-[10px] font-bold uppercase tracking-wide bg-indigo-500/15 text-indigo-400 border border-indigo-500/25 ${className}`}
      title="Automated account — posts are generated from data by fixed rules. Not investment advice."
      aria-label="Automated bot account"
    >
      <Bot className="w-3 h-3" aria-hidden />
      Bot
    </span>
  )
  if (!slug) return pill
  return (
    <Link prefetch={false} href={botProfileHref(slug)} onClick={(e) => e.stopPropagation()} className="inline-flex">
      {pill}
    </Link>
  )
}

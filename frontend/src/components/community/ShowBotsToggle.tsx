'use client'

import Link from 'next/link'
import { Bot } from 'lucide-react'

/** "Show bot posts" switch used by the desktop + mobile community feeds. */
export default function ShowBotsToggle({
  checked,
  onChange,
  className = '',
}: {
  checked: boolean
  onChange: (v: boolean) => void
  className?: string
}) {
  return (
    <div className={`flex items-center justify-between gap-3 ${className}`}>
      <Link prefetch={false} href="/community/bots" className="inline-flex items-center gap-1.5 text-[11px] text-fg-muted hover:text-fg-secondary">
        <Bot className="w-3.5 h-3.5" aria-hidden />
        <span className="hidden sm:inline">Automated data posts</span>
        <span className="underline-offset-2 hover:underline text-blue-400 whitespace-nowrap">About bots</span>
      </Link>
      <label className="inline-flex items-center gap-2 cursor-pointer select-none">
        <span className="text-[11px] font-medium text-fg-secondary whitespace-nowrap">Show bot posts</span>
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          aria-label="Show bot posts"
          onClick={() => onChange(!checked)}
          className={`relative inline-flex !h-5 !w-9 !min-h-0 !min-w-0 !p-0 shrink-0 items-center rounded-full transition-colors ${
            checked ? 'bg-blue-600' : 'bg-surface-hover border border-line-subtle'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
              checked ? 'translate-x-[18px]' : 'translate-x-[2px]'
            }`}
          />
        </button>
      </label>
    </div>
  )
}

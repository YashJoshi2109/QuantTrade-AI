'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  Book,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  HelpCircle,
  Mail,
  MessageCircle,
  Search,
} from 'lucide-react'

function Category({
  title,
  icon,
  items,
}: {
  title: string
  icon: React.ReactNode
  items: string[]
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-2xl bg-surface-raised border border-line-subtle overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between p-4"
      >
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-full bg-surface-base border border-line-subtle flex items-center justify-center text-fg-primary">
            {icon}
          </div>
          <div className="text-left">
            <p className="text-[13px] font-semibold text-fg-primary">{title}</p>
            <p className="text-[11px] text-fg-muted">{items.length} articles</p>
          </div>
        </div>
        <ChevronDown className={`w-4 h-4 text-fg-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-2">
          {items.map((x) => (
            <div key={x} className="flex items-center justify-between rounded-xl bg-surface-base border border-line-subtle px-3 py-2">
              <span className="text-[12px] text-fg-primary">{x}</span>
              <ChevronRight className="w-4 h-4 text-fg-muted" />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function MobileHelp() {
  const [query, setQuery] = useState('')

  return (
    <div className="space-y-4 pb-4">
      <header className="sticky top-0 z-30 bg-surface-base/95 backdrop-blur-xl border-b border-line-subtle pt-safe pb-2 px-1">
        <h1 className="text-xl font-semibold text-fg-primary">Help Center</h1>
        <p className="text-[11px] text-fg-secondary">Find answers fast.</p>
      </header>

      <section className="px-1">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-fg-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search for help..."
            className="w-full h-10 rounded-full bg-surface-raised border border-line-subtle pl-9 pr-3 text-[13px] text-fg-primary placeholder:text-fg-muted focus:outline-none focus:ring-1 focus:ring-[#00D9FF]/60"
          />
        </div>
      </section>

      <section className="px-1 grid grid-cols-3 gap-2">
        <a
          className="rounded-2xl bg-surface-raised border border-line-subtle p-3 text-center active:scale-[0.98] transition-transform"
          href="mailto:support@quanttrade.us"
        >
          <MessageCircle className="w-5 h-5 text-[#00D9FF] mx-auto mb-1" />
          <p className="text-[11px] text-fg-primary font-semibold">Chat</p>
          <p className="text-[10px] text-fg-muted">Support</p>
        </a>
        <a
          className="rounded-2xl bg-surface-raised border border-line-subtle p-3 text-center active:scale-[0.98] transition-transform"
          href="mailto:support@quanttrade.us"
        >
          <Mail className="w-5 h-5 text-amber-400 mx-auto mb-1" />
          <p className="text-[11px] text-fg-primary font-semibold">Email</p>
          <p className="text-[10px] text-fg-muted">Support</p>
        </a>
        <Link
          className="rounded-2xl bg-surface-raised border border-line-subtle p-3 text-center active:scale-[0.98] transition-transform"
          href="/"
        >
          <ExternalLink className="w-5 h-5 text-emerald-400 mx-auto mb-1" />
          <p className="text-[11px] text-fg-primary font-semibold">Docs</p>
          <p className="text-[10px] text-fg-muted">Guides</p>
        </Link>
      </section>

      <section className="px-1 space-y-2">
        <Category
          title="Getting Started"
          icon={<Book className="w-4 h-4" />}
          items={['Creating an account', 'Understanding real-time data', 'Using Research tabs']}
        />
        <Category
          title="Trading Features"
          icon={<HelpCircle className="w-4 h-4" />}
          items={['Watchlists', 'Backtesting', 'Indicators']}
        />
        <Category
          title="Account & Billing"
          icon={<Mail className="w-4 h-4" />}
          items={['Managing subscription', 'Billing portal', 'Login troubleshooting']}
        />
      </section>

      <section className="px-1">
        <div className="rounded-2xl bg-gradient-to-br from-[#00D9FF]/15 via-surface-base to-surface-overlay border border-[#00D9FF]/30 p-4">
          <h3 className="text-[14px] font-semibold text-fg-primary">Still need help?</h3>
          <p className="text-[11px] text-fg-secondary mt-1">
            Reach out and we’ll get you unstuck quickly.
          </p>
          <a
            href="mailto:support@quanttrade.us"
            className="mt-3 inline-flex items-center justify-center w-full h-11 rounded-full bg-[#00D9FF] text-[#0A0E1A] font-semibold text-[13px]"
          >
            Contact Support
          </a>
        </div>
      </section>
    </div>
  )
}


'use client'

import Link from 'next/link'
import { FileText, ChevronRight, ShieldAlert, Shield } from 'lucide-react'

const docs = [
  {
    title: 'Terms of Service',
    desc: 'Rules and conditions for using QuantTrade AI.',
    updated: 'Updated Feb 2026',
    href: '/terms#overview',
  },
  {
    title: 'Privacy Policy',
    desc: 'How we handle your data and account information.',
    updated: 'Updated Feb 2026',
    href: '/terms#privacy',
  },
  {
    title: 'Cookie Policy',
    desc: 'How cookies are used to improve the experience.',
    updated: 'Updated Feb 2026',
    href: '/terms#data',
  },
  {
    title: 'Disclaimer',
    desc: 'Trading risk warnings and limitations.',
    updated: 'Updated Feb 2026',
    href: '/terms#risk',
  },
]

export default function MobileLegal() {
  return (
    <div className="space-y-4 pb-4">
      <header className="sticky top-0 z-30 bg-surface-base/95 backdrop-blur-xl border-b border-line-subtle pt-safe pb-2 px-1">
        <h1 className="text-xl font-semibold text-fg-primary">Legal &amp; Privacy</h1>
        <p className="text-[11px] text-fg-secondary">Important disclosures and policies.</p>
      </header>

      <section className="px-1">
        <div className="rounded-2xl bg-amber-500/10 border border-amber-500/30 p-4 flex items-start gap-3">
          <ShieldAlert className="w-5 h-5 text-amber-300 mt-0.5" />
          <div>
            <h2 className="text-[13px] font-semibold text-amber-200">Important Notice</h2>
            <p className="text-[11px] text-amber-100/80 mt-1">
              Trading involves substantial risk and may result in losses. QuantTrade AI provides
              research tooling and does not provide financial advice.
            </p>
          </div>
        </div>
      </section>

      <section className="px-1 space-y-2">
        {docs.map((d) => (
          <Link
            key={d.title}
            href={d.href}
            className="rounded-2xl bg-surface-raised border border-line-subtle p-4 flex items-center justify-between active:scale-[0.98] transition-transform block"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-10 w-10 rounded-full bg-surface-base border border-line-subtle flex items-center justify-center">
                <FileText className="w-5 h-5 text-[#00D9FF]" />
              </div>
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-fg-primary">{d.title}</p>
                <p className="text-[11px] text-fg-muted line-clamp-1">{d.desc}</p>
                <p className="text-[10px] text-fg-muted mt-1">{d.updated}</p>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-fg-muted" />
          </Link>
        ))}
      </section>

      <section className="px-1">
        <div className="rounded-2xl bg-surface-raised border border-line-subtle p-4 flex items-start gap-3">
          <Shield className="w-5 h-5 text-fg-primary mt-0.5" />
          <div>
            <h3 className="text-[13px] font-semibold text-fg-primary">Questions?</h3>
            <p className="text-[11px] text-fg-secondary mt-1">
              Contact us at <span className="text-[#00D9FF]">legal@quanttrade.us</span>.
            </p>
          </div>
        </div>
      </section>
    </div>
  )
}


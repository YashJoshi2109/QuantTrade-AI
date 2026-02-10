'use client'

import { FileText, ChevronRight, ShieldAlert, Shield } from 'lucide-react'

const docs = [
  {
    title: 'Terms of Service',
    desc: 'Rules and conditions for using QuantTrade AI.',
    updated: 'Updated Feb 2026',
  },
  {
    title: 'Privacy Policy',
    desc: 'How we handle your data and account information.',
    updated: 'Updated Feb 2026',
  },
  {
    title: 'Cookie Policy',
    desc: 'How cookies are used to improve the experience.',
    updated: 'Updated Feb 2026',
  },
  {
    title: 'Disclaimer',
    desc: 'Trading risk warnings and limitations.',
    updated: 'Updated Feb 2026',
  },
]

export default function MobileLegal() {
  return (
    <div className="space-y-4 pb-4">
      <header className="sticky top-0 z-30 bg-[#0A0E1A]/95 backdrop-blur-xl border-b border-white/10 pt-safe pb-2 px-1">
        <h1 className="text-xl font-semibold text-white">Legal &amp; Privacy</h1>
        <p className="text-[11px] text-slate-400">Important disclosures and policies.</p>
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
          <div
            key={d.title}
            className="rounded-2xl bg-[#1A2332]/90 border border-white/10 p-4 flex items-center justify-between"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-10 w-10 rounded-full bg-[#0A0E1A] border border-white/10 flex items-center justify-center">
                <FileText className="w-5 h-5 text-[#00D9FF]" />
              </div>
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-white">{d.title}</p>
                <p className="text-[11px] text-slate-500 line-clamp-1">{d.desc}</p>
                <p className="text-[10px] text-slate-600 mt-1">{d.updated}</p>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-500" />
          </div>
        ))}
      </section>

      <section className="px-1">
        <div className="rounded-2xl bg-[#1A2332]/90 border border-white/10 p-4 flex items-start gap-3">
          <Shield className="w-5 h-5 text-slate-200 mt-0.5" />
          <div>
            <h3 className="text-[13px] font-semibold text-white">Questions?</h3>
            <p className="text-[11px] text-slate-400 mt-1">
              Contact us at <span className="text-[#00D9FF]">legal@quanttrade.us</span>.
            </p>
          </div>
        </div>
      </section>
    </div>
  )
}


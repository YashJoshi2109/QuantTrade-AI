'use client'

import AppLayout from '@/components/AppLayout'
import MobileLayout from '@/components/layout/MobileLayout'
import MobileLegal from '@/components/layout/MobileLegal'

function DesktopLegal() {
  return (
    <AppLayout>
      <div className="p-6">
        <div className="max-w-3xl mx-auto space-y-6">
          <h1 className="text-2xl font-bold text-white">Legal &amp; Privacy</h1>
          <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-6 space-y-4">
            <Section title="Terms of Service" href="/terms" />
            <Section title="Privacy Policy" desc="How we collect, use, and protect your data." />
            <Section title="Financial Disclaimer" desc="QuantTrade AI provides information for educational purposes only. Not financial advice. Past performance does not guarantee future results." />
            <Section title="Data Sources" desc="Market data from Yahoo Finance, Finnhub, FMP, Twelve Data, and SEC EDGAR. Data may be delayed." />
            <Section title="Cookie Policy" desc="We use essential cookies for authentication and analytics cookies (opt-in) for improving the platform." />
          </div>
          <p className="text-xs text-slate-600 text-center">QuantTrade AI &copy; {new Date().getFullYear()}</p>
        </div>
      </div>
    </AppLayout>
  )
}

function Section({ title, desc, href }: { title: string; desc?: string; href?: string }) {
  const inner = (
    <div className="py-3 border-b border-white/[0.04] last:border-0">
      <h3 className="text-sm font-medium text-white">{title}</h3>
      {desc && <p className="text-xs text-slate-500 mt-1">{desc}</p>}
    </div>
  )
  if (href) {
    return <a href={href} className="block hover:bg-white/[0.02] rounded -mx-2 px-2">{inner}</a>
  }
  return inner
}

export default function LegalPage() {
  return (
    <>
      <div className="hidden md:block">
        <DesktopLegal />
      </div>
      <div className="md:hidden">
        <MobileLayout>
          <MobileLegal />
        </MobileLayout>
      </div>
    </>
  )
}


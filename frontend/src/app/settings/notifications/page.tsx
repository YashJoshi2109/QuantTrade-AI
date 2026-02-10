'use client'

import Link from 'next/link'
import AppLayout from '@/components/AppLayout'
import MobileLayout from '@/components/layout/MobileLayout'
import { ArrowLeft, Bell } from 'lucide-react'
import { useState } from 'react'

function Toggle({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <div
      role="switch"
      tabIndex={0}
      onClick={() => onChange(!enabled)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onChange(!enabled)
        }
      }}
      className={`relative w-12 h-6 rounded-full transition-colors border ${
        enabled ? 'bg-[#00D9FF] border-[#00D9FF]' : 'bg-slate-600 border-white/10'
      }`}
      aria-checked={enabled}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
          enabled ? 'translate-x-6' : 'translate-x-0'
        }`}
      />
    </div>
  )
}

function MobileNotifications() {
  const [alerts, setAlerts] = useState({
    volatility: true,
    earnings: true,
    breaking: true,
    product: false,
  })

  return (
    <div className="space-y-4 pb-4">
      <header className="sticky top-0 z-30 bg-[#0A0E1A]/95 backdrop-blur-xl border-b border-white/10 pt-safe pb-2 px-1 flex items-center gap-2">
        <Link
          href="/settings"
          className="h-8 w-8 rounded-full bg-[#1A2332] border border-white/10 flex items-center justify-center"
        >
          <ArrowLeft className="w-4 h-4 text-slate-200" />
        </Link>
        <div className="flex items-center gap-2">
          <Bell className="w-4 h-4 text-amber-400" />
          <h1 className="text-[18px] font-semibold text-white">Notifications</h1>
        </div>
      </header>

      <section className="px-1 space-y-2">
        {[
          { id: 'volatility', label: 'Volatility alerts', desc: 'When watched symbols move rapidly' },
          { id: 'earnings', label: 'Earnings reminders', desc: 'Upcoming earnings for your watchlist' },
          { id: 'breaking', label: 'Breaking news', desc: 'Market-moving headlines and events' },
          { id: 'product', label: 'Product updates', desc: 'New features and improvements' },
        ].map((x) => (
          <div key={x.id} className="rounded-2xl bg-[#1A2332]/90 border border-white/10 p-4 flex items-center justify-between">
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-white">{x.label}</p>
              <p className="text-[11px] text-slate-500">{x.desc}</p>
            </div>
            <Toggle
              enabled={(alerts as any)[x.id]}
              onChange={(v) => setAlerts((prev) => ({ ...prev, [x.id]: v }))}
            />
          </div>
        ))}
        <p className="text-[10px] text-slate-500 px-1">
          These are local preferences for now; server-side persistence can be added next.
        </p>
      </section>
    </div>
  )
}

function DesktopNotifications() {
  return (
    <AppLayout>
      <div className="p-6">
        <div className="max-w-3xl mx-auto">
          <div className="hud-panel p-8">
            <h1 className="text-2xl font-bold text-white mb-2">Notifications</h1>
            <p className="text-slate-400">Open this page on mobile for the optimized notifications view.</p>
          </div>
        </div>
      </div>
    </AppLayout>
  )
}

export default function NotificationsPage() {
  return (
    <>
      <div className="hidden md:block">
        <DesktopNotifications />
      </div>
      <div className="md:hidden">
        <MobileLayout showNav={false}>
          <MobileNotifications />
        </MobileLayout>
      </div>
    </>
  )
}


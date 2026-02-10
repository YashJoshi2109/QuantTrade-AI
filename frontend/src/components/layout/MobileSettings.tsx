'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import {
  Bell,
  ChevronRight,
  CreditCard,
  HelpCircle,
  LogIn,
  LogOut,
  Moon,
  Shield,
  User,
  Settings as SettingsIcon,
  Sparkles,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { createBillingPortalSession } from '@/lib/api'

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

function Row({
  icon,
  title,
  subtitle,
  href,
  right,
  danger,
  onClick,
}: {
  icon: React.ReactNode
  title: string
  subtitle?: string
  href?: string
  right?: React.ReactNode
  danger?: boolean
  onClick?: () => void
}) {
  const content = (
    <div
      className={`w-full flex items-center justify-between rounded-2xl bg-[#1A2332]/90 border border-white/10 p-3 active:scale-[0.99] transition-transform ${
        danger ? 'border-red-500/30 bg-red-500/5' : ''
      }`}
    >
      <div className="flex items-center gap-3">
        <div
          className={`h-9 w-9 rounded-full flex items-center justify-center ${
            danger ? 'bg-red-500/20 text-red-300' : 'bg-[#0A0E1A] border border-white/10 text-slate-200'
          }`}
        >
          {icon}
        </div>
        <div className="min-w-0">
          <p className={`text-[13px] font-semibold ${danger ? 'text-red-300' : 'text-white'}`}>
            {title}
          </p>
          {subtitle && <p className="text-[11px] text-slate-500 truncate">{subtitle}</p>}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {right}
        {!right && !danger && <ChevronRight className="w-4 h-4 text-slate-500" />}
      </div>
    </div>
  )

  if (href) {
    return <Link href={href}>{content}</Link>
  }
  return (
    <button type="button" onClick={onClick} className="w-full text-left">
      {content}
    </button>
  )
}

export default function MobileSettings() {
  const { user, isAuthenticated, isLoading, logout } = useAuth()
  const displayName = useMemo(() => user?.full_name || user?.username || 'Trader', [user])

  const [darkMode, setDarkMode] = useState(true)
  const [notifEnabled, setNotifEnabled] = useState(true)
  const [billingLoading, setBillingLoading] = useState(false)
  const [billingError, setBillingError] = useState<string | null>(null)

  const openBillingPortal = async () => {
    setBillingError(null)
    setBillingLoading(true)
    try {
      const { url } = await createBillingPortalSession()
      window.location.href = url
    } catch (err) {
      setBillingError(err instanceof Error ? err.message : 'Unable to open billing portal')
    } finally {
      setBillingLoading(false)
    }
  }

  if (!isLoading && !isAuthenticated) {
    return (
      <div className="space-y-4">
        <header className="sticky top-0 z-30 bg-[#0A0E1A]/95 backdrop-blur-xl border-b border-white/10 pt-safe pb-2 px-1">
          <h1 className="text-xl font-semibold text-white">Settings</h1>
          <p className="text-[11px] text-slate-400">Account + preferences</p>
        </header>
        <div className="rounded-2xl bg-[#1A2332]/90 border border-white/10 p-5 text-center">
          <LogIn className="w-10 h-10 text-[#00D9FF] mx-auto mb-3" />
          <h2 className="text-[15px] font-semibold text-white">Sign in required</h2>
          <p className="text-[11px] text-slate-400 mt-1">
            Log in to manage your account, billing, and preferences.
          </p>
          <Link
            href="/auth"
            className="inline-flex items-center justify-center mt-4 w-full h-11 rounded-full bg-[#00D9FF] text-[#0A0E1A] font-semibold text-[13px]"
          >
            Sign In / Register
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4 pb-4">
      <header className="sticky top-0 z-30 bg-[#0A0E1A]/95 backdrop-blur-xl border-b border-white/10 pt-safe pb-2 px-1">
        <h1 className="text-xl font-semibold text-white">Settings</h1>
        <p className="text-[11px] text-slate-400">Hi, {displayName}</p>
      </header>

      {billingError && (
        <section className="px-1">
          <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-[11px] text-amber-200">
            {billingError}
          </div>
        </section>
      )}

      <section className="px-1 space-y-2">
        <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500 font-semibold px-1">
          Account
        </p>
        <Row
          icon={<User className="w-4 h-4" />}
          title="Profile Settings"
          subtitle="Edit profile, email, and security"
          href="/settings/profile"
        />
        <Row
          icon={<CreditCard className="w-4 h-4" />}
          title={billingLoading ? 'Opening billing…' : 'Subscription'}
          subtitle="Manage plan and payment method"
          right={
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#00D9FF]/10 text-[#00D9FF] border border-[#00D9FF]/30">
              Pro
            </span>
          }
          onClick={openBillingPortal}
        />
      </section>

      <section className="px-1 space-y-2">
        <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500 font-semibold px-1">
          Preferences
        </p>
        <Row
          icon={<Moon className="w-4 h-4" />}
          title="Dark Mode"
          subtitle="Optimized for trading"
          right={<Toggle enabled={darkMode} onChange={setDarkMode} />}
          onClick={() => setDarkMode(!darkMode)}
        />
        <Row
          icon={<Bell className="w-4 h-4" />}
          title="Notifications"
          subtitle="Signals, alerts and updates"
          right={<Toggle enabled={notifEnabled} onChange={setNotifEnabled} />}
          onClick={() => setNotifEnabled(!notifEnabled)}
        />
        <Row
          icon={<Sparkles className="w-4 h-4" />}
          title="Appearance"
          subtitle="Glass + motion + density"
          href="/settings"
        />
      </section>

      <section className="px-1 space-y-2">
        <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500 font-semibold px-1">
          Data &amp; Privacy
        </p>
        <Row
          icon={<Shield className="w-4 h-4" />}
          title="Privacy & Security"
          subtitle="Review policies and protections"
          href="/legal"
        />
      </section>

      <section className="px-1 space-y-2">
        <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500 font-semibold px-1">
          Support
        </p>
        <Row
          icon={<HelpCircle className="w-4 h-4" />}
          title="Help Center"
          subtitle="FAQs and troubleshooting"
          href="/help"
        />
        <Row
          icon={<SettingsIcon className="w-4 h-4" />}
          title="Advanced Settings"
          subtitle="Desktop-only power tools"
          href="/settings"
        />
      </section>

      <section className="px-1 space-y-2">
        <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500 font-semibold px-1">
          Account Actions
        </p>
        <Row
          icon={<LogOut className="w-4 h-4" />}
          title="Sign Out"
          subtitle="Log out from this device"
          danger
          onClick={async () => {
            await logout()
          }}
        />
      </section>
    </div>
  )
}


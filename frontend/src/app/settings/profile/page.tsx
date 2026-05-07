'use client'

import Link from 'next/link'
import AppLayout from '@/components/AppLayout'
import MobileLayout from '@/components/layout/MobileLayout'
import { useAuth } from '@/contexts/AuthContext'
import { ArrowLeft, User } from 'lucide-react'

function MobileProfile() {
  const { user, neonUser, isAuthenticated, isLoading } = useAuth()
  const displayName = user?.full_name || user?.username || neonUser?.name || 'Trader'
  const email = user?.email || neonUser?.email || '—'

  if (!isLoading && !isAuthenticated) {
    return (
      <div className="space-y-4">
        <header className="sticky top-0 z-30 bg-surface-base/95 backdrop-blur-xl border-b border-line-subtle pt-safe pb-2 px-1 flex items-center gap-2">
          <Link
            href="/settings"
            className="h-8 w-8 rounded-full bg-surface-raised border border-line-subtle flex items-center justify-center"
          >
            <ArrowLeft className="w-4 h-4 text-fg-primary" />
          </Link>
          <h1 className="text-[18px] font-semibold text-fg-primary">Profile</h1>
        </header>
        <div className="rounded-2xl bg-surface-raised border border-line-subtle p-5 text-center">
          <p className="text-[13px] text-fg-primary">Sign in to view your profile.</p>
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
      <header className="sticky top-0 z-30 bg-surface-base/95 backdrop-blur-xl border-b border-line-subtle pt-safe pb-2 px-1 flex items-center gap-2">
        <Link
          href="/settings"
          className="h-8 w-8 rounded-full bg-surface-raised border border-line-subtle flex items-center justify-center"
        >
          <ArrowLeft className="w-4 h-4 text-fg-primary" />
        </Link>
        <h1 className="text-[18px] font-semibold text-fg-primary">Profile</h1>
      </header>

      <section className="px-1">
        <div className="rounded-2xl bg-surface-raised border border-line-subtle p-4 flex items-center gap-3">
          <div className="h-12 w-12 rounded-2xl bg-surface-base border border-line-subtle flex items-center justify-center">
            <User className="w-6 h-6 text-[#00D9FF]" />
          </div>
          <div className="min-w-0">
            <p className="text-[15px] font-semibold text-fg-primary truncate">{displayName}</p>
            <p className="text-[11px] text-fg-muted truncate">{email}</p>
          </div>
        </div>
      </section>

      <section className="px-1">
        <div className="rounded-2xl bg-surface-raised border border-line-subtle p-4">
          <p className="text-[11px] text-fg-muted">
            Profile editing on mobile is coming next. For now, manage your account from the main Settings page.
          </p>
        </div>
      </section>
    </div>
  )
}

function DesktopProfile() {
  const { user, neonUser, isAuthenticated, isLoading } = useAuth()
  const displayName = user?.full_name || user?.username || neonUser?.name || 'Trader'
  const email = user?.email || neonUser?.email || '—'
  const username = user?.username || ''

  if (!isLoading && !isAuthenticated) {
    return (
      <AppLayout>
        <div className="p-8">
          <div className="max-w-2xl mx-auto">
            <div className="hud-panel p-8 text-center">
              <p className="text-fg-muted">Sign in to view your profile.</p>
              <Link href="/auth" className="inline-flex items-center justify-center mt-4 px-6 py-2.5 rounded-full bg-[#00D9FF] text-[#0A0E1A] font-semibold text-sm">
                Sign In
              </Link>
            </div>
          </div>
        </div>
      </AppLayout>
    )
  }

  return (
    <AppLayout>
      <div className="p-8">
        <div className="max-w-2xl mx-auto space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-fg-primary">Profile</h1>
            <p className="text-sm text-fg-muted mt-1">Manage your public profile and account details.</p>
          </div>

          {/* Avatar + name card */}
          <div className="hud-panel p-6 flex items-center gap-5">
            <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-[#00D9FF]/20 to-[#7B61FF]/20 border border-line-subtle flex items-center justify-center shrink-0">
              <User className="w-8 h-8 text-[#00D9FF]" />
            </div>
            <div className="min-w-0">
              <p className="text-xl font-bold text-fg-primary truncate">{displayName}</p>
              <p className="text-sm text-fg-muted truncate">{email}</p>
              {username && (
                <Link href={`/community/user/${username}`} className="text-xs text-[#00D9FF] hover:underline mt-1 inline-block">
                  View public profile →
                </Link>
              )}
            </div>
          </div>

          {/* Account details */}
          <div className="hud-panel divide-y divide-line-subtle">
            <div className="p-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-fg-primary">Display name</p>
                <p className="text-sm text-fg-muted">{displayName}</p>
              </div>
            </div>
            <div className="p-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-fg-primary">Email</p>
                <p className="text-sm text-fg-muted">{email}</p>
              </div>
            </div>
            {username && (
              <div className="p-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-fg-primary">Username</p>
                  <p className="text-sm text-fg-muted">@{username}</p>
                </div>
              </div>
            )}
          </div>

          {/* Settings links */}
          <div className="hud-panel divide-y divide-line-subtle">
            <Link href="/settings/security" className="p-4 flex items-center justify-between hover:bg-surface-hover transition-colors group">
              <p className="text-sm font-semibold text-fg-primary group-hover:text-[#00D9FF] transition-colors">Security &amp; Password</p>
              <ArrowLeft className="w-4 h-4 text-fg-muted rotate-180" />
            </Link>
            <Link href="/settings/notifications" className="p-4 flex items-center justify-between hover:bg-surface-hover transition-colors group">
              <p className="text-sm font-semibold text-fg-primary group-hover:text-[#00D9FF] transition-colors">Notification Preferences</p>
              <ArrowLeft className="w-4 h-4 text-fg-muted rotate-180" />
            </Link>
            <Link href="/settings" className="p-4 flex items-center justify-between hover:bg-surface-hover transition-colors group">
              <p className="text-sm font-semibold text-fg-primary group-hover:text-[#00D9FF] transition-colors">Account Settings</p>
              <ArrowLeft className="w-4 h-4 text-fg-muted rotate-180" />
            </Link>
          </div>
        </div>
      </div>
    </AppLayout>
  )
}

export default function ProfilePage() {
  return (
    <>
      <div className="hidden md:block">
        <DesktopProfile />
      </div>
      <div className="md:hidden">
        <MobileLayout showNav={false}>
          <MobileProfile />
        </MobileLayout>
      </div>
    </>
  )
}


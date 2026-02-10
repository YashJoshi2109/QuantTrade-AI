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
        <header className="sticky top-0 z-30 bg-[#0A0E1A]/95 backdrop-blur-xl border-b border-white/10 pt-safe pb-2 px-1 flex items-center gap-2">
          <Link
            href="/settings"
            className="h-8 w-8 rounded-full bg-[#1A2332] border border-white/10 flex items-center justify-center"
          >
            <ArrowLeft className="w-4 h-4 text-slate-200" />
          </Link>
          <h1 className="text-[18px] font-semibold text-white">Profile</h1>
        </header>
        <div className="rounded-2xl bg-[#1A2332]/90 border border-white/10 p-5 text-center">
          <p className="text-[13px] text-slate-200">Sign in to view your profile.</p>
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
      <header className="sticky top-0 z-30 bg-[#0A0E1A]/95 backdrop-blur-xl border-b border-white/10 pt-safe pb-2 px-1 flex items-center gap-2">
        <Link
          href="/settings"
          className="h-8 w-8 rounded-full bg-[#1A2332] border border-white/10 flex items-center justify-center"
        >
          <ArrowLeft className="w-4 h-4 text-slate-200" />
        </Link>
        <h1 className="text-[18px] font-semibold text-white">Profile</h1>
      </header>

      <section className="px-1">
        <div className="rounded-2xl bg-[#1A2332]/90 border border-white/10 p-4 flex items-center gap-3">
          <div className="h-12 w-12 rounded-2xl bg-[#0A0E1A] border border-white/10 flex items-center justify-center">
            <User className="w-6 h-6 text-[#00D9FF]" />
          </div>
          <div className="min-w-0">
            <p className="text-[15px] font-semibold text-white truncate">{displayName}</p>
            <p className="text-[11px] text-slate-500 truncate">{email}</p>
          </div>
        </div>
      </section>

      <section className="px-1">
        <div className="rounded-2xl bg-[#1A2332]/90 border border-white/10 p-4">
          <p className="text-[11px] text-slate-400">
            Profile editing on mobile is coming next. For now, manage your account from the main Settings page.
          </p>
        </div>
      </section>
    </div>
  )
}

function DesktopProfile() {
  return (
    <AppLayout>
      <div className="p-6">
        <div className="max-w-3xl mx-auto">
          <div className="hud-panel p-8">
            <h1 className="text-2xl font-bold text-white mb-2">Profile</h1>
            <p className="text-slate-400">Open this page on mobile for the optimized profile view.</p>
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


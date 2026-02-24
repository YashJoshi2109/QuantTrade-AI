'use client'

import AppLayout from '@/components/AppLayout'
import MobileLayout from '@/components/layout/MobileLayout'
import Link from 'next/link'

function MonitorDesktop() {
  return (
    <AppLayout>
      <div className="min-h-full flex items-center justify-center">
        <div className="hud-panel max-w-xl w-full py-8 px-6 sm:px-8 text-center flex flex-col items-center gap-4">
          <div className="inline-flex items-center justify-center rounded-2xl bg-slate-900/80 border border-sky-500/30 px-4 py-2 text-xs font-mono text-sky-300 gap-2">
            <span className="px-2 py-1 rounded-lg bg-sky-500/10 text-sky-400 border border-sky-500/40">
              404
            </span>
            Global Monitor under construction
          </div>
          <h1 className="text-xl sm:text-2xl font-semibold text-slate-50">
            The full-screen macro globe is almost ready.
          </h1>
          <p className="text-sm text-slate-400 max-w-md">
            You can already use the mini snapshot on the dashboard. The dedicated
            Global Monitor page will ship in a future release.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 mt-2">
            <Link
              href="/"
              className="rounded-2xl bg-sky-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:brightness-110 active:scale-95 transition-all"
            >
              Back to dashboard
            </Link>
          </div>
        </div>
      </div>
    </AppLayout>
  )
}

function MonitorMobile() {
  return (
    <MobileLayout>
      <div className="min-h-[70vh] flex items-center justify-center">
        <div className="hud-panel w-full py-8 px-5 text-center flex flex-col items-center gap-4">
          <div className="inline-flex items-center justify-center rounded-2xl bg-slate-900/80 border border-sky-500/30 px-4 py-2 text-xs font-mono text-sky-300 gap-2">
            <span className="px-2 py-1 rounded-lg bg-sky-500/10 text-sky-400 border border-sky-500/40">
              404
            </span>
            Global Monitor under construction
          </div>
          <h1 className="text-lg font-semibold text-slate-50">
            Macro globe view is coming soon.
          </h1>
          <p className="text-[13px] text-slate-400">
            For now, use the snapshot on the home screen for a quick macro picture.
          </p>
          <Link
            href="/"
            className="mt-2 rounded-2xl bg-sky-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:brightness-110 active:scale-95 transition-all"
          >
            Back to dashboard
          </Link>
        </div>
      </div>
    </MobileLayout>
  )
}

export default function MonitorPage() {
  return (
    <>
      <div className="hidden md:block">
        <MonitorDesktop />
      </div>
      <div className="md:hidden">
        <MonitorMobile />
      </div>
    </>
  )
}


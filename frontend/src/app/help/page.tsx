'use client'

import Link from 'next/link'
import AppLayout from '@/components/AppLayout'
import MobileLayout from '@/components/layout/MobileLayout'
import MobileHelp from '@/components/layout/MobileHelp'

function DesktopHelp() {
  return (
    <AppLayout>
      <div className="p-6">
        <div className="max-w-3xl mx-auto">
          <div className="hud-panel p-8">
            <h1 className="text-2xl font-bold text-white mb-2">Help Center</h1>
            <p className="text-fg-muted">
              The help center is optimized for mobile right now. Use the mobile view or check the docs folder in this repo.
            </p>
            <ul className="mt-4 space-y-2 text-sm text-fg-muted">
              <li>
                <Link href="/methodology" className="text-cyan-500 hover:underline">Methodology</Link>: how quotes,
                fundamentals, valuations, backtests and forecasts are produced, and their limits.
              </li>
              <li>
                <Link href="/glossary" className="text-cyan-500 hover:underline">Glossary</Link>: plain-English
                definitions of the metrics used across the app.
              </li>
            </ul>
          </div>
        </div>
      </div>
    </AppLayout>
  )
}

export default function HelpPage() {
  return (
    <>
      <div className="hidden md:block">
        <DesktopHelp />
      </div>
      <div className="md:hidden">
        <MobileLayout>
          <MobileHelp />
        </MobileLayout>
      </div>
    </>
  )
}


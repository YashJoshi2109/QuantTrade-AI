'use client'

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
            <p className="text-slate-400">
              The help center is optimized for mobile right now. Use the mobile view or check the docs folder in this repo.
            </p>
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


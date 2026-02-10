'use client'

import AppLayout from '@/components/AppLayout'
import MobileLayout from '@/components/layout/MobileLayout'
import MobileLegal from '@/components/layout/MobileLegal'

function DesktopLegal() {
  return (
    <AppLayout>
      <div className="p-6">
        <div className="max-w-3xl mx-auto">
          <div className="hud-panel p-8">
            <h1 className="text-2xl font-bold text-white mb-2">Legal &amp; Privacy</h1>
            <p className="text-slate-400">
              This page is primarily designed for mobile. Policies and disclosures are shown in the mobile view.
            </p>
          </div>
        </div>
      </div>
    </AppLayout>
  )
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


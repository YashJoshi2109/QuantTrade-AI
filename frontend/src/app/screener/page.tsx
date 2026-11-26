'use client'

import { Suspense } from 'react'
import MobileLayout from '@/components/layout/MobileLayout'
import ScreenerDesktop from '@/components/screener/ScreenerDesktop'
import ScreenerMobile from '@/components/screener/ScreenerMobile'

// The screen lives in the URL (useSearchParams), which needs a Suspense boundary.
export default function ScreenerPage() {
  return (
    <Suspense fallback={null}>
      <div className="hidden md:block">
        <ScreenerDesktop />
      </div>
      <div className="md:hidden">
        <MobileLayout>
          <ScreenerMobile />
        </MobileLayout>
      </div>
    </Suspense>
  )
}

'use client'

import MobileLayout from '@/components/layout/MobileLayout'
import EarningsDesktop from '@/components/earnings/EarningsDesktop'
import EarningsMobile from '@/components/earnings/EarningsMobile'

export default function EarningsPage() {
  return (
    <>
      <div className="hidden md:block">
        <EarningsDesktop />
      </div>
      <div className="md:hidden">
        <MobileLayout>
          <EarningsMobile />
        </MobileLayout>
      </div>
    </>
  )
}

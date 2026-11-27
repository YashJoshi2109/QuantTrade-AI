'use client'

import MobileLayout from '@/components/layout/MobileLayout'
import DividendsDesktop from '@/components/dividends/DividendsDesktop'
import DividendsMobile from '@/components/dividends/DividendsMobile'

export default function DividendsPage() {
  return (
    <>
      <div className="hidden md:block">
        <DividendsDesktop />
      </div>
      <div className="md:hidden">
        <MobileLayout>
          <DividendsMobile />
        </MobileLayout>
      </div>
    </>
  )
}

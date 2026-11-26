'use client'

import MobileLayout from '@/components/layout/MobileLayout'
import PortfolioDesktop from '@/components/portfolio/PortfolioDesktop'
import PortfolioMobile from '@/components/portfolio/PortfolioMobile'

export default function PortfolioPage() {
  return (
    <>
      <div className="hidden md:block">
        <PortfolioDesktop />
      </div>
      <div className="md:hidden">
        <MobileLayout>
          <PortfolioMobile />
        </MobileLayout>
      </div>
    </>
  )
}

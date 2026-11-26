'use client'

import MobileLayout from '@/components/layout/MobileLayout'
import AlertsDesktop from '@/components/alerts/AlertsDesktop'
import AlertsMobile from '@/components/alerts/AlertsMobile'

export default function AlertsPage() {
  return (
    <>
      <div className="hidden md:block">
        <AlertsDesktop />
      </div>
      <div className="md:hidden">
        <MobileLayout>
          <AlertsMobile />
        </MobileLayout>
      </div>
    </>
  )
}

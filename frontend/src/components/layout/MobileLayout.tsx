'use client'

import { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import BottomNav from './BottomNav'
import SiteFooter from '../SiteFooter'
import SystemStatusPill from '../status/SystemStatusPill'

interface MobileLayoutProps {
  children: ReactNode
  className?: string
  showNav?: boolean
}

export default function MobileLayout({
  children,
  className = '',
  showNav = true,
}: MobileLayoutProps) {
  return (
    <div className="md:hidden min-h-screen bg-surface-base text-fg-primary flex flex-col pb-28 pb-safe">
      {/* Top bar: live system status (opens a bottom sheet) */}
      <div className="pt-safe">
        <div className="flex items-center justify-end px-4 pt-2">
          <SystemStatusPill />
        </div>
      </div>
      <main data-main-content="" tabIndex={-1} className={cn('flex-1 px-4 pb-4 focus:outline-none', className)}>
        {children}
        <SiteFooter />
      </main>
      {showNav && <BottomNav />}
    </div>
  )
}


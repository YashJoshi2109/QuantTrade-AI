'use client'

import { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import BottomNav from './BottomNav'
import SiteFooter from '../SiteFooter'

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
      <main data-main-content="" tabIndex={-1} className={cn('flex-1 px-4 pt-safe pb-4 focus:outline-none', className)}>
        {children}
        <SiteFooter />
      </main>
      {showNav && <BottomNav />}
    </div>
  )
}


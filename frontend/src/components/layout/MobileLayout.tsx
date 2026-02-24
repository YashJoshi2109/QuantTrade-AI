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
    <div className="md:hidden min-h-screen bg-[#0A0E1A] text-white flex flex-col pb-28 pb-safe">
      <main className={cn('flex-1 px-4 pt-safe pb-4', className)}>
        {children}
        <SiteFooter />
      </main>
      {showNav && <BottomNav />}
    </div>
  )
}


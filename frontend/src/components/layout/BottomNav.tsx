'use client'

import { useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import {
  Activity,
  LayoutDashboard,
  MoreHorizontal,
  Search,
  TrendingUp,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import MoreMenu from './MoreMenu'

interface NavItem {
  label: string
  icon: React.ReactNode
  href: string
  match: (pathname: string) => boolean
  isMore?: boolean
}

const MORE_PATHS = [
  '/watchlist',
  '/ideas-lab',
  '/pricing',
  '/settings',
  '/settings/profile',
  '/settings/notifications',
  '/help',
  '/legal',
]

const navItems: NavItem[] = [
  {
    label: 'Home',
    icon: <LayoutDashboard className="w-5 h-5" />,
    href: '/',
    match: (pathname) => pathname === '/',
  },
  {
    label: 'Markets',
    icon: <TrendingUp className="w-5 h-5" />,
    href: '/markets',
    match: (pathname) => pathname.startsWith('/markets'),
  },
  {
    label: 'Research',
    icon: <Search className="w-5 h-5" />,
    href: '/research?symbol=NVDA',
    match: (pathname) => pathname.startsWith('/research'),
  },
  {
    label: 'Backtest',
    icon: <Activity className="w-5 h-5" />,
    href: '/backtest',
    match: (pathname) => pathname.startsWith('/backtest'),
  },
  {
    label: 'More',
    icon: <MoreHorizontal className="w-5 h-5" />,
    href: '#more',
    isMore: true,
    match: (pathname) => MORE_PATHS.some((p) => pathname.startsWith(p)),
  },
]

export default function BottomNav() {
  const pathname = usePathname()
  const router = useRouter()
  const [isMoreOpen, setIsMoreOpen] = useState(false)

  return (
    <>
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 pb-safe">
        <div className="mx-auto max-w-md px-3">
          <div className="flex items-center justify-between rounded-3xl border border-white/10 bg-[#0A0E1A]/95 backdrop-blur-xl shadow-[0_10px_40px_rgba(0,0,0,0.6)] py-1">
            {navItems.map((item) => {
              const isActive = item.match(pathname)

              const handleClick = () => {
                if (item.isMore) {
                  setIsMoreOpen(true)
                  return
                }
                router.push(item.href)
              }

              return (
                <button
                  key={item.label}
                  type="button"
                  onClick={handleClick}
                  className={cn(
                    'flex flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] font-medium transition-all',
                    isActive ? 'text-[#00D9FF]' : 'text-slate-400'
                  )}
                >
                  <span
                    className={cn(
                      'flex h-8 w-8 items-center justify-center rounded-2xl',
                      isActive
                        ? 'bg-[#00D9FF]/15 text-[#00D9FF] shadow-[0_0_18px_rgba(0,217,255,0.45)]'
                        : 'bg-transparent'
                    )}
                  >
                    {item.icon}
                  </span>
                  <span className={cn('mt-0.5', isActive && 'font-semibold')}>{item.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      </nav>

      <MoreMenu open={isMoreOpen} onClose={() => setIsMoreOpen(false)} />
    </>
  )
}


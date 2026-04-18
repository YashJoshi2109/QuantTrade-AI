'use client'

import { useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import {
  Activity,
  Brain,
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
  isCopilot?: boolean
}

const MORE_PATHS = [
  '/watchlist',
  '/ideas-lab',
  '/pricing',
  '/about',
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
    label: 'Copilot',
    icon: <Brain className="w-5 h-5" />,
    href: '/copilot',
    isCopilot: true,
    match: (pathname) => pathname.startsWith('/copilot'),
  },
  {
    label: 'Research',
    icon: <Search className="w-5 h-5" />,
    href: '/research?symbol=NVDA',
    match: (pathname) => pathname.startsWith('/research'),
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
        <div className="mx-auto max-w-md px-3 mb-1">
          {/* Glass nav bar */}
          <div
            className={cn(
              'relative flex items-center justify-between rounded-3xl py-1.5 overflow-hidden',
              'border border-white/[0.12]',
              'bg-[#0A0E1A]/80 dark:bg-[#0A0E1A]/80',
              'shadow-[0_10px_40px_rgba(0,0,0,0.5)]'
            )}
            style={{
              backdropFilter: 'blur(24px) saturate(1.8)',
              WebkitBackdropFilter: 'blur(24px) saturate(1.8)',
            }}
          >
            {/* Glass shine layers */}
            <div
              className="absolute inset-0 z-0 rounded-3xl pointer-events-none"
              style={{
                boxShadow:
                  'inset 0 1px 0 rgba(255,255,255,0.12), inset 1px 0 0 rgba(255,255,255,0.06)',
              }}
            />
            <div
              className="absolute inset-0 z-0 rounded-3xl pointer-events-none"
              style={{
                background:
                  'linear-gradient(180deg, rgba(255,255,255,0.06) 0%, transparent 40%)',
              }}
            />

            {navItems.map((item) => {
              const isActive = item.match(pathname)

              const handleClick = () => {
                if (item.isMore) {
                  setIsMoreOpen(true)
                  return
                }
                router.push(item.href)
              }

              // Copilot center button — elevated design
              if (item.isCopilot) {
                return (
                  <button
                    key={item.label}
                    type="button"
                    onClick={handleClick}
                    className="relative flex flex-col items-center justify-center -mt-5 z-10"
                  >
                    <motion.div
                      whileTap={{ scale: 0.9 }}
                      className={cn(
                        'w-12 h-12 rounded-2xl flex items-center justify-center border transition-all duration-300',
                        isActive
                          ? 'bg-gradient-to-br from-[#007AFF] to-[#00D9FF] border-[#00D9FF]/50 shadow-[0_0_24px_rgba(0,217,255,0.5),0_4px_16px_rgba(0,122,255,0.3)]'
                          : 'bg-[#0A0E1A]/90 border-white/[0.15] shadow-[0_4px_20px_rgba(0,0,0,0.4)]'
                      )}
                      style={{
                        backdropFilter: 'blur(20px)',
                      }}
                    >
                      <Brain
                        className={cn(
                          'w-5 h-5 transition-colors',
                          isActive ? 'text-white' : 'text-[#00D9FF]'
                        )}
                      />
                    </motion.div>
                    <span
                      className={cn(
                        'text-[9px] mt-0.5 font-semibold transition-colors',
                        isActive ? 'text-[#00D9FF]' : 'text-slate-400'
                      )}
                    >
                      {item.label}
                    </span>
                  </button>
                )
              }

              return (
                <button
                  key={item.label}
                  type="button"
                  onClick={handleClick}
                  className={cn(
                    'relative flex flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] font-medium transition-all z-10',
                    isActive ? 'text-[#00D9FF]' : 'text-slate-400'
                  )}
                >
                  <span
                    className={cn(
                      'flex h-8 w-8 items-center justify-center rounded-2xl transition-all duration-300',
                      isActive
                        ? 'bg-[#00D9FF]/15 text-[#00D9FF] shadow-[0_0_18px_rgba(0,217,255,0.35)]'
                        : 'bg-transparent'
                    )}
                  >
                    {item.icon}
                  </span>
                  <span className={cn('mt-0.5', isActive && 'font-semibold')}>
                    {item.label}
                  </span>
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

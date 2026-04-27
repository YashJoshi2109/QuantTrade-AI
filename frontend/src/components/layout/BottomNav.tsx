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
import ThemeToggle from '@/components/ui/theme-toggle'

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
  '/community',
  '/backtest',
  '/monitor',
  '/mlops',
  '/notifications',
  '/game',
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
    match: (pathname) => pathname.startsWith('/markets') || pathname.startsWith('/markets/movers'),
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
        <div className="mx-auto max-w-md px-4 mb-2">
          {/* Glass nav bar */}
          <div
            className={cn(
              'relative grid grid-cols-5 items-center rounded-[2rem] py-2 overflow-visible',
              'border border-line-subtle',
              'bg-surface-glass',
              'shadow-[0_8px_32px_rgba(0,217,255,0.05),0_10px_40px_rgba(0,0,0,0.5)]'
            )}
            style={{
              backdropFilter: 'blur(32px) saturate(2)',
              WebkitBackdropFilter: 'blur(32px) saturate(2)',
            }}
          >
            {/* Glass shine layers */}
            <div
              className="absolute inset-0 z-0 rounded-[2rem] pointer-events-none"
              style={{
                boxShadow:
                  'inset 0 1px 0 rgba(255,255,255,0.15), inset 1px 0 0 rgba(255,255,255,0.08)',
              }}
            />
            <div
              className="absolute inset-0 z-0 rounded-[2rem] pointer-events-none"
              style={{
                background:
                  'linear-gradient(180deg, rgba(255,255,255,0.08) 0%, transparent 50%)',
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
                  <div key={item.label} className="relative flex justify-center h-full items-center z-10">
                    <button
                      type="button"
                      onClick={handleClick}
                      className="absolute -top-7 flex flex-col items-center justify-center outline-none"
                    >
                      <motion.div
                        whileTap={{ scale: 0.85 }}
                        className={cn(
                          'w-14 h-14 rounded-full flex items-center justify-center border-2 transition-all duration-300',
                          isActive
                            ? 'bg-gradient-to-br from-[#007AFF] to-[#00D9FF] border-transparent shadow-[0_0_24px_rgba(0,217,255,0.5),0_4px_16px_rgba(0,122,255,0.4)]'
                            : 'bg-surface-raised border-line-subtle shadow-[0_4px_20px_rgba(0,0,0,0.6)]'
                        )}
                        style={{
                          backdropFilter: 'blur(20px)',
                        }}
                      >
                        <img 
                          src="/logo.png" 
                          alt="Copilot" 
                          className={cn(
                            'w-12 h-12 object-contain scale-[1.2] transition-all duration-300',
                            isActive ? 'brightness-[0] invert drop-shadow-[0_0_12px_rgba(255,255,255,0.8)]' : 'opacity-100 drop-shadow-md'
                          )}
                        />
                      </motion.div>
                      <span
                        className={cn(
                          'text-[9px] mt-1 font-semibold transition-colors',
                          isActive ? 'text-[#00D9FF]' : 'text-fg-secondary'
                        )}
                      >
                        {item.label}
                      </span>
                    </button>
                  </div>
                )
              }

              return (
                <button
                  key={item.label}
                  type="button"
                  onClick={handleClick}
                  className="relative flex flex-col items-center justify-center gap-0.5 py-1 text-[10px] font-medium transition-all z-10 w-full outline-none"
                >
                  <motion.div
                    whileTap={{ scale: 0.9 }}
                    className="relative flex h-8 w-8 items-center justify-center rounded-2xl"
                  >
                    {isActive && (
                      <motion.div
                        layoutId="active-nav-indicator"
                        className="absolute inset-0 bg-[#00D9FF]/15 rounded-2xl shadow-[0_0_18px_rgba(0,217,255,0.35)]"
                        transition={{ type: 'spring', bounce: 0.25, duration: 0.5 }}
                      />
                    )}
                    <span className={cn('relative z-10 transition-colors', isActive ? 'text-[#00D9FF]' : 'text-fg-secondary')}>
                      {item.icon}
                    </span>
                  </motion.div>
                  <span className={cn('mt-0.5 transition-colors', isActive ? 'text-[#00D9FF] font-semibold' : 'text-slate-400')}>
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


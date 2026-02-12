'use client'

import { useRouter } from 'next/navigation'
import {
  Bell,
  Bookmark,
  ChevronRight,
  DollarSign,
  FileText,
  HelpCircle,
  Lightbulb,
  LogOut,
  Settings,
  User,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { useEffect, useState } from 'react'
import { getSubscriptionStatus, SubscriptionStatus } from '@/lib/api'

interface MoreMenuProps {
  open: boolean
  onClose: () => void
}

interface MenuItemProps {
  icon: React.ReactNode
  title: string
  description: string
  href?: string
  badge?: string
  badgeColor?: string
  danger?: boolean
  onClick?: () => void
}

function MenuItem({
  icon,
  title,
  description,
  href,
  badge,
  badgeColor,
  danger,
  onClick,
}: MenuItemProps) {
  const router = useRouter()

  const handleClick = () => {
    if (danger && onClick) {
      onClick()
      return
    }
    if (href) {
      router.push(href)
    }
    if (onClick) {
      onClick()
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        'w-full flex items-center justify-between rounded-2xl px-3 py-3 mb-2',
        'bg-[#1A2332]/90 border border-white/5 backdrop-blur-xl',
        'active:scale-[0.97] transition-all duration-150 text-left',
        danger && 'bg-red-500/5 border-red-500/30 text-red-400'
      )}
    >
      <div className="flex items-center gap-3">
        <div
          className={cn(
            'w-9 h-9 rounded-full flex items-center justify-center',
            danger ? 'bg-red-500/20 text-red-400' : 'bg-slate-900/80 text-slate-100'
          )}
        >
          {icon}
        </div>
        <div className="flex flex-col">
          <span className={cn('text-sm font-medium', danger && 'text-red-400')}>{title}</span>
          <span className={cn('text-[11px] text-slate-400', danger && 'text-red-300/80')}>
            {description}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {badge && (
          <span
            className={cn(
              'text-[10px] px-2 py-0.5 rounded-full border border-white/10',
              badgeColor ?? 'text-cyan-300 bg-cyan-500/10 border-cyan-400/40'
            )}
          >
            {badge}
          </span>
        )}
        {!danger && <ChevronRight className="w-4 h-4 text-slate-500" />}
      </div>
    </button>
  )
}

export default function MoreMenu({ open, onClose }: MoreMenuProps) {
  const { isAuthenticated, logout } = useAuth()
  const router = useRouter()
  const [subscription, setSubscription] = useState<SubscriptionStatus | null>(null)

  useEffect(() => {
    if (!isAuthenticated) {
      setSubscription(null)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const status = await getSubscriptionStatus()
        if (!cancelled) setSubscription(status)
      } catch {
        if (!cancelled) setSubscription(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isAuthenticated])

  const hasActiveSubscription = !!subscription?.has_active

  if (!open) return null

  return (
    <div className="md:hidden fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-md rounded-t-3xl bg-[#0A0E1A]/95 border-t border-white/10 pb-safe animate-slide-in-bottom">
        <div className="flex flex-col px-4 pt-3 pb-2">
          <div className="mx-auto h-1 w-10 rounded-full bg-slate-600 mb-3" />
          <div className="flex items-center justify-between mb-2">
            <div>
              <h2 className="text-sm font-semibold tracking-wide text-slate-100">More</h2>
              <p className="text-[11px] text-slate-400">Explore tools, settings and help.</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-[#1A2332] border border-white/10 text-slate-300 active:scale-95"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="px-4 pb-3 space-y-4 max-h-[70vh] overflow-y-auto scrollbar-hide">
          {/* Trading */}
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 mb-1.5">
              Trading
            </p>
            <MenuItem
              icon={<Bookmark className="w-4 h-4 text-yellow-400" />}
              title="Watchlist"
              description="Track your favorite symbols in one place."
              href="/watchlist"
            />
            <MenuItem
              icon={<Lightbulb className="w-4 h-4 text-purple-400" />}
              title="Ideas Lab"
              description="See curated trade setups from AI."
              href="/ideas-lab"
            />
          </div>

          {/* Account */}
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 mb-1.5">
              Account
            </p>
            <MenuItem
              icon={<User className="w-4 h-4 text-blue-400" />}
              title="Profile"
              description="Manage your trading identity and profile."
              href="/settings/profile"
            />
            <MenuItem
              icon={<DollarSign className="w-4 h-4 text-green-400" />}
              title={hasActiveSubscription ? 'Subscription' : 'Pricing'}
              description={
                hasActiveSubscription
                  ? 'View your current plan and manage billing.'
                  : 'Change or upgrade your subscription.'
              }
              href={hasActiveSubscription ? '/settings' : '/pricing'}
              badge={hasActiveSubscription ? undefined : 'Pro'}
              badgeColor={
                hasActiveSubscription
                  ? undefined
                  : 'text-emerald-300 bg-emerald-500/10 border-emerald-400/40'
              }
            />
            <MenuItem
              icon={<Bell className="w-4 h-4 text-orange-400" />}
              title="Notifications"
              description="Control alerts, emails and signals."
              href="/settings/notifications"
            />
          </div>

          {/* Settings & Support */}
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 mb-1.5">
              Settings &amp; Support
            </p>
            <MenuItem
              icon={<Settings className="w-4 h-4 text-slate-300" />}
              title="Settings"
              description="Tune your workspace and preferences."
              href="/settings"
            />
            <MenuItem
              icon={<HelpCircle className="w-4 h-4 text-cyan-400" />}
              title="Help Center"
              description="FAQs, guides and troubleshooting."
              href="/help"
            />
            <MenuItem
              icon={<FileText className="w-4 h-4 text-slate-300" />}
              title="Terms & Privacy"
              description="Legal, risk disclosures and policies."
              href="/legal"
            />
          </div>

          {/* Account Actions */}
          {isAuthenticated && (
            <div className="pb-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 mb-1.5">
                Account Actions
              </p>
              <MenuItem
                icon={<LogOut className="w-4 h-4" />}
                title="Sign Out"
                description="Securely sign out from this device."
                danger
                onClick={async () => {
                  await logout()
                  onClose()
                  router.push('/auth')
                }}
              />
            </div>
          )}
        </div>

        <div className="px-4 pt-2 pb-3 border-t border-white/5 text-[10px] text-slate-500 flex items-center justify-between">
          <span>QuantTrade AI v1.0 • Next-gen trading copilot</span>
          <span>© {new Date().getFullYear()} QuantTrade Labs</span>
        </div>
      </div>
    </div>
  )
}


'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  TrendingUp,
  Bookmark,
  FileText,
  Lightbulb,
  Settings,
  User,
  Swords,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { fetchLiveVisitors } from '@/lib/monitor-extended-api'
import LiveVisitorCounter from '@/components/ui/live-visitor'
import ThemeToggle from '@/components/ui/theme-toggle'

interface SidebarProps {
  activeTab?: string
  onTabChange?: (tab: string) => void
}

export default function Sidebar({ activeTab, onTabChange }: SidebarProps) {
  const pathname = usePathname()
  const { data: gaData } = useQuery({
    queryKey: ['live-visitors'],
    queryFn: fetchLiveVisitors,
    refetchInterval: 30_000,
    staleTime: 25_000,
  })
  const menuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, href: '/' },
    { id: 'markets', label: 'Markets', icon: TrendingUp, href: '/markets' },
    { id: 'watchlist', label: 'Watchlist', icon: Bookmark, href: '/watchlist' },
    { id: 'research', label: 'Research', icon: FileText, href: '/research' },
    { id: 'ideas', label: 'Ideas Lab', icon: Lightbulb, href: '/ideas-lab' },
    { id: 'settings', label: 'Settings', icon: Settings, href: '/settings' },
  ]

  const isGameActive = pathname?.startsWith('/game')

  // Determine active tab from pathname
  const currentTab = activeTab || (pathname === '/' ? 'dashboard' : (pathname || '').slice(1))

  return (
    <aside className="w-64 bg-surface-raised border-r border-line-default flex flex-col h-full">
      {/* Logo + Live Counter */}
      <div className="p-6 border-b border-line-default space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-surface-overlay border border-cyan-500/20 flex items-center justify-center overflow-hidden">
            <img src="/logo.png" alt="QuantTrade AI" className="w-8 h-8 object-contain" />
          </div>
          <h1 className="text-xl font-bold text-blue-400">QuantTrade AI</h1>
        </div>
        <div className="flex items-center justify-between gap-2">
          <LiveVisitorCounter gaCount={gaData?.count} />
          <ThemeToggle />
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4">
        <ul className="space-y-2">
          {menuItems.map((item) => {
            const Icon = item.icon
            const isActive = currentTab === item.id || pathname === item.href
            return (
              <li key={item.id}>
                <Link
                  href={item.href}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                    isActive
                      ? 'bg-blue-600 text-fg-inverted'
                      : 'text-fg-secondary hover:bg-surface-hover hover:text-fg-primary'
                  }`}
                >
                  <Icon className="w-5 h-5" />
                  <span className="font-medium">{item.label}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      {/* QuantTrade Life — Game Entry */}
      <div className="px-4 pb-3">
        <Link
          href="/game"
          className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border transition-all group relative overflow-hidden ${
            isGameActive
              ? 'border-amber-500/40 bg-amber-500/10 text-amber-400'
              : 'border-amber-500/20 bg-amber-500/5 text-amber-500/70 hover:border-amber-500/40 hover:bg-amber-500/10 hover:text-amber-400'
          }`}
        >
          {/* Shimmer on hover */}
          <span className="absolute inset-0 bg-gradient-to-r from-transparent via-amber-500/5 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700" />
          <Swords className="w-5 h-5 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="font-bold text-sm">CoinRealm</div>
            <div className="text-xs opacity-60 truncate">Financial Sim</div>
          </div>
          <span className="text-xs px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30 font-bold shrink-0">
            ⚔️
          </span>
        </Link>
      </div>

      {/* User Profile */}
      <div className="p-4 border-t border-line-default">
        <div className="flex items-center gap-3 px-4 py-2">
          <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center">
            <User className="w-4 h-4 text-white" />
          </div>
          <div className="flex-1">
            <div className="text-sm font-medium text-fg-primary">Alex Trader</div>
            <div className="text-xs text-fg-secondary">Pro Plan</div>
          </div>
        </div>
      </div>
    </aside>
  )
}

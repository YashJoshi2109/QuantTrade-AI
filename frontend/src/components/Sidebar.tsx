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
  User
} from 'lucide-react'

interface SidebarProps {
  activeTab?: string
  onTabChange?: (tab: string) => void
}

export default function Sidebar({ activeTab, onTabChange }: SidebarProps) {
  const pathname = usePathname()
  const menuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, href: '/' },
    { id: 'markets', label: 'Markets', icon: TrendingUp, href: '/markets' },
    { id: 'watchlist', label: 'Watchlist', icon: Bookmark, href: '/watchlist' },
    { id: 'research', label: 'Research', icon: FileText, href: '/research' },
    { id: 'ideas', label: 'Ideas Lab', icon: Lightbulb, href: '/ideas-lab' },
    { id: 'settings', label: 'Settings', icon: Settings, href: '/settings' },
  ]

  // Determine active tab from pathname
  const currentTab = activeTab || (pathname === '/' ? 'dashboard' : (pathname || '').slice(1))

  return (
    <aside className="w-64 bg-[#1e222d] border-r border-gray-700 flex flex-col h-full">
      {/* Logo */}
      <div className="p-6 border-b border-gray-700">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-slate-900/60 border border-cyan-500/20 flex items-center justify-center overflow-hidden">
            <img src="/logo.png" alt="QuantTrade AI" className="w-8 h-8 object-contain" />
          </div>
          <h1 className="text-xl font-bold text-blue-400">QuantTrade AI</h1>
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
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-400 hover:bg-gray-800 hover:text-white'
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

      {/* User Profile */}
      <div className="p-4 border-t border-gray-700">
        <div className="flex items-center gap-3 px-4 py-2">
          <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center">
            <User className="w-4 h-4 text-white" />
          </div>
          <div className="flex-1">
            <div className="text-sm font-medium text-white">Alex Trader</div>
            <div className="text-xs text-gray-400">Pro Plan</div>
          </div>
        </div>
      </div>
    </aside>
  )
}

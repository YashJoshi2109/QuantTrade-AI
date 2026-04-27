'use client'

import { Search, Bell, HelpCircle } from 'lucide-react'
import { useState } from 'react'
import Link from 'next/link'
import { ThemeToggle } from '@/components/ThemeToggle'

interface HeaderProps {
  onSymbolSelect?: (symbol: string) => void
}

export default function Header({ onSymbolSelect }: HeaderProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const timeframes = ['1D', '5D', '1M', '6M', 'YTD', '1Y']
  const [selectedTimeframe, setSelectedTimeframe] = useState('1M')

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    if (searchQuery.trim() && onSymbolSelect) {
      onSymbolSelect(searchQuery.trim().toUpperCase())
    }
  }

  return (
    <header className="h-16 border-b border-line-default flex items-center justify-between px-6 bg-surface-raised shrink-0 z-20">
      <div className="flex items-center w-64">
        <Link href="/" className="text-xl font-bold text-blue-400">AI Copilot</Link>
      </div>
      <div className="flex-1 max-w-2xl px-4">
        <form onSubmit={handleSearch} className="relative group">
          <Search className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-fg-muted text-lg" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search Ticker (e.g., NVDA)..."
            className="block w-full pl-10 pr-3 py-2 border border-line-default rounded-md leading-5 bg-surface-base placeholder-fg-muted focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm transition-colors text-fg-primary"
          />
          <div className="absolute right-2 top-2 hidden group-focus-within:block text-xs text-fg-muted border border-line-default px-1 rounded">
            CMD+K
          </div>
        </form>
      </div>
      <div className="flex items-center space-x-6">
        <div className="flex space-x-1 text-xs font-medium text-fg-secondary bg-surface-base rounded p-1">
          {timeframes.map((tf) => (
            <button
              key={tf}
              onClick={() => setSelectedTimeframe(tf)}
              className={`px-2 py-1 rounded transition-colors ${
                selectedTimeframe === tf
                  ? 'bg-blue-600 text-fg-inverted'
                  : 'hover:bg-surface-hover'
              }`}
            >
              {tf}
            </button>
          ))}
        </div>
        <ThemeToggle />
        <button className="text-fg-secondary hover:text-blue-400 transition">
          <Bell className="w-5 h-5" />
        </button>
        <button className="text-fg-secondary hover:text-blue-400 transition">
          <HelpCircle className="w-5 h-5" />
        </button>
      </div>
    </header>
  )
}

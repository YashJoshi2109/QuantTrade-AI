'use client'

import { useState, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, X, Loader2 } from 'lucide-react'
import TickerLogo from '@/components/TickerLogo'
import { searchSymbols, type SearchResult } from '@/lib/api'

interface MobileSymbolSearchProps {
  value: string
  onChange: (symbol: string) => void
  onSelect?: (result: SearchResult) => void
  placeholder?: string
  className?: string
  /** If true, auto-uppercase the input */
  uppercase?: boolean
}

/**
 * Reusable mobile search bar with API-powered ticker autocomplete.
 * Shows company name, exchange, asset type, and TickerLogo per result.
 */
export default function MobileSymbolSearch({
  value,
  onChange,
  onSelect,
  placeholder = 'Search symbol or company name...',
  className = '',
  uppercase = true,
}: MobileSymbolSearchProps) {
  const [query, setQuery] = useState(value)
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Sync external value changes
  useEffect(() => {
    setQuery(value)
  }, [value])

  const { data: results = [], isLoading } = useQuery<SearchResult[]>({
    queryKey: ['symbol-search', query],
    queryFn: () => searchSymbols(query, 8),
    enabled: open && query.trim().length >= 1,
    staleTime: 30_000,
  })

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = uppercase ? e.target.value.toUpperCase() : e.target.value
    setQuery(val)
    onChange(val)
    setOpen(true)
  }

  const handleSelect = (result: SearchResult) => {
    setQuery(result.symbol)
    onChange(result.symbol)
    setOpen(false)
    onSelect?.(result)
    inputRef.current?.blur()
  }

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-fg-muted pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleInputChange}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className="w-full h-11 rounded-xl bg-surface-raised border border-line-subtle pl-9 pr-9 text-sm text-fg-primary font-mono placeholder:text-fg-muted focus:outline-none focus:ring-2 focus:ring-cyan-500/30 transition-all"
        />
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery('')
              onChange('')
              inputRef.current?.focus()
            }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-fg-muted hover:text-fg-secondary transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Autocomplete Dropdown */}
      <AnimatePresence>
        {open && query.trim().length >= 1 && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="absolute top-full left-0 right-0 mt-1 z-50 max-h-72 overflow-y-auto rounded-xl border border-line-subtle bg-surface-overlay backdrop-blur-xl shadow-theme-lg"
          >
            {isLoading ? (
              <div className="flex items-center justify-center gap-2 py-6 text-fg-muted text-sm">
                <Loader2 className="w-4 h-4 animate-spin" />
                Searching...
              </div>
            ) : results.length === 0 ? (
              <div className="py-5 text-center text-fg-muted text-xs">
                No results for &quot;{query}&quot;
              </div>
            ) : (
              results.map((result, i) => (
                <motion.button
                  key={result.symbol}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.03, duration: 0.15 }}
                  type="button"
                  onClick={() => handleSelect(result)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-surface-hover active:bg-surface-active transition-colors text-left border-b border-line-subtle last:border-0"
                >
                  <TickerLogo
                    symbol={result.symbol}
                    companyName={result.name}
                    size={32}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-bold text-fg-primary font-mono">
                        {result.symbol}
                      </span>
                      {result.exchange && (
                        <span className="text-[9px] px-1 py-0.5 rounded bg-surface-hover border border-line-subtle text-fg-muted">
                          {result.exchange}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-fg-muted truncate leading-tight">
                      {result.name}
                    </p>
                  </div>
                  {result.asset_type && (
                    <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 uppercase font-bold shrink-0">
                      {result.asset_type}
                    </span>
                  )}
                </motion.button>
              ))
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

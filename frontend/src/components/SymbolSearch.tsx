'use client'

import { useState, useEffect, useRef } from 'react'
import { Search, Loader2 } from 'lucide-react'
import { fetchSymbols, Symbol } from '@/lib/api'

interface SymbolSearchProps {
  onSymbolSelect: (symbol: string) => void
}

export default function SymbolSearch({ onSymbolSelect }: SymbolSearchProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Symbol[]>([])
  const [loading, setLoading] = useState(false)
  const [showResults, setShowResults] = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowResults(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    if (query.length >= 1) {
      const timeoutId = setTimeout(() => {
        searchSymbols(query)
      }, 300)
      return () => clearTimeout(timeoutId)
    } else {
      setResults([])
    }
  }, [query])

  const searchSymbols = async (searchQuery: string) => {
    setLoading(true)
    try {
      const symbols = await fetchSymbols(searchQuery)
      setResults(symbols)
      setShowResults(true)
    } catch (error) {
      console.error('Search error:', error)
      setResults([])
    } finally {
      setLoading(false)
    }
  }

  const handleSelect = (symbol: Symbol) => {
    setQuery(symbol.symbol)
    setShowResults(false)
    onSymbolSelect(symbol.symbol)
  }

  return (
    <div ref={searchRef} className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-fg-muted w-4 h-4" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => query.length >= 1 && setShowResults(true)}
          placeholder="Search symbols..."
          className="w-full pl-10 pr-4 py-2 bg-surface-raised border border-line-default rounded-lg text-fg-primary placeholder:text-fg-muted focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {loading && (
          <Loader2 className="absolute right-3 top-1/2 transform -translate-y-1/2 text-fg-muted w-4 h-4 animate-spin" />
        )}
      </div>

      {showResults && results.length > 0 && (
        <div className="absolute z-10 w-full mt-2 bg-surface-overlay border border-line-default rounded-lg shadow-theme-md max-h-64 overflow-y-auto">
          {results.map((symbol) => (
            <button
              key={symbol.id}
              onClick={() => handleSelect(symbol)}
              className="w-full px-4 py-2 text-left hover:bg-surface-hover transition-colors"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold text-fg-primary">{symbol.symbol}</div>
                  {symbol.name && (
                    <div className="text-sm text-fg-secondary">{symbol.name}</div>
                  )}
                </div>
                {symbol.sector && (
                  <div className="text-xs text-fg-muted">{symbol.sector}</div>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      {showResults && query.length >= 1 && !loading && results.length === 0 && (
        <div className="absolute z-10 w-full mt-2 bg-surface-overlay border border-line-default rounded-lg shadow-theme-md p-4 text-center text-fg-muted">
          No symbols found
        </div>
      )}
    </div>
  )
}

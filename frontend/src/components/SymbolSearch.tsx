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
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => query.length >= 1 && setShowResults(true)}
          placeholder="Search symbols..."
          className="w-full pl-10 pr-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {loading && (
          <Loader2 className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4 animate-spin" />
        )}
      </div>

      {showResults && results.length > 0 && (
        <div className="absolute z-10 w-full mt-2 bg-gray-800 border border-gray-700 rounded-lg shadow-lg max-h-64 overflow-y-auto">
          {results.map((symbol) => (
            <button
              key={symbol.id}
              onClick={() => handleSelect(symbol)}
              className="w-full px-4 py-2 text-left hover:bg-gray-700 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold text-white">{symbol.symbol}</div>
                  {symbol.name && (
                    <div className="text-sm text-gray-400">{symbol.name}</div>
                  )}
                </div>
                {symbol.sector && (
                  <div className="text-xs text-gray-500">{symbol.sector}</div>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      {showResults && query.length >= 1 && !loading && results.length === 0 && (
        <div className="absolute z-10 w-full mt-2 bg-gray-800 border border-gray-700 rounded-lg shadow-lg p-4 text-center text-gray-400">
          No symbols found
        </div>
      )}
    </div>
  )
}

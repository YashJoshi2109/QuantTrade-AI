'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Search, ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Ticker symbols: letters, digits, ".", "-", "^", "=" (BRK.B, ^GSPC, BTC-USD). */
export function normalizeTickerInput(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9.\-^=]/g, '').slice(0, 15)
}

/** Small "type a ticker, Enter opens Research" form (404 page, unknown ticker). */
export default function TickerJumpForm({
  className,
  autoFocus,
  placeholder = 'Find a ticker, e.g. AAPL',
  size = 'md',
}: {
  className?: string
  autoFocus?: boolean
  placeholder?: string
  size?: 'sm' | 'md'
}) {
  const router = useRouter()
  const [value, setValue] = useState('')
  const symbol = normalizeTickerInput(value)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!symbol) return
    router.push(`/research?symbol=${encodeURIComponent(symbol)}`)
  }

  return (
    <form onSubmit={submit} role="search" className={cn('relative w-full', className)}>
      <label className="sr-only" htmlFor="ticker-jump">
        Ticker symbol
      </label>
      <Search
        className={cn(
          'pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400',
          size === 'sm' ? 'h-4 w-4' : 'h-[18px] w-[18px]',
        )}
        aria-hidden
      />
      <input
        id="ticker-jump"
        value={value}
        onChange={(e) => setValue(e.target.value.toUpperCase())}
        placeholder={placeholder}
        autoFocus={autoFocus}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        maxLength={15}
        className={cn(
          'w-full rounded-xl border border-slate-200 bg-white pl-10 pr-12 font-mono uppercase tracking-wide text-slate-900 shadow-sm outline-none transition placeholder:font-sans placeholder:normal-case placeholder:tracking-normal placeholder:text-slate-400 focus:border-sky-400 focus:ring-4 focus:ring-sky-400/15',
          'dark:border-white/10 dark:bg-[#0f1520] dark:text-slate-100 dark:focus:border-sky-400/60',
          size === 'sm' ? 'h-10 text-sm' : 'h-12 text-[15px]',
        )}
      />
      <button
        type="submit"
        disabled={!symbol}
        aria-label="Open in Research"
        className={cn(
          'absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center justify-center rounded-lg bg-sky-500 text-[#fff] transition hover:bg-sky-600 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 dark:disabled:bg-white/10 dark:disabled:text-slate-500',
          size === 'sm' ? 'h-7 w-7' : 'h-9 w-9',
        )}
      >
        <ArrowRight className="h-4 w-4" aria-hidden />
      </button>
    </form>
  )
}

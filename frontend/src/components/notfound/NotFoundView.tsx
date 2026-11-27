'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { LayoutDashboard, FileText, Filter } from 'lucide-react'
import CandlestickCrash from './CandlestickCrash'
import TickerJumpForm from './TickerJumpForm'
import { POPULAR_TICKERS } from '@/lib/popularTickers'

/**
 * Full-viewport 404. Standalone (no AppLayout) so a dead link does not start
 * the layout's market polling. Pointer parallax writes two CSS variables per
 * animation frame; it is skipped entirely under prefers-reduced-motion and
 * on coarse (touch) pointers.
 */
export default function NotFoundView() {
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = rootRef.current
    if (!el || typeof window === 'undefined' || !window.matchMedia) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    if (!window.matchMedia('(pointer: fine)').matches) return
    let raf = 0
    let px = 0
    let py = 0
    const onMove = (e: PointerEvent) => {
      px = e.clientX / window.innerWidth - 0.5
      py = e.clientY / window.innerHeight - 0.5
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        el.style.setProperty('--px', px.toFixed(3))
        el.style.setProperty('--py', py.toFixed(3))
      })
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])

  const layer = (depth: number) => ({
    transform: `translate3d(calc(var(--px, 0) * ${depth}px), calc(var(--py, 0) * ${depth}px), 0)`,
  })

  return (
    <div
      ref={rootRef}
      className="relative isolate flex min-h-[100dvh] w-full flex-col overflow-hidden bg-[#f5f7fc] text-slate-900 dark:bg-[#070c18] dark:text-slate-100"
    >
      {/* Glow backdrop */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 motion-safe:transition-transform motion-safe:duration-300" style={layer(-24)}>
        <div className="absolute left-1/2 top-[18%] h-[420px] w-[min(720px,120vw)] -translate-x-1/2 rounded-full bg-sky-400/20 blur-[90px] dark:bg-sky-500/15" />
        <div className="absolute right-[8%] top-[52%] h-[260px] w-[260px] rounded-full bg-emerald-400/15 blur-[80px] dark:bg-emerald-500/10" />
        <div className="absolute left-[6%] top-[40%] h-[220px] w-[220px] rounded-full bg-rose-400/10 blur-[80px] dark:bg-rose-500/10" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(15,23,42,0.06)_1px,transparent_1px)] [background-size:22px_22px] dark:bg-[radial-gradient(circle_at_center,rgba(148,163,184,0.08)_1px,transparent_1px)]" />
      </div>

      <header className="mx-auto flex w-full max-w-5xl items-center px-4 pt-5 sm:px-6">
        <Link href="/" className="flex items-center gap-2 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400">
          <span className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-xl border border-sky-500/20 bg-white dark:bg-white/5">
            <img src="/logo.png" alt="" className="brand-logo h-7 w-7 scale-150 object-contain" />
          </span>
          <span className="bg-gradient-to-r from-blue-500 to-cyan-500 bg-clip-text text-base font-bold text-transparent">QuantTrade AI</span>
        </Link>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center px-4 py-8 sm:px-6">
        <div className="relative w-full max-w-[640px]">
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-1/2 -z-10 -translate-y-1/2 select-none text-center font-mono text-[clamp(6rem,24vw,13rem)] font-black leading-none tracking-tighter text-slate-900/[0.05] dark:text-white/[0.05]"
            style={layer(14)}
          >
            404
          </span>
          <div style={layer(6)} className="motion-safe:transition-transform motion-safe:duration-200">
            <CandlestickCrash />
          </div>
        </div>

        <div className="mt-4 flex max-w-xl flex-col items-center text-center">
          <p className="inline-flex items-center gap-2 rounded-full border border-rose-200 bg-rose-50 px-3 py-1 font-mono text-xs font-semibold text-rose-600 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
            <span className="h-1.5 w-1.5 rounded-full bg-rose-500" aria-hidden />
            Error 404 · Page not found
          </p>
          <h1 className="mt-4 text-[28px] font-bold leading-tight tracking-tight sm:text-4xl">This page went off the chart</h1>
          <p className="mt-3 text-[15px] leading-relaxed text-slate-600 dark:text-slate-400">
            The link may be old, or the page moved. Markets recover and so can your session: search a ticker or pick a destination below.
          </p>

          <TickerJumpForm className="mt-6 max-w-md" />

          <nav aria-label="Destinations" className="mt-5 flex w-full flex-wrap justify-center gap-2.5">
            <Link
              href="/"
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-slate-900 px-4 text-sm font-semibold text-[#fff] shadow-sm transition hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
            >
              <LayoutDashboard className="h-4 w-4" aria-hidden /> Dashboard
            </Link>
            <Link
              href="/research"
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 dark:border-white/10 dark:bg-[#0f1520] dark:text-slate-200 dark:hover:bg-[#141b28]"
            >
              <FileText className="h-4 w-4" aria-hidden /> Research
            </Link>
            <Link
              href="/screener"
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 dark:border-white/10 dark:bg-[#0f1520] dark:text-slate-200 dark:hover:bg-[#141b28]"
            >
              <Filter className="h-4 w-4" aria-hidden /> Screener
            </Link>
          </nav>

          <div className="mt-7 w-full">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-500">Popular tickers</p>
            <ul className="mt-2.5 flex flex-wrap justify-center gap-2">
              {POPULAR_TICKERS.map((t) => (
                <li key={t.symbol}>
                  <Link
                    href={`/research?symbol=${t.symbol}`}
                    title={t.name}
                    className="inline-flex h-8 items-center rounded-lg border border-slate-200 bg-white/80 px-3 font-mono text-xs font-semibold text-slate-700 transition hover:-translate-y-0.5 hover:border-sky-300 hover:text-sky-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 motion-reduce:hover:translate-y-0 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-300 dark:hover:border-sky-400/40 dark:hover:text-sky-300"
                  >
                    {t.symbol}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </main>

      <footer className="px-4 pb-6 text-center text-[11px] text-slate-500 dark:text-slate-500">
        Not investment advice. Chart above is an illustration, not market data.
      </footer>
    </div>
  )
}

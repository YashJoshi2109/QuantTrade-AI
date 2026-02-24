'use client'

import { useState } from 'react'
import Link from 'next/link'

export default function SiteFooter() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState<string | null>(null)

  const isValidEmail = (value: string) =>
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!isValidEmail(email)) {
      setStatus('error')
      setMessage('Please enter a valid email address.')
      return
    }

    try {
      setStatus('submitting')
      setMessage(null)

      const res = await fetch('/api/newsletter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      })

      if (!res.ok) {
        throw new Error('Request failed')
      }

      setStatus('success')
      setMessage('Subscribed. Watch your inbox for the next macro brief.')
      setEmail('')
    } catch {
      setStatus('error')
      setMessage('Something went wrong. Please try again in a moment.')
    }
  }

  return (
    <footer className="mt-10 mb-4 text-slate-300">
      {/* Outer container */}
      <div className="max-w-6xl mx-auto">
        {/* Top CTA bar */}
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-[#0B1220] via-[#020617] to-[#0B1220] border border-sky-500/20 shadow-[0_0_40px_rgba(56,189,248,0.25)] px-5 sm:px-8 py-6 sm:py-7 mb-4">
          <div className="pointer-events-none absolute -right-24 -top-24 h-48 w-48 rounded-full bg-cyan-500/30 blur-3xl" />
          <div className="pointer-events-none absolute -left-16 bottom-0 h-40 w-40 rounded-full bg-indigo-500/25 blur-3xl" />

          <div className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-5">
            <div className="space-y-1.5 max-w-md">
              <p className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-300">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Stay in the order book
              </p>
              <h3 className="text-lg sm:text-xl font-semibold text-slate-50">
                Subscribe for macro briefs and product drops.
              </h3>
              <p className="text-[12px] sm:text-[13px] text-slate-400">
                Only high-signal updates from QuantTrade AI – no spam, just edge.
              </p>
            </div>

            <div className="w-full sm:w-auto">
              <form
                className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2"
                onSubmit={handleSubmit}
              >
                <div className="flex-1 sm:w-64">
                  <div className="relative">
                    <input
                      type="email"
                      placeholder="Enter your work email"
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value)
                        if (status !== 'idle') {
                          setStatus('idle')
                          setMessage(null)
                        }
                      }}
                      className="w-full rounded-2xl bg-slate-900/70 border border-slate-600/70 px-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-400/70 focus:border-cyan-400/70 backdrop-blur"
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-mono text-slate-500">
                      ⏎
                    </span>
                  </div>
                  {message && (
                    <p
                      className={`mt-1 text-[11px] ${
                        status === 'success' ? 'text-emerald-400' : 'text-amber-400'
                      }`}
                    >
                      {message}
                    </p>
                  )}
                </div>
                <button
                  type="submit"
                  disabled={status === 'submitting'}
                  className="shrink-0 rounded-2xl bg-gradient-to-r from-sky-500 to-cyan-400 px-4 py-2.5 text-xs font-semibold text-slate-950 shadow-[0_10px_30px_rgba(56,189,248,0.45)] hover:brightness-110 active:scale-95 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {status === 'submitting' ? 'Subscribing…' : 'Join the tape'}
                </button>
              </form>
            </div>
          </div>
        </div>

        {/* Links & meta */}
        <div className="rounded-3xl bg-slate-950/60 border border-slate-800/70 backdrop-blur-xl px-5 sm:px-8 py-5">
          <div className="flex flex-col md:flex-row md:items-start gap-6 md:gap-8">
            {/* Brand */}
            <div className="md:w-1/3 space-y-2">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-2xl bg-gradient-to-br from-sky-500 via-cyan-400 to-emerald-400 p-[1px]">
                  <div className="h-full w-full rounded-2xl bg-slate-950 flex items-center justify-center text-xs font-bold text-sky-100">
                    QT
                  </div>
                </div>
                <span className="text-sm font-semibold tracking-wide text-slate-100">
                  QuantTrade AI
                </span>
              </div>
              <p className="text-[12px] text-slate-500 leading-relaxed">
                An AI focused stock radar for discretionary traders and
                systematic desks. Built for fast reads, not dashboards that fight you.
              </p>
            </div>

            {/* Link columns */}
            <div className="flex-1 grid grid-cols-3 gap-4 text-[12px]">
              <div className="space-y-1.5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                  Product
                </p>
                <ul className="space-y-1.5 text-slate-400">
                  <li>Dashboard</li>
                  <li>Markets Monitor</li>
                  <li>Ideas Lab</li>
                  <li>Backtest Engine</li>
                </ul>
              </div>
              <div className="space-y-1.5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                  Resources
                </p>
                <ul className="space-y-1.5 text-slate-400">
                  <li>Changelog</li>
                  <li>API Docs</li>
                  <li>Security</li>
                </ul>
              </div>
              <div className="space-y-1.5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                  Contact
                </p>
                <ul className="space-y-1.5 text-slate-400">
                  <li>yashjosh7486@gmail.com</li>
                  <li>Feedback & feature requests</li>
                  <li>Partnerships</li>
                </ul>
              </div>
            </div>
          </div>

          <div className="mt-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-t border-slate-800/80 pt-3">
            <p className="text-[11px] text-slate-500">
              © {new Date().getFullYear()}{' '}
              <span className="text-slate-300">QuantTrade AI</span>. All rights reserved.
              {' '}Crafted by{' '}
              <Link
                href="https://www.github.com/YashJoshi2109"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sky-400 hover:text-sky-300 underline decoration-sky-500/60 decoration-dotted"
              >
                Yash Joshi
              </Link>
              .
            </p>
            <div className="flex flex-wrap gap-3 text-[11px] text-slate-500">
              <span>Privacy</span>
              <span>Terms</span>
              <span>Risk Disclosure</span>
            </div>
          </div>
        </div>
      </div>
    </footer>
  )
}


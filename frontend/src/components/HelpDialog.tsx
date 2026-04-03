'use client'

import { useEffect, useId, useRef } from 'react'
import Link from 'next/link'
import { X, Keyboard, BookOpen, Shield, ExternalLink } from 'lucide-react'

type HelpDialogProps = {
  open: boolean
  onClose: () => void
}

export default function HelpDialog({ open, onClose }: HelpDialogProps) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    panelRef.current?.focus()
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-4 sm:p-6"
      role="presentation"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        aria-label="Close help"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative w-full max-w-lg rounded-2xl border border-slate-700/80 bg-[#0d1321]/98 shadow-2xl shadow-black/50 outline-none"
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-800/80 px-4 py-3">
          <div>
            <h2 id={titleId} className="text-sm font-bold text-white">
              Help and shortcuts
            </h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              QuantTrade AI — navigation and data notes
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:text-white hover:bg-slate-800/80 transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="max-h-[min(70vh,520px)] overflow-y-auto px-4 py-3 space-y-4 text-[12px] text-slate-300">
          <section className="space-y-2">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <Keyboard className="w-3.5 h-3.5" />
              Keyboard
            </div>
            <ul className="space-y-1.5 text-[11px]">
              <li className="flex justify-between gap-4">
                <span>Focus search (header)</span>
                <kbd className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-600 font-mono text-[10px]">
                  /
                </kbd>
              </li>
              <li className="flex justify-between gap-4">
                <span>Close dialogs / menus</span>
                <kbd className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-600 font-mono text-[10px]">
                  Esc
                </kbd>
              </li>
            </ul>
          </section>

          <section className="space-y-2">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <BookOpen className="w-3.5 h-3.5" />
              Learn more
            </div>
            <Link
              href="/help"
              onClick={onClose}
              className="flex items-center justify-between rounded-lg border border-slate-700/60 bg-slate-900/50 px-3 py-2 text-slate-200 hover:border-cyan-500/40 hover:bg-slate-800/60 transition-colors"
            >
              <span>Help center</span>
              <ExternalLink className="w-3.5 h-3.5 text-slate-500" />
            </Link>
            <Link
              href="/about"
              onClick={onClose}
              className="flex items-center justify-between rounded-lg border border-slate-700/60 bg-slate-900/50 px-3 py-2 text-slate-200 hover:border-cyan-500/40 hover:bg-slate-800/60 transition-colors"
            >
              <span>About this product</span>
              <ExternalLink className="w-3.5 h-3.5 text-slate-500" />
            </Link>
          </section>

          <section className="space-y-2">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <Shield className="w-3.5 h-3.5" />
              Data and risk
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Quotes and headlines are aggregated from third-party sources and may be delayed. Nothing
              here is investment advice.
            </p>
          </section>
        </div>

        <div className="border-t border-slate-800/80 px-4 py-2.5 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg bg-slate-800 text-xs font-medium text-white hover:bg-slate-700 transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

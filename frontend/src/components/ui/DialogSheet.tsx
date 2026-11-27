'use client'

/**
 * Modal side drawer (desktop) / bottom sheet (mobile). Shared by the Screener and the
 * Earnings / Dividends calendars. Esc closes, Tab stays inside, focus returns to the
 * opener on close; the element marked `data-autofocus` gets focus on open.
 */
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea,[tabindex]:not([tabindex="-1"])'

export function useDialogA11y(ref: RefObject<HTMLElement | null>, open: boolean, onClose: () => void) {
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    if (!open) return
    const opener = document.activeElement as HTMLElement | null
    const el = ref.current
    const first = el?.querySelector<HTMLElement>('[data-autofocus]') ?? el
    first?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeRef.current()
        return
      }
      if (e.key !== 'Tab' || !el) return
      const items = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((n) => n.offsetParent !== null)
      if (!items.length) { e.preventDefault(); return }
      const a = items[0]
      const z = items[items.length - 1]
      if (e.shiftKey && (document.activeElement === a || document.activeElement === el)) { e.preventDefault(); z.focus() }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      opener?.focus?.()
    }
  }, [open, ref])
}

export function Sheet({ open, onClose, side, label, children, panelClassName = 'bg-white dark:bg-[#0f1520]' }: {
  open: boolean
  onClose: () => void
  side: 'right' | 'bottom'
  label: string
  children: ReactNode
  /** Panel background. Must be opaque: dark-mode surface tokens are transparent. */
  panelClassName?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  useDialogA11y(ref, open && mounted, onClose)
  if (!open || !mounted) return null
  const panel =
    side === 'right'
      ? 'right-0 top-0 h-full w-[380px] max-w-[92vw] border-l'
      : 'bottom-0 left-0 max-h-[88vh] w-full rounded-t-3xl border-t'
  // The extra wrapper matters: globals.css strips backgrounds from `body > div > div`
  // (!important), which would make the backdrop and panel transparent.
  return createPortal(
    <div className="qt-sheet-root">
      <div className="fixed inset-0 z-[1000]">
        <div className={`absolute inset-0 ${side === 'right' ? 'bg-black/25' : 'bg-black/50 backdrop-blur-[2px]'}`} onMouseDown={onClose} aria-hidden />
        <div
          ref={ref}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-label={label}
          className={`absolute flex flex-col border-line-default shadow-2xl outline-none ${panelClassName} ${panel}`}
        >
          {children}
        </div>
      </div>
    </div>,
    document.body
  )
}

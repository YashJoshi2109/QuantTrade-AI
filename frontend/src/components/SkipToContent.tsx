'use client'

import type { MouseEvent } from 'react'

/**
 * Keyboard "skip to content" link (WCAG 2.4.1). Visually hidden until focused.
 *
 * Some routes (e.g. home) render the desktop and mobile shells side by side and
 * hide one with CSS, so there can be two `[data-main-content]` regions. On click
 * we move focus to the first one that is actually visible.
 */
export default function SkipToContent() {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    const regions = Array.from(document.querySelectorAll<HTMLElement>('[data-main-content], main'))
    const target = regions.find((el) => el.offsetParent !== null || el.getClientRects().length > 0)
    if (!target) return
    e.preventDefault()
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1')
    target.focus({ preventScroll: true })
    target.scrollIntoView({ block: 'start' })
  }

  return (
    <a
      href="#main-content"
      onClick={onClick}
      className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[9999] focus:rounded-lg focus:bg-surface-raised focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-fg-primary focus:outline focus:outline-2 focus:outline-sky-400"
    >
      Skip to content
    </a>
  )
}

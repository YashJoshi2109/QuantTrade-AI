import type { ReactNode } from 'react'
import { Fraunces, DM_Sans } from 'next/font/google'

const aboutDisplay = Fraunces({
  subsets: ['latin'],
  variable: '--font-about-display',
  display: 'swap',
})

const aboutBody = DM_Sans({
  subsets: ['latin'],
  variable: '--font-about-body',
  display: 'swap',
})

/**
 * Route-scoped typography (distinct from the rest of the app).
 * Aligns with frontend-design / UI craft guidance: editorial pairing, no generic stack-only body.
 */
export default function AboutLayout({ children }: { children: ReactNode }) {
  return (
    <div
      className={`${aboutDisplay.variable} ${aboutBody.variable} min-h-0 antialiased [font-family:var(--font-about-body),ui-sans-serif,system-ui,sans-serif]`}
    >
      {children}
    </div>
  )
}

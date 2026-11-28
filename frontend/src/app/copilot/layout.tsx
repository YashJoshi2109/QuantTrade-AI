import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import localFont from 'next/font/local'
import './copilot.css'
import { JsonLd } from '@/components/seo/JsonLd'
import { routeMetadata } from '@/lib/routeSeo'
import { breadcrumbSchema } from '@/lib/schema'

export const metadata: Metadata = routeMetadata('/copilot')

// Section headings and the empty-state headline: a reading serif for a research note.
const copilotSerif = localFont({
  src: '../../fonts/fraunces-latin-var.woff2',
  weight: '100 900',
  variable: '--font-cp-serif',
  display: 'swap',
})

export default function CopilotLayout({ children }: { children: ReactNode }) {
  return (
    <div className={`${copilotSerif.variable} contents`}>
      <JsonLd data={breadcrumbSchema([{ name: 'AI Copilot', path: '/copilot' }])} />
      {children}
    </div>
  )
}

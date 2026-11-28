import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { privateMetadata } from '@/lib/seo'

// Per-user or utility route: keep out of search results.
export const metadata: Metadata = privateMetadata('Billing')

export default function BillingLayout({ children }: { children: ReactNode }) {
  return <>{children}</>
}

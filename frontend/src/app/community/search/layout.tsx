import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { privateMetadata } from '@/lib/seo'

// Internal search results: keep out of search results.
export const metadata: Metadata = privateMetadata('Search Community')

export default function CommunitySearchLayout({ children }: { children: ReactNode }) {
  return <>{children}</>
}

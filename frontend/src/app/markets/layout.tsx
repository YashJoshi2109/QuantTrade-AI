import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { routeMetadata } from '@/lib/routeSeo'

// /markets/movers overrides all of this in its own layout.
export const metadata: Metadata = routeMetadata('/markets')

export default function MarketsLayout({ children }: { children: ReactNode }) {
  return <>{children}</>
}

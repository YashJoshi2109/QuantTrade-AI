import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { privateMetadata } from '@/lib/seo'
import GameShell from './GameShell'

// Every /game route requires sign-in (GameShell redirects to /auth), so
// none of it belongs in search results.
export const metadata: Metadata = privateMetadata('CoinRealm')

export default function GameLayout({ children }: { children: ReactNode }) {
  return <GameShell>{children}</GameShell>
}

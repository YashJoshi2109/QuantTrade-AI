'use client'

/**
 * Watchlist page = Kite-style Marketwatch.
 *
 * Multiple named watchlists (tabs), search-to-add, live regular-session prices
 * from the shared quote feed, hover actions (chart / research / price alert /
 * add holding), keyboard shortcuts, drag reorder, and a Holdings tab computed
 * from the user's portfolios with the Portfolio page's own P&L.
 *
 * Desktop: components/marketwatch/MarketwatchDesktop.tsx
 * Mobile:  components/layout/MobileWatchlist.tsx (same controller + lib/marketwatch)
 * API:     /api/v1/marketwatch (backend/app/api/marketwatch.py)
 */
import AppLayout from '@/components/AppLayout'
import MobileLayout from '@/components/layout/MobileLayout'
import MobileWatchlist from '@/components/layout/MobileWatchlist'
import MarketwatchDesktop from '@/components/marketwatch/MarketwatchDesktop'

export default function WatchlistPage() {
  return (
    <>
      <div className="hidden md:block">
        <AppLayout>
          <MarketwatchDesktop />
        </AppLayout>
      </div>
      <div className="md:hidden">
        <MobileLayout>
          <MobileWatchlist />
        </MobileLayout>
      </div>
    </>
  )
}

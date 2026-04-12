import { useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'

type MarketStatus = 'open' | 'extended' | 'closed'

function getMarketStatus(): MarketStatus {
  const now = new Date()
  const day = now.getDay() // 0=Sun, 6=Sat
  if (day === 0 || day === 6) return 'closed'

  // Convert to ET (UTC-4 EDT / UTC-5 EST)
  const utcH = now.getUTCHours()
  const utcM = now.getUTCMinutes()
  const etMinutes = (utcH * 60 + utcM - 240 + 1440) % 1440 // EDT offset

  const preOpen = 4 * 60    // 4:00 AM ET
  const open = 9 * 60 + 30  // 9:30 AM ET
  const close = 16 * 60     // 4:00 PM ET
  const postClose = 20 * 60 // 8:00 PM ET

  if (etMinutes >= open && etMinutes < close) return 'open'
  if ((etMinutes >= preOpen && etMinutes < open) || (etMinutes >= close && etMinutes < postClose)) return 'extended'
  return 'closed'
}

/**
 * Returns an appropriate polling interval based on market hours.
 * - Market open: baseInterval
 * - Extended hours: 3x baseInterval
 * - Closed/weekend: 10x baseInterval (capped at 10min)
 *
 * @param baseInterval - Polling interval in ms during market hours
 * @returns Adjusted interval in ms
 */
export function useMarketAwareInterval(baseInterval: number): number {
  // Check React Query cache for market status (set by PrefetchEngine)
  const qc = useQueryClient()
  const cachedStatus = qc.getQueryData<{ status?: string }>(['marketStatus'])

  return useMemo(() => {
    let status: MarketStatus
    if (cachedStatus?.status === 'open') status = 'open'
    else if (cachedStatus?.status === 'extended') status = 'extended'
    else if (cachedStatus?.status === 'closed') status = 'closed'
    else status = getMarketStatus() // Fallback to local time calc

    switch (status) {
      case 'open': return baseInterval
      case 'extended': return Math.min(baseInterval * 3, 600_000)
      case 'closed': return Math.min(baseInterval * 10, 600_000)
    }
  }, [baseInterval, cachedStatus?.status])
}

/**
 * Non-hook version for use outside React components.
 */
export function getMarketAwareInterval(baseInterval: number): number {
  const status = getMarketStatus()
  switch (status) {
    case 'open': return baseInterval
    case 'extended': return Math.min(baseInterval * 3, 600_000)
    case 'closed': return Math.min(baseInterval * 10, 600_000)
  }
}

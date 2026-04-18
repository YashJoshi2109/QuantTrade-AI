'use client'

import { useEffect, useRef } from 'react'

const HEARTBEAT_INTERVAL = 30_000 // 30 seconds
const WORKER_URL = process.env.NEXT_PUBLIC_LIVE_VISITORS_WORKER_URL || ''

/**
 * Sends periodic heartbeat pings to the Cloudflare Worker so it can
 * track active visitors in KV. Runs silently — no UI, no errors shown.
 */
export function useVisitorHeartbeat() {
  const sentRef = useRef(false)

  useEffect(() => {
    if (!WORKER_URL) return

    const ping = () => {
      fetch(`${WORKER_URL}/heartbeat`, {
        method: 'POST',
        keepalive: true,
      }).catch(() => {}) // silent — don't break the app
    }

    // Send immediately on mount (first visit)
    if (!sentRef.current) {
      ping()
      sentRef.current = true
    }

    const interval = setInterval(ping, HEARTBEAT_INTERVAL)
    return () => clearInterval(interval)
  }, [])
}

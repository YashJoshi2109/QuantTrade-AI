'use client'

import { useVisitorHeartbeat } from '@/hooks/useVisitorHeartbeat'

/** Invisible component — sends periodic heartbeat pings to the live visitor Worker. */
export default function VisitorHeartbeat() {
  useVisitorHeartbeat()
  return null
}

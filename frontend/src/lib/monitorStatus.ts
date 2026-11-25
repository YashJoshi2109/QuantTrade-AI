/**
 * Decide whether Global Monitor counters mean "zero events" or "no data".
 *
 * Event counters come from the backend DB, filled by Celery ingestion jobs.
 * When those jobs have not written anything, the API still returns 200 with
 * zeros, and the UI used to show "0 Events / 0 Critical" as if the world were
 * quiet. `ingestion_status` (from /api/v1/monitor/stats) tells the two apart.
 */

export type EventFeedState = 'loading' | 'ok' | 'empty' | 'offline' | 'stale'

export function eventFeedState(
  ingestionStatus: string | null | undefined,
  totalEvents: number | null | undefined,
): EventFeedState {
  if (ingestionStatus === undefined && totalEvents === undefined) return 'loading'
  const total = typeof totalEvents === 'number' && Number.isFinite(totalEvents) ? totalEvents : 0
  if (total > 0) return 'ok'
  if (ingestionStatus === 'offline') return 'offline'
  if (ingestionStatus === 'stale') return 'stale'
  return 'empty'
}

/** True when a list endpoint answered but every upstream source failed. */
export function isSourceUnavailable(
  data: { source_status?: string } | null | undefined,
  itemCount: number,
): boolean {
  if (!data) return false
  return itemCount === 0 && (data.source_status === 'unavailable' || data.source_status === undefined)
}

export const EVENT_FEED_MESSAGE: Record<'offline' | 'stale', string> = {
  offline: 'Event ingestion is offline: no source has synced yet, so counters are unavailable.',
  stale: 'Event ingestion is stale: no successful sync in the last 24h, so counters are unavailable.',
}

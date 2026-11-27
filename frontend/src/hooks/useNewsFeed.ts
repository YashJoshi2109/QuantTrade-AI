'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  bumpCategoryCounts,
  fetchNewsFeedWithFallback,
  mergeFeedItems,
  newsFeedQueryKey,
  normalizeFeedParams,
  type NewsFeedItem,
  type NewsFeedParams,
  type NewsFeedResult,
} from '@/lib/newsFeed'
import { subscribeNewsSocket, type NewsSocketStatus } from '@/lib/newsSocket'

export const NEWS_POLL_INTERVAL_MS = 60_000
const HIGHLIGHT_MS = 8_000
const ANNOUNCE_MIN_GAP_MS = 20_000

/**
 * Several hook instances can share one cache entry; only the first listener
 * sees an item as "added". Remember recent adds so every instance highlights it.
 */
const recentAdds = new Map<string, number>()
function noteRecentAdds(ids: string[]) {
  const now = Date.now()
  ids.forEach((id) => recentAdds.set(id, now))
  recentAdds.forEach((ts, id) => {
    if (now - ts > HIGHLIGHT_MS) recentAdds.delete(id)
  })
}

export interface UseNewsFeedOptions extends NewsFeedParams {
  enabled?: boolean
  /** Subscribe to the shared news socket (default true). */
  live?: boolean
  /** Produce a rate-limited screen-reader announcement for new items. Enable on ONE panel per page. */
  announce?: boolean
}

export interface UseNewsFeedResult {
  items: NewsFeedItem[]
  categoryCounts: Record<string, number>
  /** Total for the "All" tab (server `all` count, else list length). */
  totalCount: number
  asOf: string | null
  /** Oldest stored item (ISO) — the window an empty result covered. */
  coverageSince: string | null
  mode: 'live' | 'legacy' | null
  /** Socket open AND unified feed available. */
  isLive: boolean
  socketStatus: NewsSocketStatus
  /** Pipeline delay of the newest item (ingested_at − published_at), seconds. */
  lagSeconds: number | null
  /** cluster_ids pushed over the socket in the last few seconds (for highlight). */
  newIds: ReadonlySet<string>
  /** Polite live-region text (rate-limited); empty when nothing to say. */
  announcement: string
  isLoading: boolean
  isFetching: boolean
  isError: boolean
  error: unknown
  refetch: () => void
}

export function computeLagSeconds(items: NewsFeedItem[]): number | null {
  let newest: NewsFeedItem | null = null
  for (const it of items) {
    if (!it.ingested_at) continue
    if (!newest || Date.parse(it.ingested_at) > Date.parse(newest.ingested_at as string)) newest = it
  }
  if (!newest?.ingested_at) return null
  const lag = (Date.parse(newest.ingested_at) - Date.parse(newest.published_at)) / 1000
  if (!Number.isFinite(lag) || lag < 0 || lag > 6 * 3600) return null
  return Math.round(lag)
}

export function useNewsFeed(options: UseNewsFeedOptions = {}): UseNewsFeedResult {
  const { enabled = true, live = true, announce = false, ...rawParams } = options
  const params = normalizeFeedParams(rawParams)
  const queryKey = newsFeedQueryKey(params)
  const keyHash = JSON.stringify(queryKey)
  const queryClient = useQueryClient()

  const [socketStatus, setSocketStatus] = useState<NewsSocketStatus>('idle')
  const [newIds, setNewIds] = useState<ReadonlySet<string>>(() => new Set())
  const [announcement, setAnnouncement] = useState('')

  const query = useQuery<NewsFeedResult>({
    queryKey,
    queryFn: ({ signal }) => fetchNewsFeedWithFallback(params, signal),
    enabled,
    staleTime: 30_000,
    gcTime: 10 * 60_000,
    refetchOnMount: true,
    placeholderData: keepPreviousData,
    retry: 1,
    // Socket up + unified feed → push only. Otherwise poll.
    refetchInterval: (q) =>
      socketStatus === 'open' && q.state.data?.mode === 'live' ? false : NEWS_POLL_INTERVAL_MS,
  })

  const mode = query.data?.mode ?? null

  /* ── socket subscription ── */
  const paramsRef = useRef(params)
  paramsRef.current = params
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())
  const pendingAnnounce = useRef<{ count: number; title: string }>({ count: 0, title: '' })
  const lastAnnounceAt = useRef(0)
  const announceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wasClosed = useRef(false)

  const flushAnnouncement = useCallback(() => {
    announceTimer.current = null
    const { count, title } = pendingAnnounce.current
    if (count === 0) return
    pendingAnnounce.current = { count: 0, title: '' }
    lastAnnounceAt.current = Date.now()
    setAnnouncement(count === 1 ? `New story: ${title}` : `${count} new stories. Latest: ${title}`)
  }, [])

  useEffect(() => {
    if (!enabled || !live) return
    const timers = timersRef.current
    const unsubscribe = subscribeNewsSocket(
      (item) => {
        const p = paramsRef.current
        const key = newsFeedQueryKey(p)
        let addedIds: string[] = []
        queryClient.setQueryData<NewsFeedResult>(key, (old) => {
          if (!old) return old
          const merged = mergeFeedItems(old.items, [item], { params: p })
          addedIds = merged.added
          if (merged.added.length === 0 && merged.updated.length === 0 && merged.items.length === old.items.length) {
            // Item filtered out and nothing removed → keep reference stable
            const removed = old.items.some((i) => i.cluster_id === item.cluster_id)
            if (!removed) return old
          }
          const addedItems = merged.items.filter((i) => merged.added.includes(i.cluster_id))
          return {
            ...old,
            items: merged.items,
            category_counts: bumpCategoryCounts(old.category_counts, addedItems),
            as_of: new Date().toISOString(),
          }
        })
        if (addedIds.length > 0) {
          noteRecentAdds(addedIds)
        } else {
          const ts = recentAdds.get(item.cluster_id)
          const present = queryClient
            .getQueryData<NewsFeedResult>(key)
            ?.items.some((i) => i.cluster_id === item.cluster_id)
          if (!ts || Date.now() - ts > 2_000 || !present) return
          addedIds = [item.cluster_id]
        }
        setNewIds((prev) => {
          const next = new Set(prev)
          addedIds.forEach((id) => next.add(id))
          return next
        })
        const t = setTimeout(() => {
          timers.delete(t)
          setNewIds((prev) => {
            const next = new Set(prev)
            addedIds.forEach((id) => next.delete(id))
            return next
          })
        }, HIGHLIGHT_MS)
        timers.add(t)
        if (announce) {
          pendingAnnounce.current = {
            count: pendingAnnounce.current.count + addedIds.length,
            title: item.title,
          }
          if (!announceTimer.current) {
            const wait = Math.max(0, lastAnnounceAt.current + ANNOUNCE_MIN_GAP_MS - Date.now())
            announceTimer.current = setTimeout(flushAnnouncement, wait)
          }
        }
      },
      (s) => {
        setSocketStatus(s)
        if (s === 'closed') wasClosed.current = true
        if (s === 'open' && wasClosed.current) {
          // Catch up on anything missed while disconnected.
          wasClosed.current = false
          void queryClient.invalidateQueries({ queryKey: ['news-feed'] })
        }
      }
    )
    return () => {
      unsubscribe()
      timers.forEach(clearTimeout)
      timers.clear()
      if (announceTimer.current) {
        clearTimeout(announceTimer.current)
        announceTimer.current = null
      }
    }
    // keyHash re-subscribes when the filter changes so the listener targets the right cache entry
  }, [enabled, live, announce, keyHash, queryClient, flushAnnouncement])

  const items = useMemo(() => query.data?.items ?? [], [query.data])
  const categoryCounts = useMemo(() => query.data?.category_counts ?? {}, [query.data])
  const lagSeconds = useMemo(() => computeLagSeconds(items), [items])
  const { refetch: rqRefetch } = query
  const refetch = useCallback(() => {
    void rqRefetch()
  }, [rqRefetch])

  return {
    items,
    categoryCounts,
    totalCount: categoryCounts.all ?? items.length,
    asOf: query.data?.as_of ?? null,
    coverageSince: query.data?.coverage_since ?? null,
    mode,
    isLive: socketStatus === 'open' && mode === 'live',
    socketStatus,
    lagSeconds,
    newIds,
    announcement,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
    refetch,
  }
}

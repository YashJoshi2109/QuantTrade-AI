/**
 * Community bots: payload types, pure helpers, and the persisted
 * "Show bot posts" preference (shared by desktop + mobile feeds).
 *
 * Bot posts are automated and labelled on the server (title marker, body
 * footer, payload labels); the UI adds a BOT badge and links the author to
 * the bot's methodology page.
 */
'use client'

import { useCallback, useEffect, useState } from 'react'

export interface BotTable {
  title?: string
  columns: string[]
  rows: (string | number)[][]
}

export interface BotChartPoint {
  label: string
  value: number
}

export interface BotChart {
  type: 'bar'
  title: string
  unit: string
  series: BotChartPoint[]
}

export interface BotBadgeInfo {
  kind: string
  value: string
  label: string
  icon?: string
  score?: number
}

export interface BotLink {
  title: string
  url: string
  source?: string
}

export interface BotPayload {
  version: number
  bot: { slug: string; display_name: string; emoji: string; accent?: string }
  slot: string
  lead: string
  highlights: string[]
  tables: BotTable[]
  chart: BotChart | null
  badge: BotBadgeInfo | null
  links: BotLink[]
  notes: string[]
  sources: string[]
  as_of: string
  as_of_label: string
  automated_label: string
  disclaimer: string
}

export interface CommunityBotInfo {
  slug: string
  username: string
  display_name: string
  emoji: string
  tagline: string
  description: string
  methodology: string[]
  data_sources: string[]
  community_slug: string
  schedule: { slot: string; label: string }[]
  daily_cap: number
  universe: string[]
  enabled: boolean
  disabled_reason: string | null
  last_post_at: string | null
  posts_today: number
  rules: string[]
  disclaimer: string
  accent?: string
  avatar_url?: string | null
}

// ── pure helpers ─────────────────────────────────────────────────────────

export interface ChartBar {
  label: string
  value: number
  /** 0..100: share of the half-width (diverging around zero) */
  pct: number
  positive: boolean
}

/** Diverging bars scaled to the largest |value|. Non-finite points are dropped. */
export function chartBars(chart: BotChart | null | undefined): ChartBar[] {
  const pts = (chart?.series ?? []).filter((p) => Number.isFinite(p.value))
  const max = Math.max(0, ...pts.map((p) => Math.abs(p.value)))
  return pts.map((p) => ({
    label: p.label,
    value: p.value,
    pct: max > 0 ? Math.round((Math.abs(p.value) / max) * 1000) / 10 : 0,
    positive: p.value >= 0,
  }))
}

export function formatChartValue(v: number, unit: string): string {
  const sign = v > 0 ? '+' : v < 0 ? '−' : ''
  const abs = Math.abs(v).toFixed(2)
  if (unit === '%') return `${sign}${abs}%`
  if (unit === 'pp') return `${sign}${Math.abs(v).toFixed(1)} pp`
  return `${sign}${abs}`
}

/** Only http(s) links are rendered; anything else is dropped. */
export function safeExternalUrl(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null
  } catch {
    return null
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** Tone of a table cell for colouring: '+1.2%' -> up, '−0.4 pp' -> down. */
export function cellTone(cell: string | number): 'up' | 'down' | null {
  const m = /^([+\-−])(\d+(?:\.\d+)?)/.exec(String(cell).trim())
  if (!m || Number(m[2]) === 0) return null
  return m[1] === '+' ? 'up' : 'down'
}

export function botSlugOf(post: { bot?: BotPayload | null }): string | null {
  return post.bot?.bot?.slug ?? null
}

export function botProfileHref(slug: string): string {
  return `/community/bots/${encodeURIComponent(slug)}`
}

// ── "Show bot posts" preference ─────────────────────────────────────────────

export const SHOW_BOTS_KEY = 'qt:community:showBotPosts'

export function readShowBotsLocal(): boolean {
  try {
    const v = window.localStorage.getItem(SHOW_BOTS_KEY)
    return v === null ? true : v === '1'
  } catch {
    return true
  }
}

export function writeShowBotsLocal(v: boolean): void {
  try {
    window.localStorage.setItem(SHOW_BOTS_KEY, v ? '1' : '0')
  } catch {
    /* private mode */
  }
}

/**
 * Persisted per user: signed-in users store it in their account preferences
 * (`community.show_bot_posts`) so it follows them across devices; everyone
 * also gets a localStorage copy so the first render is right.
 * Returns [show, setShow, ready] — wait for `ready` before the first fetch.
 */
export function useShowBotPosts(isAuthenticated: boolean): [boolean, (v: boolean) => void, boolean] {
  const [show, setShowState] = useState(true)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    setShowState(readShowBotsLocal())
    if (!isAuthenticated) {
      setReady(true)
      return
    }
    import('@/lib/api')
      .then(({ getUserPreferences }) => getUserPreferences())
      .then((prefs) => {
        const v = prefs?.community?.show_bot_posts
        if (!cancelled && typeof v === 'boolean') {
          setShowState(v)
          writeShowBotsLocal(v)
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [isAuthenticated])

  const setShow = useCallback(
    (v: boolean) => {
      setShowState(v)
      writeShowBotsLocal(v)
      if (isAuthenticated) {
        import('@/lib/api')
          .then(({ putUserPreferences }) => putUserPreferences({ community: { show_bot_posts: v } }))
          .catch(() => {})
      }
    },
    [isAuthenticated]
  )

  return [show, setShow, ready]
}
